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
  ServerError,
  ValidationError,
  verifyWebhookSignature,
} from "../src/index.js";
import {
  loadFixture,
  makeStubTransport,
  normalizedJsonString,
  type CapturedRequest,
} from "./helpers.js";

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
  expected_body: Record<string, unknown>;
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
  /** Response headers applied to the stubbed response (e.g. Retry-After). */
  headers?: Record<string, string>;
  body: unknown;
  method: string;
  args: Record<string, unknown>;
  expected_exception: string | null;
  expected_status_code?: number;
  /** When the key is present, asserted against the error's retryAfter
   *  (a null fixture value asserts retryAfter === null). */
  expected_retry_after?: number | null;
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
        subjectType: args["subject_type"] as string,
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
        subjectType: args["subject_type"] as string,
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
        subjectType: args["subject_type"] as string,
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
        subjectType: args["subject_type"] as string,
        ...(args["interaction_id"] !== undefined
          ? { interactionId: args["interaction_id"] as string }
          : {}),
      });
    case "emit_event":
      return client.emitEvent({
        kind: args["kind"] as never,
        agentSubjectId: args["agent_subject_id"] as string,
        subjectType: args["subject_type"] as string,
        ...(args["payload"] !== undefined
          ? { payload: args["payload"] as Record<string, unknown> }
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
  if (err instanceof RateLimitError) return "RateLimitError";
  if (err instanceof ServerError) return "ServerError";
  if (err instanceof DMZAgentError) return "DMZAgentError";
  if (err instanceof Error) return err.name || "Error";
  return null;
}

function matchesValidationLike(canonical: string | null): boolean {
  // The corpus lists "ValidationError_or_ArgumentError" for client-side
  // precondition failures. Per spec §5, TS throws the built-in
  // `RangeError` for these (the "ArgumentError" bucket); the wire-level
  // ValidationError is reserved for HTTP 400/422.
  return canonical === "RangeError";
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
      expect(req.method).toBe("POST");
      expect(req.path).toBe(fixture.expected_path);

      // Header sanity — Authorization, Content-Type, User-Agent.
      // Spec §1.2: `Authorization: Bearer ck_…`; the legacy
      // X-DMZAgent-Key header is deprecated and must not be sent.
      const ua = req.headers["User-Agent"] ?? req.headers["user-agent"];
      const auth = req.headers["Authorization"] ?? req.headers["authorization"];
      const legacy = req.headers["X-DMZAgent-Key"] ?? req.headers["x-dmzagent-key"];
      const ct = req.headers["Content-Type"] ?? req.headers["content-type"];
      expect(auth).toBe(`Bearer ${API_KEY}`);
      expect(legacy).toBeUndefined();
      expect(ct).toBe("application/json");
      expect(ua).toMatch(/^dmzagent-typescript\/0\.7\.0/);

      const gotNorm = normalizedJsonString(req.body);
      const wantNorm = normalizedJsonString(fixture.expected_body);
      expect(gotNorm).toBe(wantNorm);
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
      // Spec says "ValidationError_or_ArgumentError" — TS throws the
      // built-in RangeError for client-side preconditions (spec §5).
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
        ...(fixture.headers ? { headers: fixture.headers } : {}),
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

      if ("expected_retry_after" in fixture) {
        const e = thrown as { retryAfter?: number | null };
        expect(e.retryAfter).toBe(fixture.expected_retry_after ?? null);
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
