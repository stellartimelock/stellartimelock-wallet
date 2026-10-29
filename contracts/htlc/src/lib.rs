#![no_std]
//! Multi-vault Hash Time-Locked Contract (HTLC) for native XLM.
//!
//! One deployed instance manages many independent HTLCs. Funds are held
//! in the contract via the wrapped-native XLM SAC configured at `initialize`.
//!
//! Lifecycle per vault:
//! 1. `create` — sender locks XLM against a SHA-256 hash and deadline
//! 2. `claim` — recipient reveals preimage before deadline
//! 3. `refund` — sender reclaim after deadline if unclaimed
//!
//! No upgrade authority, clawback, pause, or admin beyond one-time init.

mod storage;
mod test;

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, Bytes, BytesN, Env,
    String, Symbol, Vec,
};

use storage::{
    bump_instance, bump_persistent, get_next_id, get_token, get_vault, is_initialized,
    list_for_key, push_index, set_initialized, set_next_id, set_token, set_vault, DataKey,
};

/// Ledger-day approximation (~5s ledgers). Used for TTL keep-alive.
pub(crate) const DAY_LEDGERS: u32 = 17_280;

/// 10 XLM. Checked only in `create`. Claim and refund ignore it so a lock
/// that was saved before this rule still settles.
pub(crate) const MIN_LOCK_STROOPS: i128 = 100_000_000;

/// Same keys as `PERMANENT_ELITE_ACCOUNTS` in
/// `src/tiers/permanent-elite.ts`. The contract cannot see the app's
/// subscription tier. Matching the sender to this list is the exemption.
/// A flag passed in by the caller would not be a check, because the caller
/// could set it. Storage layout is unchanged: this is a create-time rule.
const PERMANENT_ELITE: [&str; 5] = [
    "GCMZDT4UIWVPMO55MLGLDTD647HTXGLWQ2ZU23EAPO4KGID4CF5BAJRG",
    "GDDZEJ34FUQPNRBMZHIHMPOQR7JNODH3IWAD66PC7PTQXOEF2QZO227E",
    "GDVE75XKKMWTARKSDFO22Q3WHNDQJRPQCXV4B5UQKFRK3J2XMNFH3M6R",
    "GCTWHBAAXP44OF74KEOZU7QEJXJBASDMJ3UDJRGBEY35EMVHAE76RYNW",
    // iblitzc0de, security researcher, lifetime Elite (2026-10-11)
    "GAJT5MLVAFGNEHEBCPKLV7UV4VGY2MUSPOKVVPNF2MVYLXJDBVKWC26G",
];

fn is_permanent_elite(env: &Env, sender: &Address) -> bool {
    for g in PERMANENT_ELITE {
        let elite = Address::from_string(&String::from_str(env, g));
        if sender == &elite {
            return true;
        }
    }
    false
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// `initialize` already called.
    AlreadyInitialized = 1,
    /// Contract has not been initialized with an XLM SAC address.
    NotInitialized = 2,
    /// `amount` must be > 0.
    InvalidAmount = 3,
    /// `deadline` must be strictly after the current ledger timestamp.
    InvalidDeadline = 4,
    /// Vault id does not exist.
    VaultNotFound = 5,
    /// Vault already claimed or refunded.
    AlreadySettled = 6,
    /// Caller is not the vault recipient.
    NotRecipient = 7,
    /// Caller is not the vault sender.
    NotSender = 8,
    /// Claim attempted at or after the deadline.
    DeadlinePassed = 9,
    /// Refund attempted before the deadline.
    DeadlineNotReached = 10,
    /// SHA-256(preimage) does not match the stored hash.
    InvalidPreimage = 11,
    /// Sender and recipient must be distinct addresses.
    SameParty = 12,
    /// New lock is under 10 XLM and the sender is not permanent Elite.
    /// Not returned by claim or refund.
    BelowMinimum = 13,
}

/// On-chain state for a single HTLC vault.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HtlcVault {
    pub id: u64,
    pub sender: Address,
    pub recipient: Address,
    pub hash: BytesN<32>,
    pub amount: i128,
    pub deadline: u64,
    pub claimed: bool,
    pub refunded: bool,
    pub created_at: u64,
}

#[contract]
pub struct HtlcContract;

#[contractimpl]
impl HtlcContract {
    /// One-time setup: bind the wrapped-native XLM SAC this contract will use.
    ///
    /// Mainnet SAC: `CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA`
    ///
    /// Not an admin/control plane — there is no further privileged entrypoint
    /// after this call. Required so the same WASM can target testnet or mainnet.
    pub fn initialize(env: Env, token: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        set_token(&env, &token);
        set_next_id(&env, 0);
        set_initialized(&env);
        bump_instance(&env);
        Ok(())
    }

