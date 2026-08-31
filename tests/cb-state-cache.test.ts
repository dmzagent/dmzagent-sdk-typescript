/**
 * The circuit-breaker state cache (sdk-spec.md §4.4).
 *
 * `check()` is a network round trip in front of a sensitive action. The
 * cache removes it for repeated checks on the same subject, and the whole
 * reason to be careful is that a cached `closed` is an allow the server
 * might no longer give.
 *
 * The rules these tests hold:
 *
 *   - off unless the caller sets a TTL — a caching safety check nobody
 *     asked for is worse than a slow one;
 *   - a served entry always says it was served, and how old it was, so a
 *     caller recording a denial can tell it read stale state;
 *   - one TTL for every state: holding a deny longer than an allow is a
 *     safety policy that belongs to whoever set the TTL;
 *   - `subject` and `interaction` with the same id are different keys;
 *   - the map is bounded, because the key is a subject id;
 *   - errors are never cached, and `last_known` is opt-in, marked, and
 *     unreachable without a TTL to fall back on.
 */
import { describe, expect, it } from "vitest";

import { DMZAgent } from "../src/client.js";
import { CBStateCache } from "../src/cbCache.js";
import { CBOpenError, RateLimitError, ServerError, ValidationError } from "../src/errors.js";
import { checkResultFromResponse } from "../src/models.js";

const KEY = "ck_test_cache";

function closedBody(): Record<string, unknown> {
  return {
    state: "closed",
    allow: true,
    warning: false,
    reason: "no policies fired",
    fired_policies: [],
    anchor: null,
    checked_at: "2026-08-31T00:00:00Z",
    latency_ms: 12.3,
    route_latency_ms: 18.7,
  };
}

function openBody(): Record<string, unknown> {
  return {
    state: "open",
    allow: false,
    warning: false,
    reason: "policy fired",
    fired_policies: [{ cb_policy_id: "p1", name: "n", action: "block" }],
    anchor: null,
    checked_at: "2026-08-31T00:00:00Z",
    latency_ms: 9.1,
    route_latency_ms: 11,
  };
}

type Step = Record<string, unknown> | Error | { status: number; headers?: Record<string, string> };

