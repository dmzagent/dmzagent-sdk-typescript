# Changelog

## [Unreleased]

## [0.11.0] — 2026-10-07 (spec 0.11.0)

### Added
- **Agent mode: a session governed one step at a time.** `agentStep()`
  sends an `intent`, a `call` (before the tool runs) or a `result` to
  `POST /v1/agent-stream/step` and returns a `StepResult` carrying the
  **directive** — `proceed`, `warn`, `hold`, `block` or `shutdown`.

  Branch on `result.runs`, which is `true` exactly for `proceed` and
  `warn`. A directive this SDK does not know is kept verbatim in
  `directive` and reads `runs: false`: an unknown word from the governor
  is not a yes. A step that cannot be sent, or whose answer cannot be
  read — including a 200 with no directive — throws, and the call must
  not run.

  A malformed step is refused locally with `ValidationError` and no
  request: an unknown `phase`, a `call` or `result` without `callId` or
  `tool`, a `result` without `status`, a refusal without `refusedBy`, a
  `refusedBy` on a call that was not refused, and an `intent` step
  without `intent`.

- **`agentSession()`** — an `AgentSession` handle bound to one session,
  with `intent()`, `call()`, `result()` and `refused()`. It holds its two
  ids and nothing else: it does not remember refusals and never infers
  `attemptOf`. `result()` takes `ok` or `error`; a call that did not run
  goes through `refused()`, which names who refused it — `governor`,
  `harness` or `host`. Report every refusal, including your harness's
  own: a rule an agent got around is visible only against the refusal it
  got around.

- **`listBehaviors()` / `iterBehaviors()`** — a subject's conduct record,
  positive and negative, newest first. `tag` is the installed canon's own
  word and is never mapped or described. One page per call, as with the
  approval and incident lists; only the filters you pass are sent. There
  is no method that removes or amends a behavior.

- **`getApproval()`** — one approval by id, so a caller holding a `hold`
  learns the decision without walking `listApprovals()`. An unknown id is
  a 404 and surfaces as `DMZAgentError`.

- `STEP_PHASES`, `DIRECTIVES`, and the `StepResult`, `Behavior` and
  `BehaviorPage` types, on the main entry point and on
  `@dmzagent/sdk/agent`.

### Changed
- **`Idempotency-Key` is accepted on every step and on every
  `AgentSession` method**, and is sent only when you pass one. It is
  RECOMMENDED on a `call` step: a harness that retries one must not have
  it counted as two attempts.
- The conformance runner drives `step-vectors.json` and the new
  golden-envelope vectors (`agent_step`, `list_behaviors`,
  `get_approval`).
- **Breaker states follow spec §2.2.** `hold` is documented as the state
  of a subject waiting on a person (`allow` false, `pendingApprovalId`
  names the approval). `allow` is still read from the wire; when the
  server omits it, `closed` and `half_open` allow and `hold` and `open`
  do not — until now an omitted `allow` always read `true`. A state this
  SDK does not know denies even when the wire says `allow: true`.
  `firedPolicies[].action` is typed `PolicyAction` (`allow` | `review` |
  `block` | `require_approval`, or the raw string); `anchor.ledger_event_id`
  is ignored, and remains in `raw`. Concordia's `CbStateChange.state`
  now includes `hold`.

### Notes
- **Webhooks.** The README's handler example read the signature from
  `DMZAgent-Signature`; the header is `X-DMZAgent-Signature`. The README
  now describes the envelope the server sends — `{api_version, kind,
  workspace_id, title, body, link, data, delivered_at}` — as spec 0.11.0
  §9.1 does. Verification is unchanged.

## [0.10.0] — 2026-09-30 (spec 0.10.0)

### Changed
- **Package version now tracks the spec version.** No API change from
  0.7.0; the package is renumbered so all four SDKs and the spec release
  together under one number. This is the first version published to the
  registry.

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
