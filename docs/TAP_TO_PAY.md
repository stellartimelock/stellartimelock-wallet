# Tap to pay

Stellar TimeLock (`com.stellartimelock`) can collect or send XLM between two phones. Market and Delivery Driver start a checkout with an intent. The person holding the phone still sees the full amount and the full recipient address, then confirms with biometrics, before anything is signed.

The biometric check only decides whether the app may use the seed-derived Stellar key. The key is not encrypted to the device. Payment history is plain JSON.

NFC is an app-to-app data exchange. It is not an EMV or card payment. The host-card service is registered in the `other` AID group with a proprietary AID (`F053544C50415901`). It is not a payment-category service and it is not offered as the default payment app. When NFC is off or the phone has no NFC, the same `web+stellar:pay` link is shown as a QR code and opened as a deep link.

Network calls use HTTPS on port 443 (Horizon and the public DEX). That stays up on a VPN that only forwards normal web traffic.

## Permission

```xml
<uses-permission android:name="com.stellartimelock.timelock.permission.TAP_PAY" />
```

`com.stellartimelock.timelock.permission.TAP_PAY` is a `signature` permission. Android grants it only when the caller is signed with the same certificate as Stellar TimeLock. There is no package allowlist. Install Stellar TimeLock before (or in the same session as) the caller.

Callers must be signed with the same certificate as this app. See the README section "Signing".

Target package: `com.stellartimelock`.

```xml
<queries>
  <package android:name="com.stellartimelock" />
</queries>
```

## Request a payment

Action: `com.stellartimelock.timelock.REQUEST_PAY`

Use this when Market or Delivery Driver is collecting. TimeLock opens the request screen with the amount filled in, broadcasts the link over NFC, and shows the QR code when NFC is unavailable. The request expires in two minutes and carries a nonce so the same link cannot be paid twice.

| Extra | Type | Required | Meaning |
| --- | --- | --- | --- |
| `requestId` | string | yes | Your checkout id. It is echoed in the result. |
| `amount` | string | yes | XLM amount, up to 7 decimal places. |
| `memo` | string | no | Note the payer will see. Long notes are shortened on chain. |
| `label` | string | no | Name shown on the request, such as `Delivery`. |

`RESULT_OK` extras:

| Extra | Meaning |
| --- | --- |
| `requestId` | The id you sent |
| `hash` | Horizon transaction hash |
| `amount` | XLM amount that was requested |
| `destination` | The collecting account (`G…`) |
| `payer` | The account that paid (`G…`) |

The result is returned only after Horizon confirms a payment with the matching memo and amount.

## Pay

Action: `com.stellartimelock.timelock.PAY`

Use this when Market or Delivery Driver is asking the customer to pay. TimeLock opens the review screen. It does not sign until the customer confirms.

Send either a full SEP-7 `uri`, or `destination` plus `amount`.

| Extra | Type | Required | Meaning |
| --- | --- | --- | --- |
| `requestId` | string | yes | Your checkout id. A second pay with the same id is rejected. |
| `uri` | string | no | `web+stellar:pay?…` link. When set, destination and amount come from the link. |
| `destination` | string | with amount | Recipient `G…` address. |
| `amount` | string | with destination | XLM amount. |
| `memo` | string | no | Note stored with the payment. |
| `label` | string | no | Recipient name to show beside the address. |

`RESULT_OK` extras: `requestId`, `hash`, `amount`, `destination`, `payer`.

`RESULT_CANCELED` may include `requestId` and `error`:

| Code | Meaning |
| --- | --- |
| `caller_not_allowed` | Missing permission or a different signing certificate |
| `request_id_required` | `requestId` was missing or blank |
| `invalid_input` | Amount, address, or link was not usable |
| `canceled` | The user canceled |

Set the package to `com.stellartimelock` so another app cannot intercept the intent.

## Kotlin

```kotlin
private val checkout = registerForActivityResult(
    ActivityResultContracts.StartActivityForResult()
) { result ->
    val data = result.data
    if (result.resultCode != Activity.RESULT_OK || data == null) {
        onCheckoutDenied(data?.getStringExtra("error") ?: "canceled")
        return@registerForActivityResult
    }
    onPaid(
        data.getStringExtra("requestId").orEmpty(),
        data.getStringExtra("hash").orEmpty(),
    )
}

fun requestPayment(orderId: String, amountXlm: String) {
    val intent = Intent("com.stellartimelock.timelock.REQUEST_PAY").apply {
        setPackage("com.stellartimelock")
        putExtra("requestId", orderId)
        putExtra("amount", amountXlm)
        putExtra("memo", "Order $orderId")
        putExtra("label", "Delivery")
    }
    checkout.launch(intent)
}

fun payMerchant(checkoutId: String, merchant: String, amountXlm: String) {
    val intent = Intent("com.stellartimelock.timelock.PAY").apply {
        setPackage("com.stellartimelock")
        putExtra("requestId", checkoutId)
        putExtra("destination", merchant)
        putExtra("amount", amountXlm)
        putExtra("memo", "Order $checkoutId")
        putExtra("label", "Market")
    }
    checkout.launch(intent)
}
```

Manifest in the sibling app:

```xml
<uses-permission android:name="com.stellartimelock.timelock.permission.TAP_PAY" />

<queries>
  <package android:name="com.stellartimelock" />
</queries>
```

## What the payer sees

1. The full XLM amount, the USD value when the DEX rate is available, the recipient name, and the full `G…` address.
2. The memo, the on-chain memo, and whether the network is testnet or mainnet.
3. A warning when that address has not been paid before and is not in the address book. The payer has to check the box before signing.
4. A biometric prompt. Canceling it signs nothing.

Per-payment and daily limits (default 25 XLM and 100 XLM) are in Settings. A link that is expired, already paid, or for the other network cannot be signed.

## Link format

The NFC payload, the QR code, and the deep link are the same SEP-7 string:

```text
web+stellar:pay?destination=G...&amount=1.5000000&memo=n:<nonce>:<note>&memo_type=MEMO_TEXT&msg=<note>&network_passphrase=...&nonce=<12 hex>&expires=<unix seconds>&origin_domain=stellartimelock.app
```

`expires` is two minutes after the request is created. `callback` on a link is ignored. Only native XLM is accepted.

## NFC

The receiver's screen is in the foreground and answers a proprietary AID. The payer's phone is in reader mode and reads the URI in short chunks. No card cryptogram is produced. Phones without NFC use the QR code or open the `web+stellar:` link, which routes to the same review screen.
