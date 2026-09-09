/**
 * Contract-test runner — drives the JSON corpus from `dmzagent-sdk-spec`.
 *
 * Three corpora (spec §10):
 *   1. golden-envelopes.json — input → expected wire body
 *   2. signature-vectors.json — HMAC verifier vectors
 *   3. error-mapping.json — HTTP status → exception type
 *
 * The CI workflow checks out the spec repo at the pinned tag from
 * package.json#dmzagent.specVersion and runs `npm run test:conformance`.
 */

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  CBOpenError,
  AuthError,
  DMZAgent,
  DMZAgentError,
  PermissionError,
  RateLimitError,
  ConflictError,
  ServerError,
  ValidationError,
  verifyWebhookSignature,
  SPEC_VERSION,
} from "../src/index.js";
import {
  loadFixture,
  makeStubTransport,
  normalizedJsonString,
  specPath,
  type CapturedRequest,
} from "./helpers.js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// This file lives in tests/, one level below the repo root. Resolve
// package.json from here rather than from specPath(): CI checks the spec
// out at $GITHUB_WORKSPACE/spec with the SDK at $GITHUB_WORKSPACE, so the
// two are not siblings there and a spec-relative path would miss.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---------- spec version pinning (sdk-spec.md §11.1) ----------
//
// C# has carried this check since 0.5.0; TypeScript never did, and 0.8.1
// showed what that costs. All four SDKs pinned 0.8.1 while the spec's main
// still read 0.8.0, and C# was the only one that went red — the other three
// reported green while being conformance-tested against a corpus one version
// behind what they claim to implement. A green gate that cannot see the
// mismatch is the same failure as the checkout that sat broken for two
// months: it passes, and it means less than it appears to.
//
// Deliberately in this file. The conformance workflow runs exactly
// `vitest run tests/conformance.test.ts`, so a check placed anywhere else
// would not execute in the gate that matters.

describe("spec version pinning", () => {
  it("pins SPEC_VERSION to the checked-out spec", () => {
    // The corpus under test must BE the version this SDK claims.
    const versionFile = resolve(specPath(), "VERSION");
    const pinned = readFileSync(versionFile, "utf8").trim();
    expect(pinned).toBe(SPEC_VERSION);
  });

  it("keeps package.json specVersion and SPEC_VERSION in step", () => {
    // Second copy of the same number. `dmzagent.specVersion` is what CI
    // reads to decide which spec ref to check out, while SPEC_VERSION is
    // what reaches the wire in the User-Agent — so a drift between them
    // means the corpus checked out is not the one the SDK reports. This
    // constant already existed twice inside src/ and did drift; that was
    // fixed by collapsing it into version.ts, and this pins the remaining
    // copy in package.json to it.
    const pkg = JSON.parse(
      readFileSync(resolve(REPO_ROOT, "package.json"), "utf8"),
    ) as { dmzagent?: { specVersion?: string } };
    expect(pkg.dmzagent?.specVersion).toBe(SPEC_VERSION);
  });
});

// ---------- types for the corpus JSON ----------

interface GoldenEnvelopes {
  fixtures: GoldenFixture[];
  validation_failures: ValidationFailureFixture[];
}

interface GoldenFixture {
  name: string;
  method: string;
  args: Record<string, unknown>;
  expected_path: string;
  /** Absent means POST — every vector before 0.10.0 was one. */
  expected_method?: string;
  /** Read vectors pin the query string; write vectors have none. */
  expected_query?: Record<string, string>;
  /** `null` on a read vector: the request must carry no body at all. */
  expected_body: Record<string, unknown> | null;
}

interface ValidationFailureFixture {
  name: string;
  method: string;
  args: Record<string, unknown>;
  expected_exception: string;
  expected_message_contains: string;
}

interface ErrorMapping {
  fixtures: ErrorMappingFixture[];
}

interface ErrorMappingFixture {
  name: string;
  status: number;
  body: unknown;
  method: string;
  args: Record<string, unknown>;
  expected_exception: string | null;
  expected_status_code?: number;
  expected_fields?: Record<string, unknown>;
  expected_result_fields?: Record<string, unknown>;
}

interface SignatureVectors {
  fixtures: SignatureFixture[];
}

interface SignatureFixture {
  name: string;
  payload: string;
  secret: string;
  header: string;
  header_signed_with?: string;
  tolerance_seconds: number;
  now_unix: number;
  valid: boolean;
}

// ---------- helpers ----------

const API_KEY = "ck_test_xxxxxxxxxxxxxxxxxxxxx";

function buildClient(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fetchImpl: (input: any, init?: any) => Promise<Response>,
): DMZAgent {
  return new DMZAgent({
    apiKey: API_KEY,
    baseUrl: "https://api.test.local",
    fetch: fetchImpl,
  });
}

