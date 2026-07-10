# Changelog

## [0.7.0] — 2026-07-10

DX-9 SDK harmonization — aligns with `dmzagent-sdk-spec` v0.7.0
(error taxonomy + Logic Canon response normalization). Breaking
change to typed throws and `LogicEventAck` / install models, hence
the 0.x minor bump.

### Added
- `RateLimitError` (extends `DMZAgentError`) for HTTP 429, exposing
  `retryAfter: number | null` — the `Retry-After` response header
  parsed in its delta-seconds form; `null` when absent or unparseable.
  The SDK never sleeps or retries automatically (spec §3).
- HTTP 422 (well-formed but unprocessable — bad event / rulebook) now
  maps to `ValidationError`, same as 400 (spec §3).
- Named DTOs `FiredRule { ruleId, raw }` and
  `Escalation { ruleId, band?, lane?, raw }` used by
  `LogicEventAck.fired` / `.escalations`, each preserving its full
  wire item on `raw`. `band` / `lane` and every status field stay
  open `string` types, never TS literal unions.
- `LogicEventAck` gained the honest-ack fields `degraded: boolean`,
  `responded: boolean`, `installsEvaluated: number`, and
  `installsTotal: number` (defaults `false`/`false`/`0`/`0` when the
  server omits them) so a fail-open gap is visible inline.
- New `LogicInstallHealthRow` interface (`logicCanonId`, `version`,
  `slug`, `name`, health `status` = `ok` | `missing_bytes` |
  `compile_error` as an open string, `detail`, `raw`) plus
  `logicInstallHealthRowFromResponse`.

### Changed
- **BREAKING**: client-side precondition failures (missing or
  ill-shaped arguments caught before any request is made) now throw
  the built-in `RangeError` per spec §5 — across `DMZAgent`,
  `Conversation`, and the subject helpers. `ValidationError` is
  reserved for the wire (HTTP 400/422). Catch blocks relying on
  `ValidationError` for local argument mistakes must switch to
  `RangeError`.
- **BREAKING**: `LogicCanonInstall` is now the deploy record only —
  its `status` is the lifecycle enum (`draft` | `published` |
  `unpublished`, open string) and the health-only `detail` field is
  gone. `LogicInstallHealth.installs` now returns
  `LogicInstallHealthRow[]` (the two `status` enums were previously
  conflated on one type).
- **BREAKING**: `subjectType` is now required on `emitEvent`,
  `subjectSays`, `toolCall`, `toolResult`, and `observation`, matching
  sdk-spec.md §5.1–5.5 (`subject_type` is REQUIRED on the wire) and the
  Python/C# clients. Omitting it — or passing a value outside
  `EVENT_SUBJECT_TYPES` — throws `RangeError`. The `Conversation`
  handle supplies it automatically: the first participant declaring a
  `subject_type` wins, otherwise `"chat"` (mirrors the C# client).
- `Subject` gained an optional `subject_type` field, preserved through
  the conversation roster.
- Tracked server wire changes: the `POST /v1/logic/events` 202 ack
  carries `degraded` / `responded` / `installs_evaluated` /
  `installs_total`; list responses renamed `total` → `count` (the SDK
  never surfaced `total`, so no typed field changed); workspace
  install-list rows no longer carry `vendor_id`; 429 responses carry
  `Retry-After` (delta-seconds).
- `SPEC_VERSION` and `package.json#dmzagent.specVersion` pinned to
  `0.7.0`. The conformance runner now applies a fixture's optional
  `headers` to the stubbed response and asserts `expected_retry_after`
  against the error's `retryAfter`.

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