    /// Lock `amount` stroops of XLM into a new HTLC vault.
    ///
    /// - `sender` must authorize the transfer into this contract
    /// - `hash` is SHA-256 of the secret preimage (32 bytes)
    /// - `deadline` is a unix timestamp; refunds are allowed strictly after it
    pub fn create(
        env: Env,
        sender: Address,
        recipient: Address,
        hash: BytesN<32>,
        deadline: u64,
        amount: i128,
    ) -> Result<u64, Error> {
        bump_instance(&env);
        if !is_initialized(&env) {
            return Err(Error::NotInitialized);
        }
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        // New locks only. An existing vault's amount is never re-checked.
        if amount < MIN_LOCK_STROOPS && !is_permanent_elite(&env, &sender) {
            return Err(Error::BelowMinimum);
        }
        let now = env.ledger().timestamp();
        if deadline <= now {
            return Err(Error::InvalidDeadline);
        }
        if sender == recipient {
            return Err(Error::SameParty);
        }

        sender.require_auth();

        let token_addr = get_token(&env)?;
        let token = token::Client::new(&env, &token_addr);
        token.transfer(&sender, &env.current_contract_address(), &amount);

        let vault_id = get_next_id(&env);
        set_next_id(&env, vault_id + 1);

        let vault = HtlcVault {
            id: vault_id,
            sender: sender.clone(),
            recipient: recipient.clone(),
            hash: hash.clone(),
            amount,
            deadline,
            claimed: false,
            refunded: false,
            created_at: now,
        };
        set_vault(&env, vault_id, &vault);
        push_index(&env, DataKey::SenderIndex(sender.clone()), vault_id);
        push_index(&env, DataKey::RecipientIndex(recipient.clone()), vault_id);

        env.events().publish(
            (Symbol::new(&env, "HtlcCreated"), vault_id),
            (
                sender,
                recipient,
                hash,
                deadline,
                amount,
            ),
        );

        Ok(vault_id)
    }

    /// Recipient claims locked XLM by revealing a preimage whose SHA-256
    /// matches the vault hash. Must be called strictly before `deadline`.
    pub fn claim(env: Env, vault_id: u64, preimage: Bytes) -> Result<(), Error> {
        bump_instance(&env);

        let mut vault = get_vault(&env, vault_id)?;
        if vault.claimed || vault.refunded {
            return Err(Error::AlreadySettled);
        }

        vault.recipient.require_auth();

        let now = env.ledger().timestamp();
        if now >= vault.deadline {
            return Err(Error::DeadlinePassed);
        }

        let digest = env.crypto().sha256(&preimage);
        let digest_bytes: BytesN<32> = digest.into();
        if digest_bytes != vault.hash {
            return Err(Error::InvalidPreimage);
        }

        let token_addr = get_token(&env)?;
        let token = token::Client::new(&env, &token_addr);
        token.transfer(
            &env.current_contract_address(),
            &vault.recipient,
            &vault.amount,
        );

        vault.claimed = true;
        set_vault(&env, vault_id, &vault);

        env.events().publish(
            (Symbol::new(&env, "HtlcClaimed"), vault_id),
            preimage,
        );

        Ok(())
    }

    /// Sender refunds locked XLM after the deadline if the vault is unsettled.
    pub fn refund(env: Env, vault_id: u64) -> Result<(), Error> {
        bump_instance(&env);

        let mut vault = get_vault(&env, vault_id)?;
        if vault.claimed || vault.refunded {
            return Err(Error::AlreadySettled);
        }

        vault.sender.require_auth();

        let now = env.ledger().timestamp();
        if now <= vault.deadline {
            return Err(Error::DeadlineNotReached);
        }

        let token_addr = get_token(&env)?;
        let token = token::Client::new(&env, &token_addr);
        token.transfer(
            &env.current_contract_address(),
            &vault.sender,
            &vault.amount,
        );

        vault.refunded = true;
        set_vault(&env, vault_id, &vault);

        env.events().publish((Symbol::new(&env, "HtlcRefunded"), vault_id), ());

        Ok(())
    }

    /// Read full vault state.
    pub fn get_vault(env: Env, vault_id: u64) -> Result<HtlcVault, Error> {
        bump_instance(&env);
        let vault = get_vault(&env, vault_id)?;
        bump_persistent(&env, &DataKey::Vault(vault_id));
        Ok(vault)
    }

    /// All vault IDs created by `sender` (oldest → newest).
    pub fn list_sender_vaults(env: Env, sender: Address) -> Vec<u64> {
        bump_instance(&env);
        let key = DataKey::SenderIndex(sender);
        let ids = list_for_key(&env, &key);
        bump_persistent(&env, &key);
        ids
    }

    /// All vault IDs where `recipient` can claim (oldest → newest).
    pub fn list_recipient_vaults(env: Env, recipient: Address) -> Vec<u64> {
        bump_instance(&env);
        let key = DataKey::RecipientIndex(recipient);
        let ids = list_for_key(&env, &key);
        bump_persistent(&env, &key);
        ids
    }

    /// Wrapped-native XLM SAC address configured at initialize (read-only).
    pub fn get_token(env: Env) -> Result<Address, Error> {
        bump_instance(&env);
        get_token(&env)
    }
}
