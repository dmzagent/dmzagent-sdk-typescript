# @dmzagent/sdk

The TypeScript SDK for **DMZAgent** — the codex of trust between minds.

DMZAgent indexes how AI agents (and any other subject of study) reveal
themselves, predicts how they'll move under conditions, and gates their
actions through auditable circuit breakers. This SDK is the
customer-facing surface: emit conversation events, check whether a
subject is still in good standing, and let your operators write policy
in one place.

This binding implements **spec version 0.11.0**. Naming follows the
canonical map in `sdk-spec.md` §8 (camelCase methods, `…Error`
exceptions, `DMZAgent` as the client class).

## Install

```bash
npm install @dmzagent/sdk
```

Node 18.17+ is required. The package ships ESM + CJS dual builds and
its own `.d.ts` types.

## Quickstart

```ts
import { DMZAgent, CBOpenError, subjectForDivision } from "@dmzagent/sdk";

const cx = new DMZAgent({ apiKey: "ck_..." }); // get one from your tenant_admin
const divisionId = "dv_...";
const bot = subjectForDivision(divisionId, "checkout bot", { role: "agent", kind: "agent" });
const customer = subjectForDivision(divisionId, "customer anon", { role: "customer", kind: "human" });

const conv = cx.conversation({
  participants: [bot, customer],
});

await conv.says(customer.subject_id, "I want a refund.");
await conv.says(bot.subject_id, "I can help with that.");

// Before doing something sensitive, check the breaker. The `using`
// declaration releases the handle when the block exits.
{
  using g = await conv.guard(bot.subject_id, { raiseOnOpen: true });
  await conv.toolCall(
    bot.subject_id,
    "refund.issue",
    { amount: 9900 },
  );
}
```

A single `says()` call per utterance — the same method regardless of
who's speaking. `participants` is a list of `{subject_id, role, kind}`
objects; the subject_id is the only discriminator. No human/agent
distinction baked into the API; that line lives only in the roster the
caller supplies.

## Concepts

**Subject.** An identifiable noun: an AI agent, a human customer, a
sensor, an institution. Each has a stable `subject_id` and a soul that
DMZAgent builds up from observed behavior.

**Interaction.** Anything that involves multiple subjects together —
a chat session, a transaction chain, a video feed. Events stamp an
`interactionId` so the full participant list and timeline is
recoverable.

**Circuit breaker.** A subject's current standing: `closed` (allow),
`half_open` (allow with warning), `open` (block). State is a function
of the subject's soul evaluated against your workspace's policies.

## Event kinds

The SDK emits one of four canonical event kinds:

| Method | Wire kind | What it means |
|---|---|---|
| `subjectSays(...)` | `subject_says` | An utterance — the speaker is named via `subjectId` |
| `toolCall(...)`    | `tool_call`    | An agent invoked a tool — payload carries `tool` + `args` |
| `toolResult(...)`  | `tool_result`  | A tool returned a result — payload carries `tool` + `result` |
| `observation(...)` | `observation`  | Generic structured event (video keyframe, IoT, etc.) |

The constant `EVENT_KINDS` exposes these as a `readonly` tuple. The
on-wire `kind` string is always the snake_case form regardless of how
the SDK exposes the enum (spec §8.6).

## Low-level API

The `Conversation` handle is sugar over the lower-level client, which
you can use directly when conversations don't fit the
one-agent-one-customer shape:

```ts
import { DMZAgent, subjectForDivision } from "@dmzagent/sdk";

const cx = new DMZAgent({ apiKey: "ck_..." });
const bot = subjectForDivision("dv_...", "checkout bot", { role: "agent", kind: "agent" });
const customer = subjectForDivision("dv_...", "customer anon", { role: "customer", kind: "human" });

const result = await cx.subjectSays({
  agentSubjectId: bot.subject_id,
  subjectId:      customer.subject_id,
  text:           "I want a refund.",
  subjects: [bot, customer],
});
const iid = result.interactionId;

await cx.toolCall({
  interactionId: iid,
  subjectId:     bot.subject_id,
  tool:          "refund.issue",
  args:          { amount: 9900 },
});

// CB check
const g = await cx.check({ subjectId: bot.subject_id });
if (!g.allow) {
  return refuse(g.reason);
}
```

## Agent mode

