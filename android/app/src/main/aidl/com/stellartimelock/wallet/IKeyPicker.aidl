package com.stellartimelock.wallet;

import com.stellartimelock.wallet.IKeyPickerCallback;

/**
 * Bound-service variant of com.stellartimelock.wallet.action.PICK_KEY.
 * The secret is delivered once, in memory, through the callback. Callers
 * must not log it, copy it to the clipboard, put it in a URL, or write it
 * to disk.
 */
interface IKeyPicker {
    void pickKey(String requestId, IKeyPickerCallback callback);
}
