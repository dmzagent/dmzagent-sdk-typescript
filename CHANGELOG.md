# Changelog

## [Unreleased]

### Added
- **Circuit-breaker state cache** (spec §4.4). `check()` is a network
  round trip in front of a sensitive action; `cbCacheTtl` (milliseconds,
  like `timeout`) lets a repeat check on the same subject come from
  memory instead. Off at 0, which is the default.

  `cbCacheMaxEntries` bounds it — the key is a subject id, so an agent
  seeing many subjects would otherwise hold an entry for each for the
  life of the process — and evicts least-recently-used first.
  `check({fresh: true})` skips the cache and refreshes it; `guard()`
  passes `fresh` through.
- `CheckResult.cached`, `.cacheAgeMs`, `.stale`. A caller recording a
  denial has to be able to tell it read four-second-old state. The
  server's own `latencyMs`, `routeLatencyMs`, `checkedAt` and `raw` are
  left alone on a cached result — they describe the check that happened.
- `cbCacheOnError: "last_known"` serves the last known state for a
  subject, marked `stale`, when the check cannot reach the server. It
  throws when nothing is known for that subject, and cannot be set
  without a TTL to fall back on. A `429` stays a `RateLimitError`: the
  server answered, and the `retryAfter` is worth acting on.
- `ON_ERROR_RAISE` / `ON_ERROR_LAST_KNOWN` and the `CbCacheOnError` type
  exported, so the policy is not a bare string at the call site.

### Fixed
- `src/agent.ts` declared its own `SPEC_VERSION = "0.6.0"` while
  `src/version.ts` read `0.8.0`. Both are published — `@dmzagent/sdk`
  and `@dmzagent/sdk/agent` — so two entry points of one package
  exported the same symbol with different values, and the User-Agent
  used one of them. The subpath now re-exports rather than
  re-declaring, both read `0.9.0`, and
  `tests/version-markers.test.ts` holds them to the manifest pin.

## [0.6.0] — 2026-06-02

### Added
- `@dmzagent/sdk/concordia` — TypeScript client for the Concordia
  MCP 1.0 governance server at `/mcp/v1`. New `ConcordiaClient` class
  wraps the four MCP tools (`enforceCovenant`, `recordDecision`,
  `queryCorpus`, `getSubjectSoul`) and the three resources
  (`workspacePolicies`, `workspaceCanons`, `recentLedger`) so callers
  don't write JSON-RPC envelopes by hand.
- Typed result interfaces: `EnforceCovenantResult`,
  `RecordDecisionResult`, `QueryCorpusResult`, `SubjectSoul`,
  `PolicySummary`, `InstalledCanon`, `LedgerEntry`, `LedgerPage`.
- Typed exception hierarchy with 1:1 mapping to MCP spec §8 error
  codes: `ConcordiaAuthError`, `ConcordiaQuotaExceededError`,
  `ConcordiaPolicyEngineUnavailableError`,
  `ConcordiaCanonNotInstalledError`,
  `ConcordiaSubjectNotFoundError`, `ConcordiaCircuitOpenError`,
  `ConcordiaPermissionDeniedError`. Plus base `ConcordiaError` and
  transport-level `ConcordiaProtocolError`.
- `ConcordiaClient.iterLedger()` async generator for streaming
  through paginated ledger pages.
- `Symbol.asyncDispose` support so `await using client = new
  ConcordiaClient({…})` works under TypeScript 5.2+ explicit-resource
  -management.

### Changed
- Package version bumped to `0.6.0` (minor — additive, no breaking
  changes to the existing 0.5.0 surface).
- Added `./concordia` subpath export for tree-shakable imports.
- The agent-stream surface (`DMZAgent` client, `Conversation`,
  `verifyWebhookSignature`) remains at spec v0.5.0; `SPEC_VERSION`
  is unchanged.

## [0.5.0] — 2026-05-30

First lockstep release — aligns with the Python, C#, and Java SDKs
under `dmzagent-sdk-spec` v0.5.0.
