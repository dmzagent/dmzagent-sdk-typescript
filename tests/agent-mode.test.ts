/**
 * Agent mode (spec §1.9, §2.11–§2.13, §5.22–§5.25, 0.11.0).
 *
 * What these hold, and why each is here rather than an assertion that
 * merely passes:
 *
 *   - Every local check of §5.22 refuses *before any request*. The tests
 *     assert the stub saw nothing, because a server-side 400 would also
 *     throw and would say nothing about where the check lives.
 *   - `runs` is true for exactly two words. An unknown directive — or a
 *     known one in the wrong case — does not run, and its raw word is kept.
 *   - An unanswered step throws rather than returning something a caller
 *     could misread, including a 200 whose body has no directive.
 *   - `Idempotency-Key` travels only when the caller passed one. The SDK
 *     never mints a key: one per call deduplicates nothing.
 *   - The session handle holds its two ids and nothing else: after a
 *     refusal, the next call carries no `attempt_of` the caller did not say.
 *   - The conduct record is one page per call, walked lazily on request,
 *     and has no method that edits it.
 */
import { describe, expect, it } from "vitest";

import {
  AgentSession,
  DIRECTIVES,
  DMZAgent,
  DMZAgentError,
  EVENT_KINDS,
  STEP_PHASES,
  ServerError,
  ValidationError,
  type AgentStepOptions,
} from "../src/index.js";
import { stepResultFromResponse } from "../src/models.js";
import { makeStubTransport, type StubTransport } from "./helpers.js";

const KEY = "ck_test_agent_mode";
const AGENT = "subject:dv:agent-a";
const SESSION = "sess_4b1e";

function answer(directive: string, over: Record<string, unknown> = {}) {
  return {
    frame_id: "fr_7c21",
    interaction_id: SESSION,
    directive,
    scope: directive === "proceed" ? null : "interaction",
    reason: directive === "proceed" ? "" : "remote writes are the runner's",
    approval_id: directive === "hold" ? "apr_9" : null,
    settled: true,
    behaviors: [],
    anchor: { ledger_index: 40311, hash: "c0d9" },
    livemode: false,
    ...over,
  };
}

function behaviorRecord(id: string, over: Record<string, unknown> = {}) {
  return {
    behavior_id: id,
    subject_id: AGENT,
    interaction_id: SESSION,
    tag: "circumvention",
    polarity: "negative",
    strength: 0.82,
    source: "reasoning",
    evidence: ["fr_7b90", "fr_7c21"],
    calls: ["call_12", "call_14"],
    observed_at: "2026-10-07T15:02:11Z",
    anchor: { ledger_index: 40312, hash: "77ab" },
    ...over,
  };
}

const RUNAWAY_AFTER = 5;

/** Serve each body in turn, repeating the last — then refuse (see approvals). */
function serving(...bodies: unknown[]): StubTransport {
  const stub = makeStubTransport({ status: 200, body: bodies[0] ?? {} });
  const inner = stub.fetch;
  let n = 0;
  stub.fetch = (async (url: unknown, init: unknown) => {
    n += 1;
    if (n > bodies.length + RUNAWAY_AFTER) {
      throw new Error(
        `unbounded pagination: ${n} requests for ${bodies.length} scripted page(s)`,
      );
    }
    stub.setResponse({ status: 200, body: bodies[Math.min(n - 1, bodies.length - 1)] });
    return inner(url as never, init as never);
  }) as typeof stub.fetch;
  return stub;
}

function clientOver(stub: StubTransport): DMZAgent {
  return new DMZAgent({ apiKey: KEY, fetch: stub.fetch });
}

function step(over: Partial<AgentStepOptions>): AgentStepOptions {
  return {
    agentSubjectId: AGENT,
    interactionId: SESSION,
    phase: "call",
    callId: "call_7",
    tool: "Bash",
    ...over,
  } as AgentStepOptions;
}

function header(stub: StubTransport, i: number, name: string): string | undefined {
  const h = stub.captured[i]!.headers;
  const k = Object.keys(h).find((x) => x.toLowerCase() === name.toLowerCase());
  return k === undefined ? undefined : h[k];
}

// ------------------------------------------------------------------ //
// The constants
// ------------------------------------------------------------------ //

