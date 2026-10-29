#![cfg(test)]

use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{Address as _, BytesN as _, Events, Ledger},
    token, Address, Bytes, BytesN, Env, FromVal, String, Symbol, Val,
};

use crate::{Error, HtlcContract, HtlcContractClient, HtlcVault};

/// Tiny token used only so a real G-address can hold a balance.
/// The Stellar asset contract in these tests requires a classic trustline
/// for account addresses, which a fixed public key does not have.
#[contract]
struct MockToken;

#[contracttype]
enum MockBal {
    Bal(Address),
}

#[contractimpl]
impl MockToken {
    pub fn mint(env: Env, to: Address, amount: i128) {
        let key = MockBal::Bal(to);
        let cur: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(cur + amount));
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        let from_key = MockBal::Bal(from);
        let from_bal: i128 = env.storage().persistent().get(&from_key).unwrap_or(0);
        if from_bal < amount {
            panic!("insufficient");
        }
        env.storage().persistent().set(&from_key, &(from_bal - amount));
        let to_key = MockBal::Bal(to);
        let to_bal: i128 = env.storage().persistent().get(&to_key).unwrap_or(0);
        env.storage().persistent().set(&to_key, &(to_bal + amount));
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&MockBal::Bal(id))
            .unwrap_or(0)
    }
}

fn setup() -> (Env, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token_addr = env.register_stellar_asset_contract_v2(admin.clone());
    let sac = token_addr.address();
    let sac_admin = token::StellarAssetClient::new(&env, &sac);

    let contract_id = env.register(HtlcContract, ());
    let client = HtlcContractClient::new(&env, &contract_id);
    client.initialize(&sac);

    // Fund sender with plenty of XLM (stroops).
    sac_admin.mint(&sender, &1_000_000_000);

    (env, contract_id, sac, sender, recipient)
}

fn secret_and_hash(env: &Env) -> (Bytes, BytesN<32>) {
    let preimage = Bytes::from_slice(env, b"stellar-timelock-htlc-secret");
    let hash: BytesN<32> = env.crypto().sha256(&preimage).into();
    (preimage, hash)
}

fn balance(env: &Env, sac: &Address, who: &Address) -> i128 {
    token::Client::new(env, sac).balance(who)
}

fn topic_symbol(env: &Env, topics: &soroban_sdk::Vec<Val>, idx: u32) -> Symbol {
    Symbol::from_val(env, &topics.get(idx).unwrap())
}

fn topic_u64(env: &Env, topics: &soroban_sdk::Vec<Val>, idx: u32) -> u64 {
    u64::from_val(env, &topics.get(idx).unwrap())
}

#[test]
fn initialize_once() {
    let (env, contract_id, sac, _, _) = setup();
    let client = HtlcContractClient::new(&env, &contract_id);
    assert_eq!(client.get_token(), sac);
    let err = client.try_initialize(&Address::generate(&env)).unwrap_err();
    assert_eq!(err.unwrap(), Error::AlreadyInitialized);
}

#[test]
fn create_claim_happy_path() {
    let (env, contract_id, sac, sender, recipient) = setup();
    let client = HtlcContractClient::new(&env, &contract_id);
    let (preimage, hash) = secret_and_hash(&env);

    env.ledger().with_mut(|l| {
        l.timestamp = 1_000;
    });

    let amount = 150_000_000i128; // 15 XLM — above the 10 XLM create floor
    let deadline = 2_000u64;

    let before_sender = balance(&env, &sac, &sender);
    let vault_id = client.create(&sender, &recipient, &hash, &deadline, &amount);
    assert_eq!(vault_id, 0);

    assert_eq!(balance(&env, &sac, &sender), before_sender - amount);
    assert_eq!(balance(&env, &sac, &contract_id), amount);

    let vault = client.get_vault(&vault_id);
    assert_eq!(
        vault,
        HtlcVault {
            id: 0,
            sender: sender.clone(),
            recipient: recipient.clone(),
            hash: hash.clone(),
            amount,
            deadline,
            claimed: false,
            refunded: false,
            created_at: 1_000,
        }
    );


    let before_recipient = balance(&env, &sac, &recipient);
    client.claim(&vault_id, &preimage);

    // Check events immediately after claim — testutils event buffer is
    // overwritten by subsequent host invocations (e.g. get_vault).
    let claimed_topic = Symbol::new(&env, "HtlcClaimed");
    let found_claim = env.events().all().iter().any(|e| {
        let topics = &e.1;
        topics.len() >= 1 && topic_symbol(&env, topics, 0) == claimed_topic
    });
    assert!(found_claim);

    assert_eq!(balance(&env, &sac, &recipient), before_recipient + amount);
    assert_eq!(balance(&env, &sac, &contract_id), 0);

    let vault = client.get_vault(&vault_id);
    assert!(vault.claimed);
    assert!(!vault.refunded);

    // Double-claim fails
    let err = client.try_claim(&vault_id, &preimage).unwrap_err();
    assert_eq!(err.unwrap(), Error::AlreadySettled);
}

