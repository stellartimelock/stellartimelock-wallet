package com.stellartimelock.wallet;

/**
 * oneway so the wallet never blocks on the caller while a secret is in hand.
 * onPicked carries the same four fields as the activity result extras:
 * requestId, keyId, label, secret.
 */
oneway interface IKeyPickerCallback {
    void onPicked(String requestId, String keyId, String label, String secret);
    void onCanceled(String requestId, String reason);
}
