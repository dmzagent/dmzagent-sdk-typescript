/**
 * The white-label approval control and the readable ledger (spec §2.8–§2.10).
 *
 * What these hold, and why each is here rather than an assertion that
 * merely passes:
 *
 *   - `actorId` is refused locally and before any round trip. The point of
 *     a human-in-the-loop control is that a person is on the other end, and
 *     an approval whose actor is the integration that requested it records
 *     nobody. The test asserts *no request was made*, because a server-side
 *     rejection would also throw and would tell us nothing about where the
 *     check lives.
 *   - A settled or expired approval is `ConflictError`, not a retry. The
 *     call did not fail, it lost.
 *   - Expiry declines, and `onExpiry` cannot be talked into anything else
 *     by a server that sends something else.
 *   - Neither list method follows a cursor on its own; the generators do,
 *     and only when the consumer asks for the next item.
 *   - There is no method that closes an incident, because the ledger has no
 *     endpoint for one.
 */
import { describe, expect, it } from "vitest";

import { DMZAgent } from "../src/client.js";
import { ConflictError, ValidationError } from "../src/errors.js";
import { approvalFromResponse, checkResultFromResponse } from "../src/models.js";
import { makeStubTransport, type StubTransport } from "./helpers.js";

const KEY = "ck_test_approvals";

function approvalBody(status = "pending", over: Record<string, unknown> = {}) {
  return {
    approval_id: "apr_7f3c9a1b",
    status,
    subject_id: "subject:dv:checkout-bot",
    interaction_id: "ix_2b8e",
    frame_id: "fr_91ac",
    action: { tool: "refund.issue", args: { amount_cents: 9900 } },
    reason: "refund above the reviewed ceiling",
    fired_policies: [
      { cb_policy_id: "cbp_11", name: "refund ceiling", action: "require_approval" },
    ],
    requested_at: "2026-09-09T12:00:00Z",
    expires_at: "2026-09-09T12:15:00Z",
    on_expiry: "decline",
    anchor: { ledger_index: 40197, hash: "b1c4" },
    decision: null,
    ...over,
  };
}

function incidentBody(over: Record<string, unknown> = {}) {
  return {
    incident_id: "inc_5d2a70",
    status: "remediated",
    kind: "cb_open",
    subject_id: "subject:dv:checkout-bot",
    frame_id: "fr_91ac",
    opened_at: "2026-09-09T11:58:02Z",
    closed_at: "2026-09-09T12:04:31Z",
    reason: "refund above the reviewed ceiling",
    fired_policies: [],
    remediations: [
      {
        remediation_id: "rem_88fe",
        kind: "approval",
        approval_id: "apr_7f3c9a1b",
        outcome: "approved",
        actor_id: "acct_4471",
        reason: "verified by phone",
        occurred_at: "2026-09-09T12:04:31Z",
        anchor: { ledger_index: 40202, hash: "9ee0" },
      },
    ],
    anchor: { ledger_index: 40197, hash: "b1c4" },
    ...over,
  };
}

//: How many requests past the last scripted body the stub tolerates before
//: it calls the walk unbounded. Only a client that keeps following a cursor
//: nobody advanced ever reaches it.
const RUNAWAY_AFTER = 5;

/**
 * Serve each body in turn, repeating the last — then refuse.
 *
 * The repeat matters: a page carrying `next_cursor` is served again and
 * again, which is exactly what a client that auto-paginates keeps asking
 * for. Left unbounded, the stub would let that client *hang*, and a hang
 * is not a failing assertion — it is a timeout with no test named. So the
 * stub stops, and the unbounded walk becomes a named failure in the test
 * that provoked it.
 */