#[test]
fn refund_after_deadline() {
    let (env, contract_id, sac, sender, recipient) = setup();
    let client = HtlcContractClient::new(&env, &contract_id);
    let (_, hash) = secret_and_hash(&env);

    env.ledger().with_mut(|l| {
        l.timestamp = 1_000;
    });

    let amount = 100_000_000i128; // exactly 10 XLM
    let deadline = 1_500u64;
    let vault_id = client.create(&sender, &recipient, &hash, &deadline, &amount);

    // Too early
    let err = client.try_refund(&vault_id).unwrap_err();
    assert_eq!(err.unwrap(), Error::DeadlineNotReached);

    // At deadline still blocked (refund requires strictly after)
    env.ledger().with_mut(|l| {
        l.timestamp = deadline;
    });
    let err = client.try_refund(&vault_id).unwrap_err();
    assert_eq!(err.unwrap(), Error::DeadlineNotReached);

    env.ledger().with_mut(|l| {
        l.timestamp = deadline + 1;
    });

    let before = balance(&env, &sac, &sender);
    client.refund(&vault_id);
    assert_eq!(balance(&env, &sac, &sender), before + amount);
    assert_eq!(balance(&env, &sac, &contract_id), 0);

    let vault = client.get_vault(&vault_id);
    assert!(vault.refunded);
    assert!(!vault.claimed);

    let err = client.try_refund(&vault_id).unwrap_err();
    assert_eq!(err.unwrap(), Error::AlreadySettled);
}

#[test]
fn claim_rejects_bad_preimage_and_late_claim() {
    let (env, contract_id, _, sender, recipient) = setup();
    let client = HtlcContractClient::new(&env, &contract_id);
    let (_, hash) = secret_and_hash(&env);

    env.ledger().with_mut(|l| {
        l.timestamp = 100;
    });

    let vault_id = client.create(&sender, &recipient, &hash, &1_000u64, &100_000_000i128);

    let bad = Bytes::from_slice(&env, b"wrong-secret");
    let err = client.try_claim(&vault_id, &bad).unwrap_err();
    assert_eq!(err.unwrap(), Error::InvalidPreimage);

    env.ledger().with_mut(|l| {
        l.timestamp = 1_000;
    });
    let (preimage, _) = secret_and_hash(&env);
    let err = client.try_claim(&vault_id, &preimage).unwrap_err();
    assert_eq!(err.unwrap(), Error::DeadlinePassed);
}

#[test]
fn create_validation() {
    let (env, contract_id, _, sender, recipient) = setup();
    let client = HtlcContractClient::new(&env, &contract_id);
    let (_, hash) = secret_and_hash(&env);

    env.ledger().with_mut(|l| {
        l.timestamp = 500;
    });

    // amount <= 0
    let err = client
        .try_create(&sender, &recipient, &hash, &1_000u64, &0i128)
        .unwrap_err();
    assert_eq!(err.unwrap(), Error::InvalidAmount);

    // deadline not in the future (amount clears the 10 XLM floor)
    let err = client
        .try_create(&sender, &recipient, &hash, &500u64, &100_000_000i128)
        .unwrap_err();
    assert_eq!(err.unwrap(), Error::InvalidDeadline);

    // same party
    let err = client
        .try_create(&sender, &sender, &hash, &1_000u64, &100_000_000i128)
        .unwrap_err();
    assert_eq!(err.unwrap(), Error::SameParty);

    // under 10 XLM, not a permanent Elite sender
    let err = client
        .try_create(&sender, &recipient, &hash, &1_000u64, &99_999_999i128)
        .unwrap_err();
    assert_eq!(err.unwrap(), Error::BelowMinimum);
}

#[test]
fn list_indexes_and_multi_vault() {
    let (env, contract_id, _, sender, recipient) = setup();
    let client = HtlcContractClient::new(&env, &contract_id);
    let other_recipient = Address::generate(&env);
    let (_, hash_a) = secret_and_hash(&env);
    let preimage_b = Bytes::from_slice(&env, b"second-secret");
    let hash_b: BytesN<32> = env.crypto().sha256(&preimage_b).into();

    env.ledger().with_mut(|l| {
        l.timestamp = 10;
    });

    let id0 = client.create(&sender, &recipient, &hash_a, &100u64, &100_000_000i128);
    let id1 = client.create(&sender, &other_recipient, &hash_b, &200u64, &200_000_000i128);
    assert_eq!(id0, 0);
    assert_eq!(id1, 1);

    let sender_ids = client.list_sender_vaults(&sender);
    assert_eq!(sender_ids.len(), 2);
    assert_eq!(sender_ids.get(0).unwrap(), 0);
    assert_eq!(sender_ids.get(1).unwrap(), 1);

    let recip_ids = client.list_recipient_vaults(&recipient);
    assert_eq!(recip_ids.len(), 1);
    assert_eq!(recip_ids.get(0).unwrap(), 0);

    let other_ids = client.list_recipient_vaults(&other_recipient);
    assert_eq!(other_ids.len(), 1);
    assert_eq!(other_ids.get(0).unwrap(), 1);

    // empty index
    let nobody = Address::generate(&env);
    assert_eq!(client.list_sender_vaults(&nobody).len(), 0);
}