describe("agent-mode constants", () => {
  it("names the phases and directives, and leaves EVENT_KINDS alone", () => {
    expect([...STEP_PHASES]).toEqual(["intent", "call", "result"]);
    expect([...DIRECTIVES]).toEqual(["proceed", "warn", "hold", "block", "shutdown"]);
    // A step is not an event kind; it has its own endpoint (spec §8.6).
    expect([...EVENT_KINDS]).toEqual([
      "subject_says", "tool_call", "tool_result", "observation",
    ]);
  });
});

// ------------------------------------------------------------------ //
// agentStep: the wire
// ------------------------------------------------------------------ //

describe("agentStep sends the step", () => {
  it("posts a call step with only the fields given", async () => {
    const stub = serving(answer("proceed"));
    const r = await clientOver(stub).agentStep(
      step({ args: { command: "git push origin HEAD" } }),
    );
    expect(stub.captured.length).toBe(1);
    const req = stub.captured[0]!;
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/v1/agent-stream/step");
    expect(req.body).toEqual({
      agent_subject_id: AGENT,
      interaction_id: SESSION,
      phase: "call",
      call_id: "call_7",
      tool: "Bash",
      args: { command: "git push origin HEAD" },
    });
    // A step is an agent_session by definition; the kind is not sent.
    expect(req.body as object).not.toHaveProperty("interaction_kind");
    expect(r.runs).toBe(true);
  });

  it("sends a refusal's refusedBy, reason and attemptOf verbatim", async () => {
    const stub = serving(answer("proceed"));
    await clientOver(stub).agentStep(step({
      phase: "result", callId: "call_9", status: "refused",
      refusedBy: "harness", reason: "remote writes are the runner's", attemptOf: "call_7",
    }));
    expect(stub.captured[0]!.body).toEqual({
      agent_subject_id: AGENT, interaction_id: SESSION, phase: "result",
      call_id: "call_9", tool: "Bash", status: "refused", refused_by: "harness",
      reason: "remote writes are the runner's", attempt_of: "call_7",
    });
  });

  it("sends an intent, occurredAt and metadata", async () => {
    const stub = serving(answer("proceed"));
    await clientOver(stub).agentStep({
      agentSubjectId: AGENT, interactionId: SESSION, phase: "intent",
      intent: { text: "Add a trace id.", paths: ["src/obs/"], tools: ["Edit"] },
      occurredAt: "2026-10-07T15:00:00Z", metadata: { run: 3 },
    });
    expect(stub.captured[0]!.body).toEqual({
      agent_subject_id: AGENT, interaction_id: SESSION, phase: "intent",
      intent: { text: "Add a trace id.", paths: ["src/obs/"], tools: ["Edit"] },
      occurred_at: "2026-10-07T15:00:00Z", metadata: { run: 3 },
    });
  });
});

// ------------------------------------------------------------------ //
// agentStep: refused locally, before any round trip (spec §5.22)
// ------------------------------------------------------------------ //

