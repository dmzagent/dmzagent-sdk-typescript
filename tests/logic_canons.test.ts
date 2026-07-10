/**
 * Logic Canon surface — /v1/logic-canons + /v1/logic/events (spec Phase 14.7).
 *
 * Drives every typed method through an injected fetch, asserting the wire
 * shape (method, path, snake_case body) and the camelCase mapping back.
 */
import { describe, expect, it } from "vitest";

import { DMZAgent, RateLimitError, ValidationError } from "../src/index.js";

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function stubClient(
  responses: Array<{ status?: number; json?: unknown; headers?: Record<string, string> }>,
) {
  const calls: Call[] = [];
  let i = 0;
  const fetch = async (url: string, init?: { method?: string; body?: string }) => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(init.body) : undefined,
    });
    const r = responses[Math.min(i++, responses.length - 1)] ?? {};
    return {
      status: r.status ?? 200,
      headers: new Headers(r.headers ?? {}),
      text: async () => JSON.stringify(r.json ?? {}),
    } as unknown as Response;
  };
  const cx = new DMZAgent({ apiKey: "ck_test", baseUrl: "https://api.test", fetch });
  return { cx, calls };
}

describe("logic canon authoring", () => {
  it("creates a draft canon", async () => {
    const { cx, calls } = stubClient([{ json: { logic_canon_id: "lc_1", name: "Ops", status: "draft" } }]);
    const canon = await cx.createLogicCanon({ name: "Ops", description: "d" });
    expect(calls[0]).toMatchObject({
      url: "https://api.test/v1/logic-canons",
      method: "POST",
      body: { name: "Ops", description: "d" },
    });
    expect(canon.logicCanonId).toBe("lc_1");
    expect(canon.status).toBe("draft");
  });

  it("requires a name (client-side precondition -> RangeError, spec §5)", async () => {
    const { cx } = stubClient([{}]);
    await expect(cx.createLogicCanon({ name: "" })).rejects.toBeInstanceOf(RangeError);
  });

  it("throws RangeError for other client-side preconditions", async () => {
    const { cx } = stubClient([{}]);
    await expect(cx.getLogicCanon("")).rejects.toBeInstanceOf(RangeError);
    await expect(
      cx.publishLogicCanonVersion({ logicCanonId: "lc_1", rulebook: null as never }),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(cx.getLogicCanonVersion("lc_1", 0)).rejects.toBeInstanceOf(RangeError);
    await expect(
      cx.installLogicCanon({ logicCanonId: "lc_1", workspaceId: "" }),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(cx.validateRulebook(null as never)).rejects.toBeInstanceOf(RangeError);
  });

  it("publishes a version and maps the wire shape", async () => {
    const { cx, calls } = stubClient([
      { json: { logic_canon_id: "lc_1", version: 3, n_rules: 2, published_at: "2026-07-03" } },
    ]);
    const v = await cx.publishLogicCanonVersion({
      logicCanonId: "lc_1",
      rulebook: { rules: [] },
      changelog: "tighten",
    });
    expect(calls[0]).toMatchObject({
      url: "https://api.test/v1/logic-canons/lc_1/versions",
      method: "POST",
      body: { rulebook: { rules: [] }, changelog: "tighten" },
    });
    expect(v.version).toBe(3);
    expect(v.nRules).toBe(2);
  });

  it("lists canons with a status filter", async () => {
    const { cx, calls } = stubClient([{ json: { logic_canons: [{ logic_canon_id: "lc_1" }] } }]);
    const rows = await cx.listLogicCanons({ status: "published" });
    expect(calls[0]!.url).toBe("https://api.test/v1/logic-canons?status=published");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.logicCanonId).toBe("lc_1");
  });

  it("validates a rulebook compile-only", async () => {
    const { cx, calls } = stubClient([
      { json: { valid: true, n_rules: 4, n_stateless: 3, n_stateful: 1 } },
    ]);
    const res = await cx.validateRulebook({ rules: [] });
    expect(calls[0]).toMatchObject({
      url: "https://api.test/v1/logic-canons/validate",
      method: "POST",
    });
    expect(res.valid).toBe(true);
    expect(res.nStateful).toBe(1);
  });
});

describe("install surface", () => {
  it("installs into a workspace with a pinned version", async () => {
    const { cx, calls } = stubClient([
      { json: { logic_canon_id: "lc_1", workspace_id: "ws_1", version: 2 } },
    ]);
    const inst = await cx.installLogicCanon({ logicCanonId: "lc_1", workspaceId: "ws_1", version: 2 });
    expect(calls[0]).toMatchObject({
      url: "https://api.test/v1/logic-canons/lc_1/install",
      method: "POST",
      body: { workspace_id: "ws_1", version: 2 },
    });
    expect(inst.version).toBe(2);
  });

  it("uninstalls via DELETE", async () => {
    const { cx, calls } = stubClient([{ json: { uninstalled: true } }]);
    await cx.uninstallLogicCanon({ logicCanonId: "lc_1", workspaceId: "ws_1" });
    expect(calls[0]).toMatchObject({
      url: "https://api.test/v1/logic-canons/lc_1/install/ws_1",
      method: "DELETE",
    });
  });

  it("reads workspace installs and health", async () => {
    const { cx, calls } = stubClient([
      // Wire renamed `total` -> `count` (spec 0.7.0); rows no longer
      // carry vendor_id.
      { json: { installs: [{ logic_canon_id: "lc_1", version: 1, status: "published" }], count: 1 } },
      { json: { workspace_id: "ws_1", ok: false, broken: 1,
                installs: [{ logic_canon_id: "lc_1", version: 1, slug: "ops",
                             name: "Ops", status: "compile_error", detail: "x" }] } },
    ]);
    const installs = await cx.listWorkspaceLogicCanons("ws_1");
    const health = await cx.workspaceLogicCanonHealth("ws_1");
    expect(calls[0]!.url).toBe("https://api.test/v1/workspaces/ws_1/logic-canons");
    expect(calls[1]!.url).toBe("https://api.test/v1/workspaces/ws_1/logic-canons/health");
    expect(installs[0]!.logicCanonId).toBe("lc_1");
    // Deploy record carries the lifecycle status...
    expect(installs[0]!.status).toBe("published");
    expect(health.ok).toBe(false);
    // ...while the health surface returns LogicInstallHealthRow with the
    // evaluation status + detail (model split, review §3 P6).
    expect(health.installs[0]!.status).toBe("compile_error");
    expect(health.installs[0]!.detail).toBe("x");
    expect(health.installs[0]!.slug).toBe("ops");
    expect(health.installs[0]!.raw).toMatchObject({ logic_canon_id: "lc_1", detail: "x" });
  });

  it("keeps the deploy record and health row as separate shapes", async () => {
    const { cx } = stubClient([
      { json: { logic_canon_id: "lc_1", workspace_id: "ws_1", version: 3,
                installed_by: "u_1", installed_at: "2026-07-10" } },
    ]);
    const inst = await cx.installLogicCanon({ logicCanonId: "lc_1", workspaceId: "ws_1" });
    expect(inst.installedBy).toBe("u_1");
    expect(inst.installedAt).toBe("2026-07-10");
    // LogicCanonInstall is the deploy record only — no health `detail`.
    expect("detail" in inst).toBe(false);
  });
});

describe("the live logic door", () => {
  it("emits an event and maps the ack", async () => {
    const { cx, calls } = stubClient([
      { status: 202, json: {
        accepted: true, workspace_id: "ws_1", subject_id: "subject:d:s",
        n_logic_pass: 3, n_deferred: 0,
        fired: [{ rule_id: "hard", weight: 2 }],
        escalations: [{ rule_id: "creep", band: "enforce", lane: "enforce", extra: "kept" }],
        dispositions: 1, emitted_frames: 0, expected_loss_avoided: 4000,
        degraded: false, responded: true, installs_evaluated: 4, installs_total: 4,
      } },
    ]);
    const ack = await cx.emitLogicEvent({
      workspaceId: "ws_1",
      event: { subject_id: "subject:d:s", amount: 50000 },
    });
    expect(calls[0]).toMatchObject({
      url: "https://api.test/v1/logic/events",
      method: "POST",
      body: { workspace_id: "ws_1", event: { subject_id: "subject:d:s", amount: 50000 } },
    });
    expect(ack.accepted).toBe(true);
    expect(ack.fired[0]!.ruleId).toBe("hard");
    // Named DTOs preserve the full wire item on raw (review §3.5).
    expect(ack.fired[0]!.raw).toEqual({ rule_id: "hard", weight: 2 });
    expect(ack.escalations[0]!.band).toBe("enforce");
    expect(ack.escalations[0]!.raw).toMatchObject({ extra: "kept" });
    expect(ack.expectedLossAvoided).toBe(4000);
    expect(ack.degraded).toBe(false);
    expect(ack.responded).toBe(true);
    expect(ack.installsEvaluated).toBe(4);
    expect(ack.installsTotal).toBe(4);
  });

  it("surfaces a degraded (fail-open) ack", async () => {
    const { cx } = stubClient([
      { status: 202, json: {
        accepted: true, workspace_id: "ws_1", subject_id: "subject:d:s",
        n_logic_pass: 1, n_deferred: 0, fired: [], escalations: [],
        dispositions: 0, emitted_frames: 0, expected_loss_avoided: 0,
        degraded: true, responded: false, installs_evaluated: 2, installs_total: 3,
      } },
    ]);
    const ack = await cx.emitLogicEvent({
      workspaceId: "ws_1", event: { subject_id: "subject:d:s" },
    });
    expect(ack.degraded).toBe(true);
    expect(ack.responded).toBe(false);
    expect(ack.installsEvaluated).toBe(2);
    expect(ack.installsTotal).toBe(3);
  });

  it("defaults degraded/responded/counters when the server omits them", async () => {
    const { cx } = stubClient([
      { status: 202, json: {
        accepted: true, workspace_id: "ws_1", subject_id: "subject:d:s",
        n_logic_pass: 1, n_deferred: 0, fired: [], escalations: [],
        dispositions: 0, emitted_frames: 0, expected_loss_avoided: 0,
      } },
    ]);
    const ack = await cx.emitLogicEvent({
      workspaceId: "ws_1", event: { subject_id: "subject:d:s" },
    });
    expect(ack.degraded).toBe(false);
    expect(ack.responded).toBe(false);
    expect(ack.installsEvaluated).toBe(0);
    expect(ack.installsTotal).toBe(0);
  });

  it("requires a canonical subject id on the event (RangeError, spec §5)", async () => {
    const { cx } = stubClient([{}]);
    await expect(
      cx.emitLogicEvent({ workspaceId: "ws_1", event: { amount: 1 } }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it("maps 422 to ValidationError with the status code", async () => {
    const { cx } = stubClient([
      { status: 422, json: { detail: "logic evaluation failed", error: "validation_error" } },
    ]);
    const err = await cx
      .emitLogicEvent({ workspaceId: "ws_1", event: { subject_id: "subject:d:s" } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).statusCode).toBe(422);
  });

  it("maps 429 with Retry-After to RateLimitError carrying retryAfter", async () => {
    const { cx } = stubClient([
      { status: 429, headers: { "Retry-After": "30" },
        json: { detail: "rate cap reached (10/10 this window)", error: "rate_limited" } },
    ]);
    const err = await cx
      .emitLogicEvent({ workspaceId: "ws_1", event: { subject_id: "subject:d:s" } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).statusCode).toBe(429);
    expect((err as RateLimitError).retryAfter).toBe(30);
  });

  it("maps 429 without Retry-After to RateLimitError with retryAfter null", async () => {
    const { cx } = stubClient([
      { status: 429, json: { detail: "rate cap reached", error: "rate_limited" } },
    ]);
    const err = await cx
      .emitLogicEvent({ workspaceId: "ws_1", event: { subject_id: "subject:d:s" } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfter).toBeNull();
  });

  it("treats an unparseable Retry-After as null", async () => {
    const { cx } = stubClient([
      { status: 429, headers: { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" },
        json: { detail: "rate cap reached" } },
    ]);
    const err = await cx
      .emitLogicEvent({ workspaceId: "ws_1", event: { subject_id: "subject:d:s" } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfter).toBeNull();
  });
});