An agent session is an interaction whose subject acts on its own: it
calls tools, and something has to let each call run or refuse it. Agent
mode governs that one step at a time. Each step gets an answer in the
same response, and the answer says what you do next.

```ts
const s = cx.agentSession({
  agentSubjectId: "subject:dv:agent-a",
  interactionId:  "sess_4b1e",        // yours, stable for the session's life
});

await s.intent("Add a trace id to every request.", {
  paths: ["src/obs/"],
  tools: ["Edit", "Bash"],
});

const r = await s.call("call_7", "Bash", {
  args: { command: "git push origin HEAD" },
  idempotencyKey: "sess_4b1e/call_7",  // recommended on a call; never generated
});

if (r.runs) {
  const out = await runBash("git push origin HEAD");
  await s.result("call_7", "Bash", "ok", { result: out });
} else {
  await s.refused("call_7", "Bash", "governor", { reason: r.reason });
}
```

Send the `call` step **before** the tool runs, and run it only when
`r.runs` is true.

| `directive` | `runs`  | You                                                         |
|-------------|---------|-------------------------------------------------------------|
| `proceed`   | `true`  | run the call                                                |
| `warn`      | `true`  | run it; DMZAgent is watching, and you may tell the agent so |
| `hold`      | `false` | wait on `r.approvalId` with `getApproval()`; approved runs, anything else is `block` |
| `block`     | `false` | do not run the call; the session carries on                 |
| `shutdown`  | `false` | do not run the call, and end the session                    |
| anything else | `false` | a directive this SDK does not know is read as `block`; the word is kept in `directive` |

**An unanswered step is not a yes.** If the step cannot be sent, or its
answer cannot be read — a network failure, a 5xx, a 200 with no
directive — `agentStep()` throws, and the call must not run.

**Refusals are reported, whoever refused.** Every call that did not run
goes through `refused()`, naming who refused it: `governor` (DMZAgent's
directive), `harness` (your runner's own rules) or `host` (the tool,
sandbox or operating system). A rule an agent got around is recognisable
only against the refusal it got around, so a harness that drops its own
refusals hides exactly the attempts this mode exists to see. If you know
a call retries an earlier one, say so with `attemptOf`; the session
handle never guesses.

`agentStep()` is the same thing without the handle. Either way, a
malformed step is refused locally with `ValidationError` and no request:
an unknown `phase`, a `call` or `result` without `callId` or `tool`, a
`result` without `status`, a refusal without `refusedBy`, a `refusedBy`
on a call that was not refused, or an `intent` step without `intent`.

### What the agent's conduct showed

Every `StepResult` carries the `behaviors` observed in the session so
far, each with a `polarity` (`positive` or `negative`), a `strength`, the
`source` that observed it (`logic` at once, `reasoning` possibly later —
`settled: false` says more may come), and the frames that are its
`evidence`. The conduct record is readable on its own:

```ts
const page = await cx.listBehaviors({
  subjectId:     "subject:dv:agent-a",
  polarity:      "negative",
  interactionId: "sess_4b1e",
});

for await (const b of cx.iterBehaviors({ subjectId: "subject:dv:agent-a" })) {
  console.log(b.tag, b.polarity, b.strength, b.evidence);
}
```

`tag` is the installed canon's own word, in the words of whoever wrote
it; the SDK does not map, rename or describe it. `strength` is what the
subject's soul holds for that tag now, and falls as the soul lets it go.
There is no method that removes or amends a behavior: the record is
corrected by correcting the soul.

## Circuit breaker

Two shapes, same engine.

### Result-style (inspect the boolean)

```ts
const g = await cx.check({ subjectId: "subject:dv_demo:bot" });
if (!g.allow) {
  logForReview(g.reason, g.firedPolicies, g.anchor);
  return;
}
```

### Disposable / `using` style

`guard()` returns a disposable handle whose `.result` is the
`CheckResult`. The `using` declaration releases the handle on scope
exit. Requires TypeScript 5.2+ and Node 22+ for the syntax to compile
and run; falls back gracefully on older runtimes via the callback
form below.

```ts
{
  using g = await cx.guard({ subjectId: "subject:dv_demo:bot" });
  if (!g.result.allow) return refuse(g.result.reason);
  // ...sensitive action
}
```

### Exception-style (try/catch seam)

