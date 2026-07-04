# Changelog

## [Unreleased]

### Changed
- **BREAKING**: `subjectType` is now required on `emitEvent`,
  `subjectSays`, `toolCall`, `toolResult`, and `observation`, matching
  sdk-spec.md §5.1–5.5 (`subject_type` is REQUIRED on the wire) and the
  Python/C# clients. Omitting it — or passing a value outside
  `EVENT_SUBJECT_TYPES` — throws `ValidationError`. The `Conversation`
  handle supplies it automatically: the first participant declaring a
  `subject_type` wins, otherwise `"chat"` (mirrors the C# client).
- `Subject` gained an optional `subject_type` field, preserved through
  the conversation roster.

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
