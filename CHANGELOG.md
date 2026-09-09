# Changelog

## [Unreleased]

## [0.7.0] — 2026-09-09 (spec 0.10.0)

### Added
- **Human-in-the-loop approvals you render yourself.** `listApprovals()`,
  `iterApprovals()`, `decideApproval()`, and the `approveApproval()` /
  `declineApproval()` wrappers.

  An `Approval` holds nothing we wrote for your users: `reason` and each
  `firedPolicies[].name` are your operator's own policy words, and
  `action` is the call your agent was about to make, verbatim. Building
  the sentence your user reads is your job, because a sentence we wrote
  would read the same in every customer's product.

  `actorId` is required on every decision and is never defaulted or
  derived from the API key. A decision without one throws
  `ValidationError` before any request is made — a caller who has not got
  a human's identity at that point does not have a human, and the failure
  belongs where the mistake is.

- **`CheckResult.pendingApprovalId` and `.awaitingApproval`.** The
  difference between being refused and being asked. `allow` is still
  `false` in both cases, deliberately: code that reads `allow` alone keeps
  refusing, so nothing written before this release starts allowing what it
  used to deny.

- **The incident and remediation ledger is readable** — `getIncidents()`
  and `iterIncidents()`, returning `Incident` with its `remediations`.

  `anchor` has been on `CheckResult` for several releases and pointed into
  a ledger nothing could open. Record it at check time, find that
  `ledger_index` here, compare hashes.

  An incident with no remediations and status `open` is the normal shape
  of something nobody has answered yet — not an error, and not collapsed
  to `null`.

### Changed
- **`ConflictError` also means a settled approval.** A second decision on
  an approval someone already decided, or one past its deadline, is a 409.
  Same type as the idempotency conflict for the same reason: the call did
  not fail, it lost, and retrying cannot win. `err.body.status` says which
  of the two it was, and the message no longer asserts "Idempotency-Key"
  on paths where that is not the cause.

### Notes
- **Neither list method follows a cursor on its own.** You asked for one
  page and you get one page; `iterApprovals()` / `iterIncidents()` are
  async generators that fetch a page only when you ask for an item past
  the ones they hold. `break` out of the loop and the next page is never
  requested.
- **There is no `closeIncident()`.** The ledger is append-only and has no
  endpoint for one — an incident reaches `remediated` because a
  remediation was appended to it.
- **Expiry declines, and cannot be configured otherwise.** `onExpiry`
  reads `decline` even if a server sends something else.
- The conformance runner now dispatches the three new corpus methods and
  pins **verb and query string** on read vectors: asserting only the body
  would let a GET that dropped every filter pass, since a GET has no body
  to be wrong about.

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