```ts
try {
  using g = await cx.guard({
    subjectId: "subject:dv_demo:bot",
    raiseOnOpen: true,
  });
  await doSensitiveThing();
} catch (e) {
  if (e instanceof CBOpenError) {
    logBlocked(e.reason, e.scopeRef, e.anchor);
  } else {
    throw e;
  }
}
```

### Callback fallback

For runtimes that don't yet have explicit-resource-management, pass a
callback as the second argument:

```ts
await cx.guard(
  { subjectId: "subject:dv_demo:bot", raiseOnOpen: true },
  async (result) => {
    if (!result.allow) return refuse(result.reason);
    await doSensitiveThing();
  },
);
```

Default-allow: an unknown subject id returns `closed` / `allow=true`.
The breaker only fires once policies match a subject's actual behavior.

## Human-in-the-loop approvals

A circuit-breaker policy can fire with action `require_approval`, which
**holds** the action instead of refusing it. `check()` then hands back a
denial that names what it is waiting on:

```ts
const g = await cx.check({ subjectId: "subject:dv:checkout-bot" });

if (g.awaitingApproval) {
  showMyOwnApprovalScreen(g.pendingApprovalId);   // asked
} else if (!g.allow) {
  return refuse(g.reason);                        // refused
}
```

That is the whole difference between a breaker and a human-in-the-loop
control, and it is one field because you have to branch on it.

### You render it. All of it.

```ts
for await (const a of cx.iterApprovals({ status: "pending" })) {
  console.log(a.action.tool, a.action.args);  // the held call, verbatim
  console.log(a.reason);                      // your operator's policy words
  console.log(a.expiresAt);                   // decide before this
}
```

Nothing in an `Approval` is display text we wrote. `reason` and each
`firedPolicies[].name` are the words your operator typed when they wrote
the policy, and `action` is the call your agent was about to make. There
is no message for your end user, no copy of ours, and no branding —
because a sentence we wrote would read identically in every customer's
product, which is the thing this is designed to avoid.

### A decision records which human made it

```ts
await cx.approveApproval({
  approvalId: "apr_7f3c9a1b",
  actorId:    "acct_4471",           // your identifier, not ours
  actorLabel: "Dana R.",
  reason:     "verified the order by phone",
});
```

`actorId` is required, never defaulted, and never derived from the API
key — the key identifies your integration, and an approval whose actor is
the integration that requested it has recorded nobody. We resolve it
against no directory, so your users never need an account here. An empty
one throws `ValidationError` before any request goes out.

Two operators who click at the same moment produce one decision and one
`ConflictError`; `err.body.status` says what the approval had already
become. That is not a retry — the call did not fail, it lost.

**An approval that nobody answers declines.** `onExpiry` is always
`decline` and there is no setting that changes it: an approval that
becomes an allow because nobody looked at it is not a human-in-the-loop
control, it is a delay with extra steps.

## The incident and remediation ledger

`anchor` has been on `CheckResult` for several releases, pointing into a
ledger nothing could open. Now it opens:

```ts
const g = await cx.check({ subjectId: "subject:dv:checkout-bot" });
const recorded = g.anchor;      // { ledger_index: 40197, hash: "b1c4…" }

for await (const inc of cx.iterIncidents({
  status: "open",
  since: "2026-09-01T00:00:00Z",
})) {
  if (inc.anchor?.ledger_index === recorded?.ledger_index) {
    // this is the entry your check was told about
  }
}
```

Every breaker that opened, every approval decided, every remediation that
ran — newest ledger entry first, in the order the ledger recorded them
rather than by timestamp, because two entries written in the same second
still have an order.

The ledger is **append-only**. There is no `closeIncident()` and no method
that edits an entry: an incident reaches `remediated` because a
remediation was appended to it, and `status` is a fold over what has been
appended. An incident with no remediations is the normal shape of
something nobody has answered yet.

### Reading one approval

`getApproval(approvalId)` reads one approval by id — how a caller holding
a `hold` directive learns whether it was approved without walking the
list. An unknown id is a 404 and throws `DMZAgentError`.

### Paging

`listApprovals()`, `getIncidents()` and `listBehaviors()` return one page
and do not follow `nextCursor`. You asked for 25 and you get 25 — a
method that quietly walked every page would turn one bounded request into
an unbounded one against a record that only grows. `iterApprovals()`,
`iterIncidents()` and `iterBehaviors()` do the walk lazily: `break` out of
the loop and the next page is never requested.

