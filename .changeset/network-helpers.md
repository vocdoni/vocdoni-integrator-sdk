---
"@vocdoni/api-client": minor
---

New network helpers: the `VocdoniNetwork` type (`'dev' | 'stg' | 'prod'`) and the `VOCDONI_NETWORKS` table of gateway and explorer URLs, `isVocdoniNetwork`, `networkFromChainId(chainId)` (`undefined` for an unknown chain, no silent fallback to dev), `resolveNetwork`, `explorerUrl`, and the link builders `explorerVoteUrl`, `explorerElectionUrl` and `explorerOrganizationUrl`. `client.network()` derives the network from `info().chainId`. New id predicates `isProcessId`, `isVochainElectionId`, `isOrganizationAddress`, and `normalizeOrganizationAddress`.

**Behaviour change:** `normalizeVotingProcess`, and so `elections.get()` and `elections.list()`, now return `orgAddress` `0x`-prefixed and lowercase, as the organization routes use it. Code that compared it to the unprefixed wire value, or prefixed it itself (`'0x' + orgAddress`), must drop that; compare addresses through `normalizeOrganizationAddress`.
