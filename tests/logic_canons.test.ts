/**
 * Logic Canon surface — /v1/logic-canons + /v1/logic/events (spec Phase 14.7).
 *
 * Drives every typed method through an injected fetch, asserting the wire
 * shape (method, path, snake_case body) and the camelCase mapping back.
 */
import { describe, expect, it } from "vitest";

import { DMZAgent, ValidationError } from "../src/index.js";

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function stubClient(responses: Array<{ status?: number; json?: unknown }>) {
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

  it("requires a name", async () => {
    const { cx } = stubClient([{}]);
    await expect(cx.createLogicCanon({ name: "" })).rejects.toBeInstanceOf(ValidationError);
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
    expect(calls[0].url).toBe("https://api.test/v1/logic-canons?status=published");
    expect(rows).toHaveLength(1);
    expect(rows[0].logicCanonId).toBe("lc_1");
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
      { json: { installs: [{ logic_canon_id: "lc_1", version: 1 }], total: 1 } },
      { json: { workspace_id: "ws_1", ok: false, broken: 1,
                installs: [{ logic_canon_id: "lc_1", status: "compile_error", detail: "x" }] } },
    ]);
    const installs = await cx.listWorkspaceLogicCanons("ws_1");
    const health = await cx.workspaceLogicCanonHealth("ws_1");
    expect(calls[0].url).toBe("https://api.test/v1/workspaces/ws_1/logic-canons");
    expect(calls[1].url).toBe("https://api.test/v1/workspaces/ws_1/logic-canons/health");
    expect(installs[0].logicCanonId).toBe("lc_1");
    expect(health.ok).toBe(false);
    expect(health.installs[0].status).toBe("compile_error");
  });
});

describe("the live logic door", () => {
  it("emits an event and maps the ack", async () => {
    const { cx, calls } = stubClient([
      { status: 202, json: {
        accepted: true, workspace_id: "ws_1", subject_id: "subject:d:s",
        n_logic_pass: 3, n_deferred: 0,
        fired: [{ rule_id: "hard" }],
        escalations: [{ rule_id: "creep", band: "enforce", lane: "enforce" }],
        dispositions: 1, emitted_frames: 0, expected_loss_avoided: 4000,
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
    expect(ack.fired[0].ruleId).toBe("hard");
    expect(ack.escalations[0].band).toBe("enforce");
    expect(ack.expectedLossAvoided).toBe(4000);
  });

  it("requires a canonical subject id on the event", async () => {
    const { cx } = stubClient([{}]);
    await expect(
      cx.emitLogicEvent({ workspaceId: "ws_1", event: { amount: 1 } }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