describe("agentStep refuses a malformed step before any request", () => {
  const cases: Array<[string, AgentStepOptions, RegExp]> = [
    ["no agentSubjectId", step({ agentSubjectId: "" }), /agentSubjectId/],
    ["no interactionId", step({ interactionId: undefined as never }), /interaction/],
    ["an unknown phase", step({ phase: "plan" as never }), /phase/],
    ["a call without callId", step({ callId: undefined }), /callId/],
    ["a call without tool", step({ tool: undefined }), /tool/],
    ["a result without callId",
      step({ phase: "result", status: "ok", callId: undefined }), /callId/],
    ["a result without tool",
      step({ phase: "result", status: "ok", tool: undefined }), /tool/],
    ["a result without status", step({ phase: "result" }), /status/],
    ["a refusal without refusedBy",
      step({ phase: "result", status: "refused" }), /refusedBy.*refused/],
    ["refusedBy on a call that ran",
      step({ phase: "result", status: "ok", refusedBy: "host" }), /refused/],
    ["refusedBy on a call step",
      step({ phase: "call", refusedBy: "governor" }), /refused/],
    ["an intent step without intent",
      { agentSubjectId: AGENT, interactionId: SESSION, phase: "intent" }, /intent/],
    ["an intent without text",
      { agentSubjectId: AGENT, interactionId: SESSION, phase: "intent",
        intent: { paths: ["src/"] } as never }, /intent/],
  ];

  for (const [name, opts, message] of cases) {
    it(`refuses ${name}`, async () => {
      const stub = serving(answer("proceed"));
      let thrown: unknown = null;
      try {
        await clientOver(stub).agentStep(opts);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(ValidationError);
      expect(String((thrown as Error).message)).toMatch(message);
      // The assertion that matters: the mistake is the harness's, and the
      // failure lands there rather than in a server round trip.
      expect(stub.captured.length, `${name} must not reach the wire`).toBe(0);
    });
  }
});

// ------------------------------------------------------------------ //
// Reading the answer: may this call run?
// ------------------------------------------------------------------ //

describe("StepResult.runs", () => {
  for (const [directive, runs] of [
    ["proceed", true], ["warn", true],
    ["hold", false], ["block", false], ["shutdown", false],
  ] as const) {
    it(`${directive} → runs ${runs}`, async () => {
      const r = await clientOver(serving(answer(directive))).agentStep(step({}));
      expect(r.directive).toBe(directive);
      expect(r.runs).toBe(runs);
    });
  }

  it("an unknown directive is read as block, and its word is kept", async () => {
    const r = await clientOver(serving(answer("quarantine"))).agentStep(step({}));
    expect(r.directive).toBe("quarantine");
    expect(r.runs).toBe(false);
  });

  it("a running word in another case is not that word", async () => {
    for (const word of ["Proceed", "WARN", " proceed"]) {
      expect(stepResultFromResponse(answer(word)).runs, word).toBe(false);
    }
  });

  it("hold names its approval", async () => {
    const r = await clientOver(serving(answer("hold"))).agentStep(step({}));
    expect(r.approvalId).toBe("apr_9");
    expect(r.runs).toBe(false);
  });

  it("parses every field, and keeps an unknown polarity raw", () => {
    const r = stepResultFromResponse(answer("block", {
      settled: false,
      behaviors: [{
        tag: "kept-its-word", polarity: "neutral", strength: 0.4,
        source: "logic", evidence: ["fr_0"], calls: [],
      }],
    }));
    expect(r.frameId).toBe("fr_7c21");
    expect(r.interactionId).toBe(SESSION);
    expect(r.scope).toBe("interaction");
    expect(r.reason).toBe("remote writes are the runner's");
    expect(r.settled).toBe(false);
    expect(r.anchor).toEqual({ ledger_index: 40311, hash: "c0d9" });
    expect(r.livemode).toBe(false);
    const b = r.behaviors[0]!;
    expect(b.tag).toBe("kept-its-word");
    expect(b.polarity).toBe("neutral");
    expect(b.source).toBe("logic");
    expect(b.calls).toEqual([]);
    // Record fields belong to the conduct record, not to a step's answer.
    expect(b).not.toHaveProperty("behaviorId");
    expect(b).not.toHaveProperty("observedAt");
  });

  it("an absent livemode is null and an absent settled is not settled", () => {
    const body: Record<string, unknown> = answer("proceed");
    delete body["livemode"];
    delete body["settled"];
    const r = stepResultFromResponse(body);
    expect(r.livemode).toBeNull();
    expect(r.settled).toBe(false);
  });

  it("the result is immutable", () => {
    const r = stepResultFromResponse(answer("block", {
      behaviors: [behaviorRecord("bhv_1")],
    }));
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.behaviors)).toBe(true);
    expect(Object.isFrozen(r.behaviors[0])).toBe(true);
    expect(Object.isFrozen(r.behaviors[0]!.evidence)).toBe(true);
    expect(Object.isFrozen(r.raw)).toBe(true);
  });
});

// ------------------------------------------------------------------ //
// An unanswered step is not a yes
// ------------------------------------------------------------------ //

describe("an unanswered step throws", () => {
  it("a 503 is a ServerError, not a result", async () => {
    const stub = makeStubTransport({ status: 503, body: { detail: "unavailable" } });
    await expect(clientOver(stub).agentStep(step({}))).rejects.toThrow(ServerError);
  });

  it("a network failure is a ServerError", async () => {
    const cx = new DMZAgent({
      apiKey: KEY,
      fetch: (async () => { throw new TypeError("fetch failed"); }) as never,
    });
    await expect(cx.agentStep(step({}))).rejects.toThrow(ServerError);
  });

  for (const [name, body] of [
    ["no directive", { frame_id: "fr_1", interaction_id: SESSION }],
    ["an empty directive", answer("")],
    ["a body that is not JSON", "<html>ok</html>"],
  ] as const) {
    it(`a 200 with ${name} throws rather than answering`, async () => {
      const stub = makeStubTransport({ status: 200, body });
      let returned: unknown = undefined;
      let thrown: unknown = null;
      try {
        returned = await clientOver(stub).agentStep(step({}));
      } catch (e) {
        thrown = e;
      }
      expect(returned).toBeUndefined();
      expect(thrown).toBeInstanceOf(ServerError);
    });
  }
});