/**
 * Drive a method from a fixture's args. The corpus uses snake_case
 * keys that mirror the wire / spec canonical names; we translate to
 * the camelCase TypeScript option keys here.
 *
 * Every key a fixture can carry must be translated explicitly. A key that is
 * not listed is silently dropped and the SDK is then tested on a payload the
 * corpus never asked for — `subject_type` was missing from every case here,
 * so the golden envelopes compared a body with the field against one without
 * it. That went unnoticed for as long as the conformance job could not check
 * the spec out and never ran.
 */
async function callMethod(
  client: DMZAgent,
  method: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (method) {
    case "subject_says":
      return client.subjectSays({
        agentSubjectId: args["agent_subject_id"] as string,
        subjectId: args["subject_id"] as string,
        text: args["text"] as string,
        ...(args["subject_type"] !== undefined
          ? { subjectType: args["subject_type"] as never }
          : {}),
        ...(args["interaction_id"] !== undefined
          ? { interactionId: args["interaction_id"] as string }
          : {}),
        ...(args["interaction_kind"] !== undefined
          ? { interactionKind: args["interaction_kind"] as string }
          : {}),
        ...(args["subjects"] !== undefined
          ? { subjects: args["subjects"] as never }
          : {}),
        ...(args["payload_extra"] !== undefined
          ? { payloadExtra: args["payload_extra"] as Record<string, unknown> }
          : {}),
      });
    case "tool_call":
      return client.toolCall({
        subjectId: args["subject_id"] as string,
        tool: args["tool"] as string,
        ...(args["subject_type"] !== undefined
          ? { subjectType: args["subject_type"] as never }
          : {}),
        ...(args["args"] !== undefined
          ? { args: args["args"] as Record<string, unknown> }
          : {}),
        ...(args["interaction_id"] !== undefined
          ? { interactionId: args["interaction_id"] as string }
          : {}),
        ...(args["subjects"] !== undefined
          ? { subjects: args["subjects"] as never }
          : {}),
      });
    case "tool_result":
      return client.toolResult({
        subjectId: args["subject_id"] as string,
        tool: args["tool"] as string,
        result: args["result"],
        ...(args["subject_type"] !== undefined
          ? { subjectType: args["subject_type"] as never }
          : {}),
        ...(args["interaction_id"] !== undefined
          ? { interactionId: args["interaction_id"] as string }
          : {}),
        ...(args["subjects"] !== undefined
          ? { subjects: args["subjects"] as never }
          : {}),
      });
    case "observation":
      return client.observation({
        agentSubjectId: args["agent_subject_id"] as string,
        subjects: args["subjects"] as never,
        payload: args["payload"] as Record<string, unknown>,
        ...(args["subject_type"] !== undefined
          ? { subjectType: args["subject_type"] as never }
          : {}),
        ...(args["interaction_id"] !== undefined
          ? { interactionId: args["interaction_id"] as string }
          : {}),
      });
    case "emit_event":
      return client.emitEvent({
        kind: args["kind"] as never,
        agentSubjectId: args["agent_subject_id"] as string,
        ...(args["payload"] !== undefined
          ? { payload: args["payload"] as Record<string, unknown> }
          : {}),
        ...(args["subject_type"] !== undefined
          ? { subjectType: args["subject_type"] as never }
          : {}),
      });
    case "check":
      return client.check({
        ...(args["subject_id"] !== undefined
          ? { subjectId: args["subject_id"] as string }
          : {}),
        ...(args["interaction_id"] !== undefined
          ? { interactionId: args["interaction_id"] as string }
          : {}),
      });
    case "guard_with_raise_on_open":
      return client.guard({
        ...(args["subject_id"] !== undefined
          ? { subjectId: args["subject_id"] as string }
          : {}),
        raiseOnOpen: args["raise_on_open"] as boolean,
      });
    case "construct":
      return new DMZAgent({ apiKey: args["api_key"] as string });
    // 0.10.0 — the white-label approval control and the readable ledger.
    case "list_approvals":
      return client.listApprovals({
        ...(args["status"] !== undefined ? { status: args["status"] as string } : {}),
        ...(args["subject_id"] !== undefined
          ? { subjectId: args["subject_id"] as string }
          : {}),
        ...(args["limit"] !== undefined ? { limit: args["limit"] as number } : {}),
        ...(args["cursor"] !== undefined ? { cursor: args["cursor"] as string } : {}),
      });
    case "decide_approval":
      return client.decideApproval({
        approvalId: args["approval_id"] as string,
        decision: args["decision"] as "approve" | "decline",
        actorId: args["actor_id"] as string,
        ...(args["actor_label"] !== undefined
          ? { actorLabel: args["actor_label"] as string }
          : {}),
        ...(args["reason"] !== undefined ? { reason: args["reason"] as string } : {}),
      });
    case "get_incidents":
      return client.getIncidents({
        ...(args["status"] !== undefined ? { status: args["status"] as string } : {}),
        ...(args["subject_id"] !== undefined
          ? { subjectId: args["subject_id"] as string }
          : {}),
        ...(args["since"] !== undefined ? { since: args["since"] as string } : {}),
        ...(args["until"] !== undefined ? { until: args["until"] as string } : {}),
        ...(args["limit"] !== undefined ? { limit: args["limit"] as number } : {}),
        ...(args["cursor"] !== undefined ? { cursor: args["cursor"] as string } : {}),
      });
    default:
      throw new Error(`unsupported method in corpus: ${method}`);
  }
}