#[test]
fn get_vault_missing() {
    let (env, contract_id, _, _, _) = setup();
    let client = HtlcContractClient::new(&env, &contract_id);
    let err = client.try_get_vault(&99u64).unwrap_err();
    assert_eq!(err.unwrap(), Error::VaultNotFound);
}

#[test]
fn claim_requires_matching_hash_bytes() {
    // Explicit BytesN round-trip: hash from random 32 bytes used as "preimage hash"
    let (env, contract_id, _, sender, recipient) = setup();
    let client = HtlcContractClient::new(&env, &contract_id);
    let preimage = BytesN::<32>::random(&env);
    let preimage_bytes: Bytes = preimage.clone().into();
    let hash: BytesN<32> = env.crypto().sha256(&preimage_bytes).into();

    env.ledger().with_mut(|l| {
        l.timestamp = 1;
    });

    let vault_id = client.create(&sender, &recipient, &hash, &9_999u64, &100_000_000i128);
    client.claim(&vault_id, &preimage_bytes);
    assert!(client.get_vault(&vault_id).claimed);
}

#[test]
fn created_event_shape() {
    let (env, contract_id, _, sender, recipient) = setup();
    let client = HtlcContractClient::new(&env, &contract_id);
    let (_, hash) = secret_and_hash(&env);

    env.ledger().with_mut(|l| {
        l.timestamp = 42;
    });

    let amount = 100_000_000i128;
    let deadline = 999u64;
    let vault_id = client.create(&sender, &recipient, &hash, &deadline, &amount);

    let created = Symbol::new(&env, "HtlcCreated");
    let match_evt = env.events().all().iter().find(|e| {
        let topics = &e.1;
        topics.len() >= 2
            && topic_symbol(&env, topics, 0) == created
            && topic_u64(&env, topics, 1) == vault_id
    });
    assert!(match_evt.is_some(), "HtlcCreated event missing");
    let data = match_evt.unwrap().2.clone();
    // data is a vec/tuple of (sender, recipient, hash, deadline, amount)
    let _ = data;
}

#[test]
fn permanent_elite_can_lock_under_ten_xlm() {
    let env = Env::default();
    env.mock_all_auths();
    let token_id = env.register(MockToken, ());
    let token = MockTokenClient::new(&env, &token_id);
    let elite = Address::from_string(&String::from_str(
        &env,
        "GCMZDT4UIWVPMO55MLGLDTD647HTXGLWQ2ZU23EAPO4KGID4CF5BAJRG",
    ));
    let recipient = Address::generate(&env);
    token.mint(&elite, &1_000_000);

    let contract_id = env.register(HtlcContract, ());
    let client = HtlcContractClient::new(&env, &contract_id);
    client.initialize(&token_id);
    let (_, hash) = secret_and_hash(&env);

    env.ledger().with_mut(|l| {
        l.timestamp = 10;
    });

    let vault_id = client.create(&elite, &recipient, &hash, &1_000u64, &1_000i128);
    assert_eq!(client.get_vault(&vault_id).amount, 1_000);
    assert_eq!(token.balance(&contract_id), 1_000);
}

#[test]
fn existing_small_lock_still_settles() {
    // A vault written before the floor (same struct, small amount) can
    // still be claimed and refunded. create() would reject this amount.
    let (env, contract_id, sac, sender, recipient) = setup();
    let client = HtlcContractClient::new(&env, &contract_id);
    let (preimage, hash) = secret_and_hash(&env);

    env.ledger().with_mut(|l| {
        l.timestamp = 1_000;
    });

    let claim_amount = 777i128;
    env.as_contract(&contract_id, || {
        crate::storage::set_vault(
            &env,
            0,
            &HtlcVault {
                id: 0,
                sender: sender.clone(),
                recipient: recipient.clone(),
                hash: hash.clone(),
                amount: claim_amount,
                deadline: 5_000,
                claimed: false,
                refunded: false,
                created_at: 1_000,
            },
        );
    });
    token::StellarAssetClient::new(&env, &sac).mint(&contract_id, &claim_amount);
    client.claim(&0u64, &preimage);
    assert!(client.get_vault(&0u64).claimed);
    assert_eq!(balance(&env, &sac, &recipient), claim_amount);

    let refund_amount = 888i128;
    env.as_contract(&contract_id, || {
        crate::storage::set_vault(
            &env,
            1,
            &HtlcVault {
                id: 1,
                sender: sender.clone(),
                recipient: recipient.clone(),
                hash,
                amount: refund_amount,
                deadline: 1_200,
                claimed: false,
                refunded: false,
                created_at: 1_000,
            },
        );
    });
    token::StellarAssetClient::new(&env, &sac).mint(&contract_id, &refund_amount);
    env.ledger().with_mut(|l| {
        l.timestamp = 1_201;
    });
    let before = balance(&env, &sac, &sender);
    client.refund(&1u64);
    assert!(client.get_vault(&1u64).refunded);
    assert_eq!(balance(&env, &sac, &sender), before + refund_amount);
}