// ------------------------------------------------------------------ //
// Idempotency: the caller's key or none
// ------------------------------------------------------------------ //

describe("Idempotency-Key on a step", () => {
  it("is sent when the caller passes one", async () => {
    const stub = serving(answer("proceed"));
    await clientOver(stub).agentStep(step({ idempotencyKey: "harness-call_7-1" }));
    expect(header(stub, 0, "Idempotency-Key")).toBe("harness-call_7-1");
  });

  it("is never generated", async () => {
    const stub = serving(answer("proceed"));
    const cx = clientOver(stub);
    await cx.agentStep(step({}));
    await cx.agentStep(step({}));
    const s = cx.agentSession({ agentSubjectId: AGENT, interactionId: SESSION });
    await s.intent("x");
    await s.call("call_8", "Read");
    await s.result("call_8", "Read", "ok");
    await s.refused("call_9", "Bash", "host");
    expect(stub.captured.length).toBe(6);
    for (let i = 0; i < stub.captured.length; i++) {
      expect(header(stub, i, "Idempotency-Key"), `request ${i}`).toBeUndefined();
    }
  });

  it("every session method passes it through", async () => {
    const stub = serving(answer("proceed"));
    const s = clientOver(stub).agentSession({ agentSubjectId: AGENT, interactionId: SESSION });
    await s.intent("x", { idempotencyKey: "k1" });
    await s.call("c", "T", { idempotencyKey: "k2" });
    await s.result("c", "T", "error", { idempotencyKey: "k3" });
    await s.refused("c", "T", "governor", { idempotencyKey: "k4" });
    expect([0, 1, 2, 3].map((i) => header(stub, i, "Idempotency-Key")))
      .toEqual(["k1", "k2", "k3", "k4"]);
  });
});

// ------------------------------------------------------------------ //
// The session handle
// ------------------------------------------------------------------ //

describe("agentSession", () => {
  it("each method sends its own phase on the session's two ids", async () => {
    const stub = serving(answer("proceed"));
    const s = clientOver(stub).agentSession({ agentSubjectId: AGENT, interactionId: SESSION });
    expect(s).toBeInstanceOf(AgentSession);
    expect(s.agentSubjectId).toBe(AGENT);
    expect(s.interactionId).toBe(SESSION);

    await s.intent("Add a trace id.", { paths: ["src/obs/"], tools: ["Edit", "Bash"] });
    await s.call("call_7", "Bash", { args: { command: "ls" }, attemptOf: "call_6" });
    await s.result("call_7", "Bash", "ok", { result: "a\nb", reason: "listed" });
    await s.refused("call_8", "Bash", "host", { reason: "sandbox", attemptOf: "call_7" });

    const base = { agent_subject_id: AGENT, interaction_id: SESSION };
    expect(stub.captured.map((r) => r.body)).toEqual([
      { ...base, phase: "intent",
        intent: { text: "Add a trace id.", paths: ["src/obs/"], tools: ["Edit", "Bash"] } },
      { ...base, phase: "call", call_id: "call_7", tool: "Bash",
        args: { command: "ls" }, attempt_of: "call_6" },
      { ...base, phase: "result", call_id: "call_7", tool: "Bash", status: "ok",
        result: "a\nb", reason: "listed" },
      { ...base, phase: "result", call_id: "call_8", tool: "Bash", status: "refused",
        refused_by: "host", reason: "sandbox", attempt_of: "call_7" },
    ]);
  });

  it("holds no state beyond its two ids: it infers no attemptOf", async () => {
    const stub = serving(answer("block"), answer("proceed"));
    const s = clientOver(stub).agentSession({ agentSubjectId: AGENT, interactionId: SESSION });
    const r = await s.call("call_7", "Bash", { args: { command: "git push" } });
    expect(r.runs).toBe(false);
    await s.refused("call_7", "Bash", "governor");
    await s.call("call_8", "Bash", { args: { command: "git push" } });
    // The same command after a refusal is the caller's to call a retry.
    expect(stub.captured[2]!.body as object).not.toHaveProperty("attempt_of");
    // No enumerable state, and nothing that remembers a refusal.
    expect(Object.keys(s)).toEqual([]);
  });

  it("result() refuses a refusal and points at refused(), before any request", async () => {
    const stub = serving(answer("proceed"));
    const s = clientOver(stub).agentSession({ agentSubjectId: AGENT, interactionId: SESSION });
    await expect(
      s.result("call_7", "Bash", "refused" as never),
    ).rejects.toThrow(/refused\(\)/);
    expect(stub.captured.length).toBe(0);
  });

  it("the session methods inherit every local check", async () => {
    const stub = serving(answer("proceed"));
    const s = clientOver(stub).agentSession({ agentSubjectId: AGENT, interactionId: SESSION });
    await expect(s.call("", "Bash")).rejects.toThrow(ValidationError);
    await expect(s.refused("call_7", "Bash", undefined as never)).rejects.toThrow(/refused/);
    expect(stub.captured.length).toBe(0);
  });

  for (const [name, opts] of [
    ["agentSubjectId", { agentSubjectId: "", interactionId: SESSION }],
    ["interactionId", { agentSubjectId: AGENT, interactionId: "" }],
  ] as const) {
    it(`refuses a session without ${name}`, () => {
      const cx = clientOver(serving(answer("proceed")));
      expect(() => cx.agentSession(opts)).toThrow(ValidationError);
    });
  }
});

