# Security policy

## Reporting a vulnerability

Please report security problems privately by email to stellartimelock@gmail.com
with the subject "Security". Do not open a public issue for a vulnerability.

Include the app version (Settings → About), what you found, and steps to
reproduce. We aim to reply within 7 days.

## Scope

- This Android app (`com.stellartimelock`).
- The swap proxy Worker in `proxy/`.

Out of scope: third-party services the app talks to (Stellar Horizon and RPC
providers, SimpleSwap, Cloudflare), and issues that need a rooted or already
compromised phone.

## Notes

- Secret seeds stay on the phone. Never send a seed or secret key in a report.
- This project has not had an independent security audit.
