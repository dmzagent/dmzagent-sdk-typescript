/**
 * Spec 0.8.0 additions: livemode, Idempotency-Key, and 409 -> ConflictError.
 *
 * The shared corpus reaches none of this — `golden-envelopes` exercises 5 of
 * the 15 methods in spec §5, and no fixture inspects a request header or a
 * response's `livemode` (see sdk-spec.md §11.1). These are SDK-local so the
 * three additions are pinned by something.
 */
import { describe, expect, it } from "vitest";

import {
  ConflictError,
  DMZAgent,
  ServerError,
  SPEC_VERSION,
} from "../src/index.js";

const KEY = "ck_test_xxxxxxxxxxxxxxxxxxxxx";

const FULL_ACK = {
  interaction_id: "int_1",
  subjects: ["user:ws:bot", "user:ws:cust"],
  frame_id: "frm_1",
  accepted: true,
  n_workspaces: 2,
  follow_my_data: "/v1/frames/frm_1/story",
};

/** Captures the outgoing request and replies with `body` at `status`. */
function stub(body: unknown, status = 200) {
  const seen: { headers?: Record<string, string> } = {};
  const fetchImpl = async (_url: string, init: RequestInit) => {
    seen.headers = init.headers as Record<string, string>;
    return {
      status,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  };
  const client = new DMZAgent({
    apiKey: KEY,
    fetch: fetchImpl as unknown as typeof fetch,
  });
  return { client, seen };
}

const say = (client: DMZAgent, extra: Record<string, unknown> = {}) =>
  client.subjectSays({
    subjectId: "user:ws:cust",
    subjectType: "chat",
    text: "hi",
    agentSubjectId: "user:ws:bot",
    ...extra,
  });

describe("spec 0.8.0: livemode", () => {
  it.each([
    [true, true],
    [false, false],
  ])("round-trips %s", async (wire, expected) => {
    const { client } = stub({ ...FULL_ACK, livemode: wire });
    expect((await say(client)).livemode).toBe(expected);
  });

  it("stays undefined when the server omits it", async () => {
    // Absent MUST NOT collapse to false. `false` is the positive claim
    // "this is test data"; asserting that about a response that never
    // carried the field is the confusion the signal exists to prevent.
    const { client } = stub(FULL_ACK);
    expect((await say(client)).livemode).toBeUndefined();
  });

  it("stays undefined for a non-boolean value", async () => {
    const { client } = stub({ ...FULL_ACK, livemode: "yes" });
    expect((await say(client)).livemode).toBeUndefined();
  });

  it("is exposed on CaptureResult too", async () => {
    const { client } = stub({ ...FULL_ACK, livemode: false });
    const result = await client.capture({
      subjectId: "user:ws:cust",
      kind: "observation",
      subjectType: "chat",
    });
    expect(result.livemode).toBe(false);
  });
});

describe("spec 0.8.0: Idempotency-Key", () => {
  it("is sent when the caller supplies one", async () => {
    const { client, seen } = stub(FULL_ACK);
    await say(client, { idempotencyKey: "idem-abc-123" });
    expect(seen.headers?.["Idempotency-Key"]).toBe("idem-abc-123");
  });

  it("is absent when the caller does not", async () => {
    // The SDK MUST NOT invent one (§1.8): a key minted per call is unique
    // per call and deduplicates nothing, and one derived from the payload
    // would collapse two genuinely distinct but identical events.
    const { client, seen } = stub(FULL_ACK);
    await say(client);
    expect(seen.headers?.["Idempotency-Key"]).toBeUndefined();
  });

  it("is forwarded by capture()", async () => {
    const { client, seen } = stub(FULL_ACK);
    await client.capture({
      subjectId: "user:ws:cust",
      kind: "observation",
      subjectType: "chat",
      idempotencyKey: "idem-cap-1",
    });
    expect(seen.headers?.["Idempotency-Key"]).toBe("idem-cap-1");
  });
});

describe("spec 0.8.0: 409 -> ConflictError", () => {
  it("raises ConflictError, not ServerError", async () => {
    const { client } = stub({ detail: "already processing" }, 409);
    const thrown = await say(client).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(ConflictError);
    expect((thrown as ConflictError).statusCode).toBe(409);
    // Not transient: the duplicate is the caller's own in-flight request.
    expect(thrown).not.toBeInstanceOf(ServerError);
  });
});

describe("spec 0.8.0: version pin", () => {
  it("has one source of truth shared with the User-Agent", async () => {
    // These were two independent constants and drifted: the exported one
    // read 0.8.0 while the User-Agent still said 0.6.0.
    const { client, seen } = stub(FULL_ACK);
    await say(client);
    expect(seen.headers?.["User-Agent"]).toBe(`dmzagent-typescript/${SPEC_VERSION}`);
  });
});
