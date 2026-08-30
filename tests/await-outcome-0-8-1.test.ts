/**
 * Spec 0.8.1: `awaitOutcome()` against the division-scoped story endpoint.
 *
 * Mirrors `contract-tests/outcome-vectors.json`. Kept here as well because
 * the request-shape assertion — that no `workspace_id` is sent, on every
 * request and not merely the first — is the whole point of the fix.
 *
 * What was wrong at 0.8.0, specifically in this SDK: the loop returned the
 * first response that parsed. The story endpoint answers 200 throughout the
 * fan-out, handing back traces as each workspace finishes, so that is a
 * half-finished story. (It also sent no `workspace_id`, which the endpoint
 * then required, so in practice the first request 422'd and the
 * ValidationError was rethrown immediately.)
 */
import { describe, expect, it } from "vitest";

import { DMZAgent, ServerError } from "../src/index.js";

const KEY = "ck_test_xxxxxxxxxxxxxxxxxxxxx";

type Trace = { trace_id: string; workspace_id: string; outcome: string };

function story(opts: {
  complete: boolean;
  outcome?: string | null;
  traces?: Trace[];
}) {
  const traces = opts.traces ?? [
    { trace_id: "trace_1", workspace_id: "ws_1", outcome: "applied" },
    { trace_id: "trace_2", workspace_id: "ws_2", outcome: "no_change" },
  ];
  const body: Record<string, unknown> = {
    frame_id: "frame_abc",
    subject_id: "subject:dv_test:acme-bot",
    division_id: "dv_test",
    workspace_id: null,
    workspace_ids: ["ws_1", "ws_2"],
    reasoning: traces,
    summary: {
      trace_count: traces.length,
      workspace_count: 2,
      complete: opts.complete,
    },
  };
  if (opts.outcome !== null) body["outcome"] = opts.outcome ?? "applied";
  return body;
}

/** Serves `pages` in order — the last repeats — and records every URL. */
function stub(pages: unknown[]) {
  const urls: string[] = [];
  let i = 0;
  const fetchImpl = async (url: string) => {
    urls.push(url);
    const body = pages[Math.min(i, pages.length - 1)];
    i += 1;
    return {
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  };
  const client = new DMZAgent({
    apiKey: KEY,
    fetch: fetchImpl as unknown as typeof fetch,
  });
  return { client, urls };
}

describe("spec 0.8.1: request shape", () => {
  it("sends no workspace_id", async () => {
    const { client, urls } = stub([story({ complete: true })]);
    await client.awaitOutcome({ frameId: "frame_abc", timeout: 5 });
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u).not.toContain("workspace_id");
  });

  it("polls the story path", async () => {
    const { client, urls } = stub([story({ complete: true })]);
    await client.awaitOutcome({ frameId: "frame_abc", timeout: 5 });
    expect(urls[0]).toContain("/v1/frames/frame_abc/story");
  });
});

describe("spec 0.8.1: termination", () => {
  it("returns once complete", async () => {
    const { client, urls } = stub([story({ complete: true })]);
    const res = await client.awaitOutcome({ frameId: "frame_abc", timeout: 5 });
    expect(res.complete).toBe(true);
    expect(urls.length).toBe(1);
  });

  it("keeps polling while incomplete", async () => {
    // The regression: this used to return the first page.
    const { client, urls } = stub([
      story({ complete: false, traces: [{ trace_id: "trace_1", workspace_id: "ws_1", outcome: "applied" }] }),
      story({ complete: true }),
    ]);
    const res = await client.awaitOutcome({ frameId: "frame_abc", timeout: 5 });
    expect(urls.length).toBe(2);
    expect(res.complete).toBe(true);
    expect(res.reasoning).toHaveLength(2);
  });

  it("times out rather than returning a partial story", async () => {
    const { client } = stub([
      story({ complete: false, traces: [{ trace_id: "trace_1", workspace_id: "ws_1", outcome: "applied" }] }),
    ]);
    await expect(
      client.awaitOutcome({ frameId: "frame_abc", timeout: 0.4 }),
    ).rejects.toThrow(ServerError);
  });
});

describe("spec 0.8.1: result shape", () => {
  it("reports the server fold verbatim", async () => {
    // `outcome` is folded server-side so four SDKs cannot reach four
    // answers. An SDK recomputing it from `reasoning` — say by taking the
    // first trace — would report "applied" here instead of "failed".
    const { client } = stub([
      story({
        complete: true,
        outcome: "failed",
        traces: [
          { trace_id: "trace_1", workspace_id: "ws_1", outcome: "applied" },
          { trace_id: "trace_2", workspace_id: "ws_2", outcome: "failed" },
        ],
      }),
    ]);
    const res = await client.awaitOutcome({ frameId: "frame_abc", timeout: 5 });
    expect(res.outcome).toBe("failed");
  });

  it("carries per-trace workspace ids", async () => {
    const { client } = stub([story({ complete: true })]);
    const res = await client.awaitOutcome({ frameId: "frame_abc", timeout: 5 });
    expect((res.reasoning ?? []).map(t => (t as Trace).workspace_id)).toEqual(["ws_1", "ws_2"]);
  });

  it("exposes the scope fields", async () => {
    const { client } = stub([story({ complete: true })]);
    const res = await client.awaitOutcome({ frameId: "frame_abc", timeout: 5 });
    expect(res.divisionId).toBe("dv_test");
    expect(res.workspaceIds).toEqual(["ws_1", "ws_2"]);
  });

  it("carries held through", async () => {
    // `held` joined the enum in 0.8.1; the server has emitted it since ST-8
    // while the spec listed four of the five values.
    const { client } = stub([
      story({
        complete: true,
        outcome: "held",
        traces: [{ trace_id: "trace_1", workspace_id: "ws_1", outcome: "held" }],
      }),
    ]);
    const res = await client.awaitOutcome({ frameId: "frame_abc", timeout: 5 });
    expect(res.outcome).toBe("held");
  });

  it("reports a missing outcome as null, not no_change", async () => {
    // It defaulted to "no_change", reporting a clean result for a frame
    // nothing had reasoned over. A missing value is not a benign one.
    const { client } = stub([story({ complete: true, outcome: null })]);
    const res = await client.awaitOutcome({ frameId: "frame_abc", timeout: 5 });
    expect(res.outcome).toBeNull();
  });
});
