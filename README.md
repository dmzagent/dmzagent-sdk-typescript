# @dmzagent/sdk

The TypeScript SDK for **DMZAgent** — the codex of trust between minds.

DMZAgent indexes how AI agents (and any other subject of study) reveal
themselves, predicts how they'll move under conditions, and gates their
actions through auditable circuit breakers. This SDK is the
customer-facing surface: emit conversation events, check whether a
subject is still in good standing, and let your operators write policy
in one place.

This binding implements **spec version 0.5.0**. Naming follows the
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

Every event method also requires `subjectType` — one of
`EVENT_SUBJECT_TYPES` (`"chat"`, `"sensor"`, `"lead"`, `"ticket"`,
`"journey"`) — which selects the trace pattern used for grouping and
deviation evaluation (spec §5.1). The `Conversation` handle supplies it
for you, derived from the participant roster (defaulting to `"chat"`).

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
  subjectType:    "chat",
  text:           "I want a refund.",
  subjects: [bot, customer],
});
const iid = result.interactionId;

await cx.toolCall({
  interactionId: iid,
  subjectId:     bot.subject_id,
  subjectType:   "chat",
  tool:          "refund.issue",
  args:          { amount: 9900 },
});

// CB check
const g = await cx.check({ subjectId: bot.subject_id });
if (!g.allow) {
  return refuse(g.reason);
}
```

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

## Errors

| Exception | When |
|---|---|
| `AuthError`        | API key missing / invalid / revoked |
| `PermissionError`  | API key valid but scope insufficient |
| `ValidationError`  | Server returned 400 — payload malformed (also thrown at construction when `apiKey` doesn't start with `ck_`, and on invalid SDK args) |
| `ServerError`      | Server returned 5xx, network error, or timeout — safe to retry with backoff |
| `CBOpenError`      | Circuit breaker open — action must not proceed |

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
  const header = req.headers.get("DMZAgent-Signature") ?? "";
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

## Resource lifecycle

The client itself has no persistent transport state — `close()` is
exposed for parity with the spec's resource-lifecycle contract (§4.3)
and reserved for a future keep-alive pool. Calling `close()` more than
once is a no-op.

## Versioning

This package pins to spec version **0.5.0**. The pin is recorded in
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
