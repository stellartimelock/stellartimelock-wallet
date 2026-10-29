// Phone-to-phone XLM pay constants.
//
// The NFC exchange is an app-to-app data channel. The AID below is a
// proprietary identifier (first byte F0). It is not a card-network RID
// and it is not registered in the payment category.

/** ISO 7816 proprietary AID: F0 + "STLPAY" + version 01. 8 bytes. */
export const TAP_PAY_AID = "F053544C50415901";

/** A payment request is valid for two minutes. */
export const REQUEST_TTL_MS = 2 * 60 * 1000;

/**
 * A payer still accepts a request whose expiry is this far past the
 * two-minute window, so a phone clock that is a few seconds ahead does
 * not fail a fresh request. Longer lifetimes are rejected.
 */
export const EXPIRY_SKEW_MS = 15_000;

/** 6 random bytes, hex-encoded. Carried in the URI and the on-chain memo. */
export const NONCE_HEX_LEN = 12;

export const MEMO_TEXT_MAX_BYTES = 28;

/** Human note stored in the SEP-7 `msg` parameter. The chain memo is shorter. */
export const NOTE_MAX_CHARS = 80;

/** On-chain prefix `n:` + nonce + `:`. ASCII, so this is also the byte length. */
export const CHAIN_MEMO_PREFIX_BYTES = 2 + NONCE_HEX_LEN + 1;

export const NOTE_ON_CHAIN_BYTES = MEMO_TEXT_MAX_BYTES - CHAIN_MEMO_PREFIX_BYTES;

/** Modest defaults. Settings can raise these; the payer enforces them. */
export const DEFAULT_PER_TX_XLM = "25.0000000";
export const DEFAULT_DAILY_XLM = "100.0000000";

/** Highest limit the settings screen will store. */
export const MAX_LIMIT_XLM = "1000000.0000000";

export const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** How long a used nonce is remembered after the request itself expired. */
export const NONCE_MEMORY_MS = DAILY_WINDOW_MS;

export const PAYMENT_HISTORY_DIR = "stellartimelock/";
export const PAYMENT_HISTORY_FILE = "tap-pay.json";

export const INTENT_REQUEST_PAY = "com.stellartimelock.timelock.REQUEST_PAY";
export const INTENT_PAY = "com.stellartimelock.timelock.PAY";
export const INTENT_PERMISSION = "com.stellartimelock.timelock.permission.TAP_PAY";

export const ORIGIN_DOMAIN = "stellartimelock.app";

/** Receiver keeps polling this long after expiry so a late ledger close still shows. */
export const CONFIRM_GRACE_MS = 45_000;

/** Short-lived Horizon watch while a tap-to-pay screen is open. Not an app-level poll. */
export const CONFIRM_POLL_MS = 3_000;