// Map a thrown exception back to the canonical name listed in spec §8.5.
function canonicalType(err: unknown): string | null {
  if (err instanceof CBOpenError) return "CBOpenError";
  if (err instanceof AuthError) return "AuthError";
  if (err instanceof PermissionError) return "PermissionError";
  if (err instanceof ValidationError) return "ValidationError";
  if (err instanceof ServerError) return "ServerError";
  // Must precede the DMZAgentError catch-all: RateLimitError extends it, so
  // checking the base first would report every 429 as a plain DMZAgentError
  // and the vector would fail for a reason that is not the SDK's.
  if (err instanceof RateLimitError) return "RateLimitError";
  // Same ordering reason as RateLimitError above: ConflictError extends
  // DMZAgentError, so the catch-all must stay last.
  if (err instanceof ConflictError) return "ConflictError";
  if (err instanceof DMZAgentError) return "DMZAgentError";
  if (err instanceof Error) return err.name || "Error";
  return null;
}

function matchesValidationLike(canonical: string | null): boolean {
  // Spec accepts either "ValidationError" or "ValidationError_or_ArgumentError".
  return canonical === "ValidationError";
}

// ---------- 1. golden envelopes ----------

describe("contract: golden-envelopes", () => {
  const corpus = loadFixture<GoldenEnvelopes>("contract-tests/golden-envelopes.json");

  for (const fixture of corpus.fixtures) {
    it(`golden_envelopes/${fixture.name}`, async () => {
      // For check fixtures the server response is a CB envelope; for
      // event fixtures, an agent-stream envelope. We don't assert on
      // the response here — only on the captured request body.
      const stub = makeStubTransport({
        status: 200,
        body:
          fixture.method === "check"
            ? {
                state: "closed",
                allow: true,
                warning: false,
                reason: "stub",
                fired_policies: [],
                anchor: null,
                checked_at: "1970-01-01T00:00:00Z",
                latency_ms: 0,
                route_latency_ms: 0,
              }
            : {
                interaction_id: "int_stub",
                subjects: [],
                frame_id: "frm_stub",
                accepted: true,
                n_workspaces: 1,
                follow_my_data: "/v1/frames/frm_stub/story",
              },
      });
      const client = buildClient(stub.fetch);
      await callMethod(client, fixture.method, fixture.args);

      expect(stub.captured.length).toBe(1);
      const req = stub.captured[0] as CapturedRequest;
      // A read vector pins its verb and its query string. Asserting only
      // the body would let a GET that sent every filter as nothing at all
      // pass, since a GET has no body to be wrong about.
      expect(req.method).toBe(fixture.expected_method ?? "POST");
      expect(req.path).toBe(fixture.expected_path);

      if (fixture.expected_query !== undefined) {
        const got = Object.fromEntries(new URL(req.url).searchParams.entries());
        expect(got).toEqual(fixture.expected_query);
      }

      // Header sanity — Authorization, Content-Type, User-Agent.
      //
      // This asserted X-DMZAgent-Key until now, which the spec calls
      // "deprecated and slated for removal in v1.0"; the wire contract is
      // `Authorization: Bearer ck_<api-key>` (sdk-spec.md, and the securityScheme
      // in openapi.json). The client has always sent the Bearer form, so this
      // assertion was testing a header nobody transmits — it only ever passed
      // because the conformance job could not check the spec out and never ran.
      const ua = req.headers["User-Agent"] ?? req.headers["user-agent"];
      const auth = req.headers["Authorization"] ?? req.headers["authorization"];
      const ct = req.headers["Content-Type"] ?? req.headers["content-type"];
      expect(auth).toBe(`Bearer ${API_KEY}`);
      expect(ct).toBe("application/json");
      // Derived, not hardcoded. This pinned 0.5.0 while the SDK shipped 0.6.0,
      // so it asserted a User-Agent the client never sends — invisible for as
      // long as the conformance job could not check the spec out and never ran.
      // Building the expectation from the exported constant means a version
      // bump cannot silently reintroduce the drift.
      expect(ua).toBe(`dmzagent-typescript/${SPEC_VERSION}`);

      if (fixture.expected_body === null) {
        expect(
          req.body === undefined || req.body === null ||
            (typeof req.body === "object" &&
              Object.keys(req.body as object).length === 0),
          `${fixture.name}: expected no request body, got ${JSON.stringify(req.body)}`,
        ).toBe(true);
      } else {
        const gotNorm = normalizedJsonString(req.body);
        const wantNorm = normalizedJsonString(fixture.expected_body);
        expect(gotNorm).toBe(wantNorm);
      }
    });
  }

  for (const fixture of corpus.validation_failures) {
    it(`golden_envelopes/validation_failures/${fixture.name}`, async () => {
      const stub = makeStubTransport({ status: 200, body: {} });
      let thrown: unknown = null;
      try {
        if (fixture.method === "construct") {
          new DMZAgent({ apiKey: fixture.args["api_key"] as string });
        } else {
          const client = buildClient(stub.fetch);
          await callMethod(client, fixture.method, fixture.args);
        }
      } catch (e) {
        thrown = e;
      }
      expect(thrown, `expected an exception from ${fixture.name}`).toBeTruthy();
      const canonical = canonicalType(thrown);
      // Spec says "ValidationError_or_ArgumentError" — TS picks
      // ValidationError. We accept that one name.
      expect(matchesValidationLike(canonical)).toBe(true);
      expect(String((thrown as Error).message)).toContain(fixture.expected_message_contains);
    });
  }
});