/** A fetch stub that counts calls and serves a queue of outcomes. */
function transport(...steps: Step[]) {
  const queue: Step[] = steps.length > 0 ? steps : [closedBody()];
  const state = { calls: 0 };
  const fetchLike = async (): Promise<Response> => {
    state.calls += 1;
    const step = queue[Math.min(state.calls - 1, queue.length - 1)]!;
    if (step instanceof Error) throw step;
    if (typeof (step as { status?: number }).status === "number") {
      const s = step as { status: number; headers?: Record<string, string> };
      return new Response(JSON.stringify({ detail: "no" }), {
        status: s.status,
        headers: { "content-type": "application/json", ...(s.headers ?? {}) },
      });
    }
    return new Response(JSON.stringify(step), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { state, fetchLike };
}

function client(t: ReturnType<typeof transport>, opts: Record<string, unknown> = {}): DMZAgent {
  return new DMZAgent({ apiKey: KEY, fetch: t.fetchLike as never, ...opts });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------------- //

describe("the cache is off unless asked for", () => {
  it("every check is a round trip by default", async () => {
    const t = transport();
    const cx = client(t);
    for (let i = 0; i < 3; i += 1) await cx.check({ subjectId: "user:ws:a" });
    expect(t.state.calls).toBe(3);
  });

  it("a default client reports no caching on its results", async () => {
    const cx = client(transport());
    const r = await cx.check({ subjectId: "user:ws:a" });
    expect([r.cached, r.cacheAgeMs, r.stale]).toEqual([false, 0, false]);
  });

  it("fresh is harmless with the cache off", async () => {
    const t = transport();
    await client(t).check({ subjectId: "user:ws:a", fresh: true });
    expect(t.state.calls).toBe(1);
  });
});

describe("serving from the cache", () => {
  it("a second check inside the ttl makes no request", async () => {
    const t = transport();
    const cx = client(t, { cbCacheTtl: 60_000 });
    await cx.check({ subjectId: "user:ws:a" });
    await cx.check({ subjectId: "user:ws:a" });
    expect(t.state.calls).toBe(1);
  });

  it("a served entry says so and carries its age", async () => {
    const cx = client(transport(), { cbCacheTtl: 60_000 });
    await cx.check({ subjectId: "user:ws:a" });
    await sleep(10);
    const second = await cx.check({ subjectId: "user:ws:a" });
    expect(second.cached).toBe(true);
    expect(second.stale).toBe(false);
    expect(second.cacheAgeMs).toBeGreaterThanOrEqual(5);
  });

  it("the server's own numbers are not rewritten", async () => {
    const cx = client(transport(), { cbCacheTtl: 60_000 });
    const fresh = await cx.check({ subjectId: "user:ws:a" });
    const cached = await cx.check({ subjectId: "user:ws:a" });
    expect(cached.latencyMs).toBe(fresh.latencyMs);
    expect(cached.routeLatencyMs).toBe(fresh.routeLatencyMs);
    expect(cached.checkedAt).toBe(fresh.checkedAt);
    expect(cached.raw).toEqual(fresh.raw);
  });

  it("the decision itself survives the round trip", async () => {
    const cx = client(transport(openBody()), { cbCacheTtl: 60_000 });
    const first = await cx.check({ subjectId: "user:ws:a" });
    const second = await cx.check({ subjectId: "user:ws:a" });
    expect(second.state).toBe(first.state);
    expect(second.allow).toBe(false);
    expect(second.firedPolicies).toEqual(first.firedPolicies);
  });

  it("an expired entry is not served", async () => {
    const t = transport();
    const cx = client(t, { cbCacheTtl: 20 });
    await cx.check({ subjectId: "user:ws:a" });
    await sleep(50);
    const again = await cx.check({ subjectId: "user:ws:a" });
    expect(t.state.calls).toBe(2);
    expect(again.cached).toBe(false);
  });

  it("fresh bypasses the cache and replaces it", async () => {
    const t = transport(closedBody(), openBody());
    const cx = client(t, { cbCacheTtl: 60_000 });
    expect((await cx.check({ subjectId: "user:ws:a" })).allow).toBe(true);
    const forced = await cx.check({ subjectId: "user:ws:a", fresh: true });
    expect(t.state.calls).toBe(2);
    expect(forced.allow).toBe(false);
    expect(forced.cached).toBe(false);
    expect((await cx.check({ subjectId: "user:ws:a" })).allow).toBe(false);
  });

  it("guard passes fresh through", async () => {
    const t = transport();
    const cx = client(t, { cbCacheTtl: 60_000 });
    await cx.guard({ subjectId: "user:ws:a" });
    await cx.guard({ subjectId: "user:ws:a", fresh: true });
    expect(t.state.calls).toBe(2);
  });

  it("guard raises on a cached open the same as a fresh one", async () => {
    const cx = client(transport(openBody()), { cbCacheTtl: 60_000 });
    await cx.check({ subjectId: "user:ws:a" });
    await expect(
      cx.guard({ subjectId: "user:ws:a", raiseOnOpen: true }),
    ).rejects.toBeInstanceOf(CBOpenError);
  });
});

describe("one ttl for every state", () => {
  for (const [name, body] of [["closed", closedBody()], ["open", openBody()]] as const) {
    it(`allow and deny expire together (${name})`, async () => {
      const t = transport(body as Record<string, unknown>);
      const cx = client(t, { cbCacheTtl: 20 });
      await cx.check({ subjectId: "user:ws:a" });
      expect((await cx.check({ subjectId: "user:ws:a" })).cached).toBe(true);
      await sleep(50);
      expect((await cx.check({ subjectId: "user:ws:a" })).cached).toBe(false);
      expect(t.state.calls).toBe(2);
    });
  }
});

describe("keys", () => {
  it("subject and interaction with the same id do not collide", async () => {
    const t = transport();
    const cx = client(t, { cbCacheTtl: 60_000 });
    await cx.check({ subjectId: "x" });
    await cx.check({ interactionId: "x" });
    expect(t.state.calls).toBe(2);
  });

  it("different subjects are cached separately", async () => {
    const t = transport(closedBody(), openBody());
    const cx = client(t, { cbCacheTtl: 60_000 });
    expect((await cx.check({ subjectId: "a" })).allow).toBe(true);
    expect((await cx.check({ subjectId: "b" })).allow).toBe(false);
    expect((await cx.check({ subjectId: "a" })).allow).toBe(true);
  });

  it("a scope prefix cannot be confused with a subject id", () => {
    expect(CBStateCache.key("subject", "a")).not.toBe(CBStateCache.key("subjecta", ""));
  });
});

describe("the cache is bounded", () => {
  it("least recently used is evicted", () => {
    const cache = new CBStateCache(60_000, 2);
    const r = checkResultFromResponse(closedBody());
    cache.put("a", r);
    cache.put("b", r);
    cache.get("a"); // touch a, so b is now oldest
    cache.put("c", r);
    expect(cache.size).toBe(2);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBeDefined();
    expect(cache.get("c")).toBeDefined();
  });

  it("a client's own cache is bounded, observed through its requests", async () => {
    // The client's cache is private, so the bound is asserted by its only
    // visible consequence: an evicted subject costs another round trip.
    const t = transport();
    const cx = client(t, { cbCacheTtl: 60_000, cbCacheMaxEntries: 2 });
    await cx.check({ subjectId: "a" });
    await cx.check({ subjectId: "b" });
    await cx.check({ subjectId: "c" });
    expect(t.state.calls).toBe(3);

    // `a` was evicted when `c` arrived; `b` and `c` are still held.
    const evicted = await cx.check({ subjectId: "a" });
    expect(t.state.calls).toBe(4);
    expect(evicted.cached).toBe(false);
    expect((await cx.check({ subjectId: "c" })).cached).toBe(true);
    expect(t.state.calls).toBe(4);
  });

  it("a max below one is refused", () => {
    expect(() => new CBStateCache(60_000, 0)).toThrow(RangeError);
  });
});

describe("when the check fails", () => {
  it("raise is the default and matches a client with no cache", async () => {
    const t = transport(closedBody(), new TypeError("fetch failed"));
    const cx = client(t, { cbCacheTtl: 60_000 });
    await cx.check({ subjectId: "user:ws:a" });
    await expect(
      cx.check({ subjectId: "user:ws:a", fresh: true }),
    ).rejects.toBeInstanceOf(ServerError);
  });

  it("last_known serves the previous state marked stale", async () => {
    const t = transport(openBody(), new TypeError("fetch failed"));
    const cx = client(t, { cbCacheTtl: 60_000, cbCacheOnError: "last_known" });
    await cx.check({ subjectId: "user:ws:a" });
    const served = await cx.check({ subjectId: "user:ws:a", fresh: true });
    expect(served.cached).toBe(true);
    expect(served.stale).toBe(true);
    expect(served.allow).toBe(false);
  });

  it("last_known serves an expired entry too", async () => {
    const t = transport(openBody(), new TypeError("fetch failed"));
    const cx = client(t, { cbCacheTtl: 20, cbCacheOnError: "last_known" });
    await cx.check({ subjectId: "user:ws:a" });
    await sleep(50);
    const served = await cx.check({ subjectId: "user:ws:a" });
    expect(served.stale).toBe(true);
    expect(served.allow).toBe(false);
  });

  it("last_known with nothing known raises", async () => {
    const t = transport(new TypeError("fetch failed"));
    const cx = client(t, { cbCacheTtl: 60_000, cbCacheOnError: "last_known" });
    await expect(cx.check({ subjectId: "never-seen" })).rejects.toBeInstanceOf(ServerError);
  });

  it("a failure is never itself cached", async () => {
    const t = transport(closedBody(), new TypeError("fetch failed"), openBody());
    const cx = client(t, { cbCacheTtl: 60_000, cbCacheOnError: "last_known" });
    await cx.check({ subjectId: "user:ws:a" });
    await cx.check({ subjectId: "user:ws:a", fresh: true }); // fails, serves stale
    const third = await cx.check({ subjectId: "user:ws:a", fresh: true }); // recovers
    expect(third.cached).toBe(false);
    expect(third.allow).toBe(false);
  });

  it("a rate limit is an answer and is not masked", async () => {
    const t = transport(closedBody(), { status: 429, headers: { "retry-after": "30" } });
    const cx = client(t, { cbCacheTtl: 60_000, cbCacheOnError: "last_known" });
    await cx.check({ subjectId: "user:ws:a" });
    await expect(
      cx.check({ subjectId: "user:ws:a", fresh: true }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });
});

describe("configuration", () => {
  it("an unknown error policy is refused by name", () => {
    expect(() =>
      client(transport(), { cbCacheOnError: "fail_open" }),
    ).toThrow(ValidationError);
  });

  it("last_known without a ttl is refused", () => {
    expect(() =>
      client(transport(), { cbCacheOnError: "last_known" }),
    ).toThrow(/cbCacheTtl/);
  });

  it("a zero ttl disables the cache rather than caching forever", async () => {
    const t = transport();
    const cx = client(t, { cbCacheTtl: 0 });
    await cx.check({ subjectId: "user:ws:a" });
    await cx.check({ subjectId: "user:ws:a" });
    expect(t.state.calls).toBe(2);
  });
});