// ------------------------------------------------------------------ //
// The conduct record (spec §2.12)
// ------------------------------------------------------------------ //

describe("listBehaviors", () => {
  it("sends no filter it was not given, and does not follow the cursor", async () => {
    const stub = serving({ behaviors: [behaviorRecord("bhv_1")], next_cursor: "c2" });
    const page = await clientOver(stub).listBehaviors({ subjectId: AGENT });
    expect(stub.captured.length, "one page means one request").toBe(1);
    const req = stub.captured[0]!;
    expect(req.method).toBe("GET");
    expect(req.body).toBeNull();
    // The subject id travels in the path as written, colons and all.
    expect(req.path).toBe(`/v1/subjects/${AGENT}/behaviors`);
    expect([...new URL(req.url).searchParams.keys()]).toEqual([]);
    expect(page.nextCursor).toBe("c2");
    expect(page.behaviors.length).toBe(1);
  });

  it("passes every filter and the cursor", async () => {
    const stub = serving({ behaviors: [], next_cursor: null });
    await clientOver(stub).listBehaviors({
      subjectId: AGENT, polarity: "negative", interactionId: SESSION,
      since: "2026-10-01T00:00:00Z", until: "2026-10-08T00:00:00Z",
      limit: 10, cursor: "eyJpIjo0MH0",
    });
    expect(
      Object.fromEntries(new URL(stub.captured[0]!.url).searchParams.entries()),
    ).toEqual({
      polarity: "negative", interaction_id: SESSION,
      since: "2026-10-01T00:00:00Z", until: "2026-10-08T00:00:00Z",
      limit: "10", cursor: "eyJpIjo0MH0",
    });
  });

  it("encodes what a path segment cannot carry", async () => {
    const stub = serving({ behaviors: [] });
    await clientOver(stub).listBehaviors({ subjectId: "subject:dv:a/b c" });
    expect(stub.captured[0]!.path).toBe("/v1/subjects/subject:dv:a%2Fb%20c/behaviors");
  });

  it("parses the record fields", async () => {
    const stub = serving({ behaviors: [behaviorRecord("bhv_19ac")], next_cursor: null });
    const b = (await clientOver(stub).listBehaviors({ subjectId: AGENT })).behaviors[0]!;
    expect(b.behaviorId).toBe("bhv_19ac");
    expect(b.subjectId).toBe(AGENT);
    expect(b.interactionId).toBe(SESSION);
    expect(b.observedAt).toBe("2026-10-07T15:02:11Z");
    expect(b.anchor).toEqual({ ledger_index: 40312, hash: "77ab" });
    expect(b.tag).toBe("circumvention");
    expect(b.strength).toBe(0.82);
    expect(b.evidence).toEqual(["fr_7b90", "fr_7c21"]);
    expect(b.calls).toEqual(["call_12", "call_14"]);
  });

  for (const bad of [0, -1, 101, 500, 2.5, NaN]) {
    it(`refuses limit=${bad} before the round trip`, async () => {
      const stub = serving({ behaviors: [] });
      await expect(
        clientOver(stub).listBehaviors({ subjectId: AGENT, limit: bad }),
      ).rejects.toThrow(/limit/);
      expect(stub.captured.length).toBe(0);
    });
  }

  it("refuses a missing subjectId before the round trip", async () => {
    const stub = serving({ behaviors: [] });
    await expect(
      clientOver(stub).listBehaviors({ subjectId: "" }),
    ).rejects.toThrow(ValidationError);
    expect(stub.captured.length).toBe(0);
  });

  it("the record has no method that edits it", () => {
    for (const forbidden of [
      "deleteBehavior", "removeBehavior", "amendBehavior", "updateBehavior",
    ]) {
      expect(
        (DMZAgent.prototype as unknown as Record<string, unknown>)[forbidden],
        forbidden,
      ).toBeUndefined();
    }
  });
});