function serving(...bodies: unknown[]): StubTransport {
  const stub = makeStubTransport({ status: 200, body: bodies[0] ?? {} });
  const inner = stub.fetch;
  let n = 0;
  stub.fetch = (async (url: unknown, init: unknown) => {
    n += 1;
    if (n > bodies.length + RUNAWAY_AFTER) {
      throw new Error(
        `unbounded pagination: ${n} requests for ${bodies.length} scripted ` +
          `page(s) — the caller asked for one page and the SDK kept ` +
          `following the cursor`,
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

// ------------------------------------------------------------------ //
// The distinction the whole design turns on
// ------------------------------------------------------------------ //

describe("a denial that names an approval is an ask", () => {
  it("reads awaitingApproval when the server names one", () => {
    const r = checkResultFromResponse({
      state: "open", allow: false, warning: false,
      reason: "refund above the reviewed ceiling",
      pending_approval_id: "apr_7f3c9a1b",
    });
    expect(r.allow).toBe(false);
    expect(r.awaitingApproval).toBe(true);
    expect(r.pendingApprovalId).toBe("apr_7f3c9a1b");
  });

  it("a plain denial is not awaiting anything", () => {
    const r = checkResultFromResponse({ state: "open", allow: false, warning: false });
    expect(r.allow).toBe(false);
    expect(r.awaitingApproval).toBe(false);
    expect(r.pendingApprovalId).toBeNull();
  });

  it("an older response without the field still refuses", () => {
    // The field is additive on purpose: a client reading `allow` alone must
    // not start allowing what it used to deny.
    const r = checkResultFromResponse({
      state: "open", allow: false, warning: false, reason: "policy fired",
    });
    expect(r.allow).toBe(false);
    expect(r.pendingApprovalId).toBeNull();
  });
});

// ------------------------------------------------------------------ //
// The decision records a human, or it does not happen
// ------------------------------------------------------------------ //

describe("decideApproval", () => {
  for (const actor of ["", "   ", undefined as unknown as string, 4471 as unknown as string]) {
    it(`refuses a decision with no human (${JSON.stringify(actor)}) before any request`, async () => {
      const stub = serving(approvalBody("approved"));
      const cx = clientOver(stub);
      await expect(
        cx.decideApproval({ approvalId: "apr_7f3c9a1b", decision: "approve", actorId: actor }),
      ).rejects.toThrow(ValidationError);
      // The assertion that matters. A server-side rejection would throw
      // too, and would not tell us the check is where the mistake is.
      expect(stub.captured.length, "a decision with no human must not reach the wire").toBe(0);
    });
  }

  it("refuses an unknown decision before any request", async () => {
    const stub = serving(approvalBody("approved"));
    const cx = clientOver(stub);
    await expect(
      cx.decideApproval({
        approvalId: "apr_7f3c9a1b",
        decision: "maybe" as never,
        actorId: "acct_4471",
      }),
    ).rejects.toThrow(ValidationError);
    expect(stub.captured.length).toBe(0);
  });

  it("sends the actor and returns the decision", async () => {
    const decided = approvalBody("approved", {
      decision: {
        decision: "approve", actor_id: "acct_4471", actor_label: "Dana R.",
        reason: "verified the order by phone", decided_at: "2026-09-09T12:04:31Z",
      },
    });
    const stub = serving(decided);
    const cx = clientOver(stub);

    const a = await cx.decideApproval({
      approvalId: "apr_7f3c9a1b", decision: "approve",
      actorId: "acct_4471", actorLabel: "Dana R.",
      reason: "verified the order by phone",
    });

    expect(stub.captured.length).toBe(1);
    const req = stub.captured[0]!;
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/v1/approvals/apr_7f3c9a1b/decision");
    expect(req.body).toEqual({
      decision: "approve", actor_id: "acct_4471",
      actor_label: "Dana R.", reason: "verified the order by phone",
    });
    expect(a.status).toBe("approved");
    expect(a.decision?.actorId).toBe("acct_4471");
    expect(a.decision?.actorLabel).toBe("Dana R.");
  });

  it("approve and decline send their own verb, and both still need a human", async () => {
    const stub = serving(approvalBody("approved"), approvalBody("declined"));
    const cx = clientOver(stub);
    await cx.approveApproval({ approvalId: "apr_1", actorId: "acct_1" });
    await cx.declineApproval({ approvalId: "apr_2", actorId: "acct_2" });
    expect(
      stub.captured.map((r) => (r.body as Record<string, unknown>)["decision"]),
    ).toEqual(["approve", "decline"]);

    const empty = serving(approvalBody());
    const cx2 = clientOver(empty);
    await expect(
      cx2.approveApproval({ approvalId: "apr_1", actorId: "" }),
    ).rejects.toThrow(ValidationError);
    await expect(
      cx2.declineApproval({ approvalId: "apr_1", actorId: "" }),
    ).rejects.toThrow(ValidationError);
    expect(empty.captured.length).toBe(0);
  });
});

// ------------------------------------------------------------------ //
// A settled approval is lost, not failed
// ------------------------------------------------------------------ //

describe("a second decision loses", () => {
  for (const settled of ["approved", "declined", "expired"]) {
    it(`${settled} → ConflictError naming its state`, async () => {
      const stub = makeStubTransport({
        status: 409, body: { detail: "already settled", status: settled },
      });
      const cx = clientOver(stub);
      await expect(
        cx.decideApproval({
          approvalId: "apr_7f3c9a1b", decision: "approve", actorId: "acct_9002",
        }),
      ).rejects.toThrow(new RegExp(`approval already ${settled}`));
    });
  }

  it("a 409 without an approval status still reads as the idempotency conflict", async () => {
    // The other 409. Same type, and the message must not assert the wrong cause.
    const stub = makeStubTransport({ status: 409, body: { detail: "in flight" } });
    const cx = clientOver(stub);
    await expect(
      cx.decideApproval({
        approvalId: "apr_7f3c9a1b", decision: "approve", actorId: "acct_4471",
      }),
    ).rejects.toThrow(/Idempotency-Key/);
  });

  it("is a ConflictError, not a ServerError", async () => {
    const stub = makeStubTransport({ status: 409, body: { status: "approved" } });
    const cx = clientOver(stub);
    await expect(
      cx.decideApproval({
        approvalId: "apr_1", decision: "decline", actorId: "acct_9",
      }),
    ).rejects.toThrow(ConflictError);
  });
});

// ------------------------------------------------------------------ //
// Expiry fails closed
// ------------------------------------------------------------------ //

describe("expiry", () => {
  it("onExpiry is decline even if the server says otherwise", () => {
    // An approval that becomes an allow because nobody looked at it is not
    // a human-in-the-loop control. There is no path — server-sent or
    // otherwise — by which this SDK reports one.
    const a = approvalFromResponse(approvalBody("pending", { on_expiry: "approve" }));
    expect(a.onExpiry).toBe("decline");
  });

  it("an expired approval carries no decision", () => {
    const a = approvalFromResponse(approvalBody("expired"));
    expect(a.decision).toBeNull();
    expect(a.status).toBe("expired");
  });
});

// ------------------------------------------------------------------ //
// Paging: bounded by default, lazy on request
// ------------------------------------------------------------------ //

describe("listApprovals", () => {
  it("defaults to pending and does not follow the cursor", async () => {
    const stub = serving({ approvals: [approvalBody()], next_cursor: "c2" });
    const page = await clientOver(stub).listApprovals();
    expect(stub.captured.length, "one page means one request").toBe(1);
    expect(new URL(stub.captured[0]!.url).searchParams.get("status")).toBe("pending");
    expect(page.nextCursor).toBe("c2");
    expect(page.approvals.length).toBe(1);
  });

  it("passes every filter", async () => {
    const stub = serving({ approvals: [], next_cursor: null });
    await clientOver(stub).listApprovals({
      status: "approved", subjectId: "subject:dv:bot", limit: 50, cursor: "eyJpIjo0MH0",
    });
    const q = new URL(stub.captured[0]!.url).searchParams;
    expect(Object.fromEntries(q.entries())).toEqual({
      status: "approved", subject_id: "subject:dv:bot",
      limit: "50", cursor: "eyJpIjo0MH0",
    });
  });

  for (const bad of [0, -1, 101, 1000, 2.5, NaN]) {
    it(`refuses limit=${bad} before the round trip`, async () => {
      const stub = serving({ approvals: [] });
      await expect(
        clientOver(stub).listApprovals({ limit: bad }),
      ).rejects.toThrow(ValidationError);
      expect(stub.captured.length).toBe(0);
    });
  }
});

describe("iterApprovals", () => {
  it("fetches a page only when asked past the one it holds", async () => {
    const stub = serving(
      { approvals: [approvalBody(), approvalBody()], next_cursor: "c2" },
      { approvals: [approvalBody()], next_cursor: null },
    );
    const it_ = clientOver(stub).iterApprovals();

    await it_.next();
    expect(stub.captured.length, "the first item must not have fetched page two").toBe(1);
    await it_.next();
    expect(stub.captured.length).toBe(1);
    await it_.next();                       // exhausts page one, fetches page two
    expect(stub.captured.length).toBe(2);
    expect((await it_.next()).done).toBe(true);
    expect(stub.captured.length, "a null cursor must end the walk").toBe(2);
  });

  it("breaking out never requests the next page", async () => {
    const stub = serving({ approvals: [approvalBody()], next_cursor: "c2" });
    for await (const _a of clientOver(stub).iterApprovals()) break;
    expect(stub.captured.length).toBe(1);
  });
});

// ------------------------------------------------------------------ //
// The ledger
// ------------------------------------------------------------------ //

describe("getIncidents", () => {
  it("defaults to all and parses remediations", async () => {
    const stub = serving({ incidents: [incidentBody()], next_cursor: null });
    const page = await clientOver(stub).getIncidents();
    expect(new URL(stub.captured[0]!.url).searchParams.get("status")).toBe("all");
    const inc = page.incidents[0]!;
    expect(inc.status).toBe("remediated");
    expect(inc.remediations.length).toBe(1);
    expect(inc.remediations[0]!.kind).toBe("approval");
    expect(inc.remediations[0]!.approvalId).toBe("apr_7f3c9a1b");
    expect(inc.remediations[0]!.anchor).toEqual({ ledger_index: 40202, hash: "9ee0" });
  });

  it("passes the whole window", async () => {
    const stub = serving({ incidents: [] });
    await clientOver(stub).getIncidents({
      status: "open", subjectId: "subject:dv:bot",
      since: "2026-09-01T00:00:00Z", until: "2026-09-09T00:00:00Z", limit: 100,
    });
    expect(
      Object.fromEntries(new URL(stub.captured[0]!.url).searchParams.entries()),
    ).toEqual({
      status: "open", subject_id: "subject:dv:bot",
      since: "2026-09-01T00:00:00Z", until: "2026-09-09T00:00:00Z", limit: "100",
    });
  });

  it("an unanswered incident is an incident with no remediations", async () => {
    // Not an error, not an empty result, and not collapsed to null.
    const stub = serving({
      incidents: [incidentBody({ status: "open", closed_at: null, remediations: [] })],
    });
    const inc = (await clientOver(stub).getIncidents({ status: "open" })).incidents[0]!;
    expect(inc.status).toBe("open");
    expect(inc.remediations).toEqual([]);
    expect(inc.closedAt).toBeNull();
  });

  it("the incident anchor is the one the check handed back", async () => {
    // The whole point of making the ledger readable: an anchor recorded at
    // check time finds exactly this entry, and the hashes compare.
    const checked = checkResultFromResponse({
      state: "open", allow: false, warning: false, reason: "ceiling",
      anchor: { ledger_index: 40197, hash: "b1c4" },
    });
    const stub = serving({ incidents: [incidentBody()] });
    const inc = (await clientOver(stub).getIncidents()).incidents[0]!;
    expect(inc.anchor).toEqual(checked.anchor);
  });

  it("iterIncidents walks pages lazily", async () => {
    const stub = serving(
      { incidents: [incidentBody()], next_cursor: "c2" },
      { incidents: [incidentBody()], next_cursor: null },
    );
    const got = [];
    for await (const i of clientOver(stub).iterIncidents()) got.push(i);
    expect(got.length).toBe(2);
    expect(stub.captured.length).toBe(2);
  });

  it("the ledger is append-only in the surface too", () => {
    // A convenience that reads as closing an incident would describe a
    // ledger this is not — there is no endpoint behind one (spec §5.21).
    for (const forbidden of [
      "closeIncident", "resolveIncident", "deleteIncident", "updateIncident",
    ]) {
      expect(
        (DMZAgent.prototype as unknown as Record<string, unknown>)[forbidden],
        forbidden,
      ).toBeUndefined();
    }
  });
});

// ------------------------------------------------------------------ //
// Breaker states (spec §2.2, 0.11.0)
// ------------------------------------------------------------------ //

describe("breaker states", () => {
  it("hold denies and names its approval", () => {
    const r = checkResultFromResponse({
      state: "hold", allow: false, warning: false, reason: "refund ceiling",
      fired_policies: [
        { cb_policy_id: "cbp_11", name: "refund ceiling", action: "require_approval" },
      ],
      anchor: { ledger_index: 40197, hash: "b1c4", ledger_event_id: "le_1" },
      pending_approval_id: "apr_7f3c9a1b",
    });
    expect(r.state).toBe("hold");
    expect(r.allow).toBe(false);
    expect(r.awaitingApproval).toBe(true);
    expect(r.firedPolicies[0]!.action).toBe("require_approval");
    // ledger_event_id is ignorable; the anchor still parses.
    expect(r.anchor).toEqual({ ledger_index: 40197, hash: "b1c4" });
  });

  it("allow is read from the wire for a known state", () => {
    expect(checkResultFromResponse({ state: "half_open", allow: true, warning: true }).allow)
      .toBe(true);
    expect(checkResultFromResponse({ state: "closed", allow: false }).allow).toBe(false);
  });

  for (const [state, allow] of [
    ["closed", true], ["half_open", true], ["hold", false], ["open", false],
  ] as const) {
    it(`with allow omitted, ${state} → allow ${allow}`, () => {
      expect(checkResultFromResponse({ state }).allow).toBe(allow);
    });
  }

  it("an unknown state denies, even when the wire says allow", () => {
    for (const body of [{ state: "quarantine" }, { state: "quarantine", allow: true }]) {
      const r = checkResultFromResponse(body);
      expect(r.state, "the raw word is kept").toBe("quarantine");
      expect(r.allow, JSON.stringify(body)).toBe(false);
    }
  });

  it("policy actions are kept as the server sent them", () => {
    const r = checkResultFromResponse({
      state: "open", allow: false,
      fired_policies: ["allow", "review", "block", "require_approval", "quarantine"].map(
        (action, i) => ({ cb_policy_id: `p${i}`, name: `n${i}`, action }),
      ),
    });
    expect(r.firedPolicies.map((p) => p.action)).toEqual([
      "allow", "review", "block", "require_approval", "quarantine",
    ]);
  });
});
