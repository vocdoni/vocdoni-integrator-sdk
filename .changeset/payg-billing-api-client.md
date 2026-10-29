---
'@vocdoni/api-client': minor
---

Pay-per-process billing methods: `elections.getPrice`, `checkout`, `getCheckout`, `cancelCheckout` and `censusCheckout`, `organizations.getWallet`, `topUpWallet` and `updateManaged`, and `client.pricing()`. `VocdoniApiError` carries the error `data`, with `isApiError` and `isCensusGrowthQuote` to narrow it. `publishAndWait` no longer times out after 60 s by default.