describe("iterBehaviors", () => {
  it("fetches a page only when asked past the one it holds, following the cursor", async () => {
    const stub = serving(
      { behaviors: [behaviorRecord("bhv_1"), behaviorRecord("bhv_2")], next_cursor: "c2" },
      { behaviors: [behaviorRecord("bhv_3")], next_cursor: null },
    );
    const it_ = clientOver(stub).iterBehaviors({ subjectId: AGENT, polarity: "negative" });

    expect((await it_.next()).value?.behaviorId).toBe("bhv_1");
    expect(stub.captured.length, "the first item must not have fetched page two").toBe(1);
    await it_.next();
    expect(stub.captured.length).toBe(1);
    expect((await it_.next()).value?.behaviorId).toBe("bhv_3");
    expect(stub.captured.length).toBe(2);
    const second = new URL(stub.captured[1]!.url).searchParams;
    expect(second.get("cursor")).toBe("c2");
    expect(second.get("polarity"), "the filters survive the walk").toBe("negative");
    expect((await it_.next()).done).toBe(true);
    expect(stub.captured.length, "a null cursor must end the walk").toBe(2);
  });

  it("breaking out never requests the next page", async () => {
    const stub = serving({ behaviors: [behaviorRecord("bhv_1")], next_cursor: "c2" });
    for await (const _b of clientOver(stub).iterBehaviors({ subjectId: AGENT })) break;
    expect(stub.captured.length).toBe(1);
  });
});

// ------------------------------------------------------------------ //
// getApproval (spec §2.13)
// ------------------------------------------------------------------ //

describe("getApproval", () => {
  it("reads one approval by id", async () => {
    const stub = serving({
      approval_id: "apr_9", status: "approved", subject_id: AGENT,
      interaction_id: SESSION, frame_id: "fr_7c21",
      action: { tool: "Bash", args: { command: "git push" } },
      reason: "needs a person", fired_policies: [],
      requested_at: "2026-10-07T15:00:00Z", expires_at: "2026-10-07T15:15:00Z",
      on_expiry: "decline", anchor: null,
      decision: {
        decision: "approve", actor_id: "acct_1", actor_label: null,
        reason: null, decided_at: "2026-10-07T15:01:00Z",
      },
    });
    const a = await clientOver(stub).getApproval("apr_9");
    expect(stub.captured.length).toBe(1);
    expect(stub.captured[0]!.method).toBe("GET");
    expect(stub.captured[0]!.path).toBe("/v1/approvals/apr_9");
    expect(stub.captured[0]!.body).toBeNull();
    expect(a.status).toBe("approved");
    expect(a.decision?.actorId).toBe("acct_1");
    expect(a.action.tool).toBe("Bash");
  });

  it("an unknown id is a 404, surfaced as DMZAgentError", async () => {
    const stub = makeStubTransport({ status: 404, body: { detail: "not found" } });
    let thrown: unknown = null;
    try {
      await clientOver(stub).getApproval("apr_missing");
    } catch (e) {
      thrown = e;
    }
    // Exactly the base type: no not-found type exists (spec §2.13, §3), and
    // a 404 is neither transient nor the caller's malformed payload.
    expect((thrown as Error)?.constructor).toBe(DMZAgentError);
    expect((thrown as DMZAgentError).statusCode).toBe(404);
    expect((thrown as DMZAgentError).body).toEqual({ detail: "not found" });
  });

  it("refuses a missing id rather than asking another route", async () => {
    const stub = serving({});
    await expect(clientOver(stub).getApproval("")).rejects.toThrow(ValidationError);
    expect(stub.captured.length).toBe(0);
  });
});
