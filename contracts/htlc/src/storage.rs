use soroban_sdk::{contracttype, Address, Env, Vec};

use crate::{Error, HtlcVault, DAY_LEDGERS};

/// Instance TTL: refresh when below 7 days; extend out to 30 days.
const INSTANCE_THRESHOLD: u32 = DAY_LEDGERS * 7;
const INSTANCE_EXTEND: u32 = DAY_LEDGERS * 30;

/// Persistent TTL: refresh when below 30 days; extend out to 90 days.
const PERSISTENT_THRESHOLD: u32 = DAY_LEDGERS * 30;
const PERSISTENT_EXTEND: u32 = DAY_LEDGERS * 90;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Initialized,
    Token,
    NextId,
    Vault(u64),
    SenderIndex(Address),
    RecipientIndex(Address),
}

pub fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_THRESHOLD, INSTANCE_EXTEND);
}

pub fn bump_persistent(env: &Env, key: &DataKey) {
    if env.storage().persistent().has(key) {
        env.storage()
            .persistent()
            .extend_ttl(key, PERSISTENT_THRESHOLD, PERSISTENT_EXTEND);
    }
}

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Initialized)
}

pub fn set_initialized(env: &Env) {
    env.storage().instance().set(&DataKey::Initialized, &true);
}

pub fn set_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::Token, token);
}

pub fn get_token(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Token)
        .ok_or(Error::NotInitialized)
}

pub fn get_next_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::NextId)
        .unwrap_or(0u64)
}

pub fn set_next_id(env: &Env, id: u64) {
    env.storage().instance().set(&DataKey::NextId, &id);
}

pub fn set_vault(env: &Env, id: u64, vault: &HtlcVault) {
    let key = DataKey::Vault(id);
    env.storage().persistent().set(&key, vault);
    bump_persistent(env, &key);
}

pub fn get_vault(env: &Env, id: u64) -> Result<HtlcVault, Error> {
    let key = DataKey::Vault(id);
    let vault = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(Error::VaultNotFound)?;
    bump_persistent(env, &key);
    Ok(vault)
}

pub fn push_index(env: &Env, key: DataKey, vault_id: u64) {
    let mut ids: Vec<u64> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env));
    ids.push_back(vault_id);
    env.storage().persistent().set(&key, &ids);
    bump_persistent(env, &key);
}

pub fn list_for_key(env: &Env, key: &DataKey) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(key)
        .unwrap_or_else(|| Vec::new(env))
}