## Errors

| Exception | When |
|---|---|
| `AuthError`        | API key missing / invalid / revoked |
| `PermissionError`  | API key valid but scope insufficient |
| `ValidationError`  | Server returned 400 — payload malformed (also thrown at construction when `apiKey` doesn't start with `ck_`, and on invalid SDK args) |
| `ConflictError`    | 409 — an `Idempotency-Key` request is still in flight, or an approval was already decided or expired; not a retry |
| `RateLimitError`   | 429 — `retryAfter` carries the server's `Retry-After` seconds; the SDK never sleeps or retries for you |
| `ServerError`      | Server returned 5xx, network error, or timeout — safe to retry with backoff |
| `CBOpenError`      | Circuit breaker open — action must not proceed |
| `DMZAgentError`    | Any other status, e.g. a 404 from `getApproval()` for an unknown id |

All inherit from `DMZAgentError`, so a single `catch (e instanceof
DMZAgentError)` covers production failure modes. Every error exposes
`statusCode` and `body`; `CBOpenError` additionally carries `reason`,
`firedPolicies`, `anchor`, and `scopeRef`.

The underlying network or parse error is preserved via the ES2022
`Error.cause` mechanism.

## Webhook signature verification

DMZAgent signs every outbound webhook with HMAC-SHA256 over
`<unix_seconds>.<payload>`, where the secret is the subscription's
signing key. Verify in your handler:

```ts
import { verifyWebhookSignature } from "@dmzagent/sdk";

export async function handler(req: Request): Promise<Response> {
  const payload = await req.text();
  const header = req.headers.get("X-DMZAgent-Signature") ?? "";
  const ok = verifyWebhookSignature(
    payload,
    header,
    process.env.DMZAGENT_WEBHOOK_SECRET!,
  );
  if (!ok) return new Response("bad signature", { status: 401 });
  // ...handle the event
  return new Response("ok");
}
```

The default tolerance is 300 seconds — adjust with the fourth argument
if your environment has more clock drift. The verifier returns `false`
for malformed, expired, or mismatched signatures; it never throws.

### What a delivery carries

Every webhook POST is one JSON object:

```json
{
  "api_version":  "2026-05-30",
  "kind":         "approval.requested",
  "workspace_id": "ws_xxx",
  "title":        "",
  "body":         "",
  "link":         null,
  "data":         { },
  "delivered_at": "2026-06-10T12:00:00.000Z"
}
```

Read `kind` and `data`. `data` is the event's object: an `Approval` for
`approval.requested` / `approval.decided`, an `Incident` for
`incident.opened` / `incident.remediated`, a `Behavior` (as
`listBehaviors()` returns it) for `behavior.observed`, a review for the
`review.*` events, and an outcome for `outcome.completed`. For every one
of these, `title` and `body` are empty and `link` is null — the
envelope carries no presentation, and you render the event in your own
words. Earlier versions of the spec described a CloudEvents envelope;
the server never sent one.

Each POST also carries `X-DMZAgent-Event` (the `kind`),
`X-DMZAgent-Delivery` (the same on every retry — deduplicate on it) and
`X-DMZAgent-Attempt`. Answer a `kind` you do not know with a 2xx and
ignore it: a non-2xx is retried, and repeated failures disable the
subscription.

**A missed webhook must not become an approval.** Delivery is
at-least-once and not guaranteed. An approval's `expiresAt` runs
regardless, and expiry declines. If you build only on
`approval.requested` and never read `listApprovals()`, held actions can
quietly expire — safe, but invisible. Poll the list as well.

## Configuration

```ts
const cx = new DMZAgent({
  apiKey:    "ck_...",
  baseUrl:   "https://api.dmzagent.com", // override for staging / on-prem
  timeout:   10_000,                       // per-request milliseconds
  userAgent: "my-app/1.2.3",               // appears in server-side audit logs
});
```

The default base URL is `https://api.dmzagent.com`. For local
development or staging:

- Staging: `https://staging.api.eastern-shore-solutions.com`
- Local:   `http://localhost:8080`

### Circuit-breaker state cache

`check()` is a network round trip, and it usually sits in front of the
sensitive action. A per-client cache removes it for repeated checks on
the same subject. It is off unless you set a TTL:

```ts
const cx = new DMZAgent({
  apiKey:            "ck_...",
  cbCacheTtl:        5_000,        // milliseconds; 0 (the default) is off
  cbCacheMaxEntries: 1024,         // bounded, least-recently-used evicted
  cbCacheOnError:    "last_known", // or "raise" (default)
});

const r = await cx.check({ subjectId: "subject:dv:bot" });
r.cached;      // served from memory?
r.cacheAgeMs;  // how old it was
r.stale;       // served because the check itself failed

await cx.check({ subjectId: "subject:dv:bot", fresh: true }); // skip and refresh
```

Read the TTL as **the longest a newly-opened breaker can go unnoticed by
this client**. A cached `closed` is an allow the server might no longer
give, which is why the cache is opt-in and why every result says whether
it came from memory and how old it was.

One TTL covers every state. Holding a deny longer than an allow is a
safety policy, and it is yours to make with the number you pass.

`cbCacheOnError: "last_known"` serves the last state for that subject —
marked `stale` — when the check cannot reach the server. With no entry
for that subject it throws, and it needs a TTL above zero to be set at
all. A `429` is not covered: that is the server answering, and it carries
a `retryAfter` worth acting on.

## Resource lifecycle

The client itself has no persistent transport state — `close()` is
exposed for parity with the spec's resource-lifecycle contract (§4.3)
and reserved for a future keep-alive pool. Calling `close()` more than
once is a no-op.

## Versioning

This package pins to spec version **0.11.0**. The pin is recorded in
`package.json` under `dmzagent.specVersion` and verified by CI on
every push.

Pre-1.0, MINOR bumps MAY include breaking wire changes; PATCH bumps
remain backwards-compatible at both API and wire level. See
`dmzagent-sdk-spec/sdk-spec.md` §11 for the full versioning policy.

## Concordia MCP client (`@dmzagent/sdk/concordia`)

Concordia is DMZAgent's governance MCP server — customer agents
speak [MCP 1.0](https://modelcontextprotocol.io/) to it to enforce
covenants, record audit decisions, query installed Canons, and read
soul snapshots on subjects under observation.

The package ships a typed client for it alongside the agent-stream
surface. Subpath export for tree-shaking:

```ts
import { ConcordiaClient } from "@dmzagent/sdk/concordia";

const client = new ConcordiaClient({ apiKey: process.env.DMZAGENT_API_KEY! });

// Pre-flight check — does policy allow this action?
const v = await client.enforceCovenant({
  subjectId:     "user:alice",
  actionKind:    "payment.issue",
  actionPayload: { amount: 9900, currency: "usd" },
  context:       { sessionId: "s_42", model: "claude-sonnet-4-6" },
});
if (v.verdict === "block") return safeFallback(v.rationale);

// Audit record after the fact
await client.recordDecision({
  subjectId:    "user:alice",
  decisionKind: "payment_issued",
  payload:      { refundId: "re_123", amount: 9900 },
  outcome:      "completed",
});

// Read installed policy Canons (cacheable at session start)
for (const p of await client.workspacePolicies()) {
  console.log(p.name, p.action, p.enabled);
}

// Search Canons for relevant policy text
const r = await client.queryCorpus({ query: "how do we handle refund pressure?" });
for (const m of r.matches) console.log(`${m.canonId}/${m.section}: ${m.excerpt}`);

// Stream through the workspace's audit chain
for await (const entry of client.iterLedger({ since: 0, limit: 100 })) {
  verify(entry.prevHash, entry.hash, entry.payload);
}
```

Errors map 1:1 to the MCP spec §8 codes:
`ConcordiaAuthError`, `ConcordiaQuotaExceededError`,
`ConcordiaPolicyEngineUnavailableError`,
`ConcordiaCanonNotInstalledError`,
`ConcordiaSubjectNotFoundError`,
`ConcordiaCircuitOpenError`,
`ConcordiaPermissionDeniedError`. All extend `ConcordiaError`, so
`catch (e) { if (e instanceof ConcordiaError) ... }` covers every
failure mode.

Under TypeScript 5.2+ with explicit-resource-management:

```ts
await using client = new ConcordiaClient({ apiKey: "ck_..." });
await client.enforceCovenant({ ... });
// `client` is disposed at scope exit
```

See [`CONCORDIA_MCP.md`](https://github.com/praeceptor-thesis/dmzagent-sdk-spec/blob/main/CONCORDIA_MCP.md)
for the underlying protocol specification.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