// ---------- 2. signature vectors ----------

describe("contract: signature-vectors", () => {
  const corpus = loadFixture<SignatureVectors>("contract-tests/signature-vectors.json");

  for (const fixture of corpus.fixtures) {
    it(`signature_vectors/${fixture.name}`, () => {
      let header = fixture.header;
      if (header.includes("<COMPUTE>")) {
        // header: "t=<unix>,v1=<COMPUTE>" — extract t, compute v1
        // over secret + `t.payload`, substitute.
        const tMatch = header.match(/t=([^,]+)/);
        const t = tMatch?.[1] ?? "";
        const sig = createHmac("sha256", fixture.secret)
          .update(`${t}.${fixture.payload}`)
          .digest("hex");
        header = header.replace("<COMPUTE>", sig);
      } else if (header.includes("<COMPUTE_WITH_OTHER>")) {
        const tMatch = header.match(/t=([^,]+)/);
        const t = tMatch?.[1] ?? "";
        const otherSecret = fixture.header_signed_with ?? "";
        const sig = createHmac("sha256", otherSecret)
          .update(`${t}.${fixture.payload}`)
          .digest("hex");
        header = header.replace("<COMPUTE_WITH_OTHER>", sig);
      }
      const result = verifyWebhookSignature(
        fixture.payload,
        header,
        fixture.secret,
        fixture.tolerance_seconds,
        fixture.now_unix,
      );
      expect(result).toBe(fixture.valid);
    });
  }
});

// ---------- 3. error mapping ----------

describe("contract: error-mapping", () => {
  const corpus = loadFixture<ErrorMapping>("contract-tests/error-mapping.json");

  for (const fixture of corpus.fixtures) {
    it(`error_mapping/${fixture.name}`, async () => {
      const stub = makeStubTransport({
        status: fixture.status,
        body: fixture.body,
      });
      const client = buildClient(stub.fetch);

      let thrown: unknown = null;
      let resultOk: unknown = null;
      try {
        resultOk = await callMethod(client, fixture.method, fixture.args);
      } catch (e) {
        thrown = e;
      }

      if (fixture.expected_exception === null) {
        // guard with raise_on_open=false on an open breaker returns the
        // handle; assert the result fields.
        expect(thrown, `unexpected throw from ${fixture.name}`).toBeNull();
        const handle = resultOk as { result?: Record<string, unknown> };
        const got = handle?.result ?? (resultOk as Record<string, unknown>);
        if (fixture.expected_result_fields) {
          for (const [k, v] of Object.entries(fixture.expected_result_fields)) {
            expect(got?.[k]).toEqual(v);
          }
        }
        return;
      }

      expect(thrown, `expected ${fixture.expected_exception}`).toBeTruthy();
      expect(canonicalType(thrown)).toBe(fixture.expected_exception);

      if (fixture.expected_status_code !== undefined) {
        const e = thrown as { statusCode?: number | null };
        expect(e.statusCode).toBe(fixture.expected_status_code);
      }

      if (fixture.expected_fields) {
        for (const [k, v] of Object.entries(fixture.expected_fields)) {
          // Corpus uses snake_case `scope_ref`; TS exposes `scopeRef`.
          const camelKey = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
          const e = thrown as Record<string, unknown>;
          expect(e[camelKey] ?? e[k]).toEqual(v);
        }
      }
    });
  }
});
