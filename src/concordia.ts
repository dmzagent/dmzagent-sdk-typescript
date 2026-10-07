/**
 * DMZAgent — Concordia MCP 1.0 client.
 *
 * Companion to `@dmzagent/sdk` for the governance MCP at `/mcp/v1`.
 * The customer-facing surface for enforcing covenants, recording
 * audit decisions, querying installed Canons, and reading soul
 * snapshots — without writing JSON-RPC envelopes by hand.
 *
 * Usage:
 *
 *   import { ConcordiaClient } from "@dmzagent/sdk/concordia";
 *
 *   const client = new ConcordiaClient({ apiKey: "ck_live_…" });
 *
 *   const v = await client.enforceCovenant({
 *     subjectId: "user:alice",
 *     actionKind: "payment.issue",
 *     actionPayload: { amount: 9900, currency: "usd" },
 *     context: { sessionId: "s_42" },
 *   });
 *   if (v.verdict === "block") return safeFallback(v.rationale);
 *
 *   await client.recordDecision({
 *     subjectId: "user:alice",
 *     decisionKind: "payment_issued",
 *     payload: { refundId: "re_123", amount: 9900 },
 *     outcome: "completed",
 *   });
 *
 * Spec: CONCORDIA_MCP.md (server side) and dmzagent-sdk-spec §8
 * (TypeScript naming conventions). Implements MCP 1.0 — server
 * milestones MCP-1.1 through MCP-1.3.
 *
 * Naming follows the spec map: camelCase methods, `…Error` exception
 * suffixes, `ConcordiaClient` for the client class. Wire field names
 * stay snake_case where the server returns them (e.g. `subject_id`
 * inside `inputSchema` for tool descriptors), but every result type
 * exposed by this client is camelCase TypeScript.
 */

// We deliberately don't import `undici`. The agent-stream `DMZAgent`
// client uses it for stable Node 18 fetch semantics; for Concordia
// the global fetch (Node 22+, all browsers) is sufficient and keeps
// the bundle smaller. If a customer needs the undici behavior they
// can pass `fetch: undiciFetch` at construction.

// ---------------------------------------------------------------------------
// Wire-protocol error codes (CONCORDIA_MCP.md §8).
// ---------------------------------------------------------------------------

/** Standard JSON-RPC 2.0 error codes. */
export const JRPC_PARSE_ERROR    = -32700;
export const JRPC_INVALID_REQ    = -32600;
export const JRPC_METHOD_NOT_FND = -32601;
export const JRPC_INVALID_PARAMS = -32602;
export const JRPC_INTERNAL_ERR   = -32603;

/** DMZAgent-specific MCP application error codes (spec §8). */
export const MCP_AUTH_EXPIRED        = -32001;
export const MCP_QUOTA_EXCEEDED      = -32002;
export const MCP_POLICY_UNAVAILABLE  = -32003;
export const MCP_CANON_NOT_INSTALLED = -32004;
export const MCP_SUBJECT_NOT_FOUND   = -32005;
export const MCP_CIRCUIT_OPEN        = -32006;
export const MCP_PERMISSION_DENIED   = -32007;

// ---------------------------------------------------------------------------
// Exception hierarchy. Mirrors the Python SDK structure (ConcordiaError
// base + 7 typed subclasses + transport error).
// ---------------------------------------------------------------------------

export interface ConcordiaErrorInit {
  code?: number | null;
  errorId?: string | null;
  data?: Record<string, unknown>;
  cause?: unknown;
}

/** Base for every Concordia client error. */
export class ConcordiaError extends Error {
  public readonly code:    number | null;
  public readonly errorId: string | null;
  public readonly data:    Record<string, unknown>;

  constructor(message: string, init: ConcordiaErrorInit = {}) {
    super(message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name    = "ConcordiaError";
    this.code    = init.code    ?? null;
    this.errorId = init.errorId ?? null;
    this.data    = init.data    ?? {};
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Transport / envelope failure — non-200 HTTP, timeout, parse error. */
export class ConcordiaProtocolError extends ConcordiaError {
  constructor(message: string, init: ConcordiaErrorInit = {}) {
    super(message, init);
    this.name = "ConcordiaProtocolError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** API key rejected (auth_expired, -32001). */
export class ConcordiaAuthError extends ConcordiaError {
  constructor(message: string, init: ConcordiaErrorInit = {}) {
    super(message, init);
    this.name = "ConcordiaAuthError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Workspace hit a billing cap (tenant_quota_exceeded, -32002). */
export class ConcordiaQuotaExceededError extends ConcordiaError {
  constructor(message: string, init: ConcordiaErrorInit = {}) {
    super(message, init);
    this.name = "ConcordiaQuotaExceededError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** CB substrate degraded (policy_engine_unavailable, -32003). */
export class ConcordiaPolicyEngineUnavailableError extends ConcordiaError {
  constructor(message: string, init: ConcordiaErrorInit = {}) {
    super(message, init);
    this.name = "ConcordiaPolicyEngineUnavailableError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** canon_filter references uninstalled canon (canon_not_installed, -32004). */
export class ConcordiaCanonNotInstalledError extends ConcordiaError {
  constructor(message: string, init: ConcordiaErrorInit = {}) {
    super(message, init);
    this.name = "ConcordiaCanonNotInstalledError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Subject has no soul snapshot here (subject_not_found, -32005). */
export class ConcordiaSubjectNotFoundError extends ConcordiaError {
  constructor(message: string, init: ConcordiaErrorInit = {}) {
    super(message, init);
    this.name = "ConcordiaSubjectNotFoundError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Per-tool rate limit (circuit_open, -32006). */
export class ConcordiaCircuitOpenError extends ConcordiaError {
  constructor(message: string, init: ConcordiaErrorInit = {}) {
    super(message, init);
    this.name = "ConcordiaCircuitOpenError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Role gate refusal (permission_denied, -32007). */
export class ConcordiaPermissionDeniedError extends ConcordiaError {
  constructor(message: string, init: ConcordiaErrorInit = {}) {
    super(message, init);
    this.name = "ConcordiaPermissionDeniedError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const ERROR_CLASS_BY_CODE: Record<number, typeof ConcordiaError> = {
  [MCP_AUTH_EXPIRED]:        ConcordiaAuthError,
  [MCP_QUOTA_EXCEEDED]:      ConcordiaQuotaExceededError,
  [MCP_POLICY_UNAVAILABLE]:  ConcordiaPolicyEngineUnavailableError,
  [MCP_CANON_NOT_INSTALLED]: ConcordiaCanonNotInstalledError,
  [MCP_SUBJECT_NOT_FOUND]:   ConcordiaSubjectNotFoundError,
  [MCP_CIRCUIT_OPEN]:        ConcordiaCircuitOpenError,
  [MCP_PERMISSION_DENIED]:   ConcordiaPermissionDeniedError,
};

// ---------------------------------------------------------------------------
// Result types — typed interfaces over the JSON shapes the server returns.
// ---------------------------------------------------------------------------

export type Verdict = "allow" | "review" | "block" | "escalate";

export interface CbStateChange {
  state:        "closed" | "half_open" | "hold" | "open" | string;
  warning:      boolean;
  soulVersion?: number | null;
}

export interface EnforceCovenantResult {
  verdict:        Verdict;
  policyIds:      readonly string[];
  rationale:      string;
  cbStateChange:  CbStateChange;
  ledgerEntryId:  string;
  /** Convenience: `verdict === "allow"`. */
  readonly allow:   boolean;
  /** Convenience: `verdict === "block"`. */
  readonly blocked: boolean;
}

export interface RecordDecisionResult {
  ledgerEntryId:   string;
  chainHeadHash:   string;
  index?:          number | null;
}

export interface CorpusMatch {
  canonId:      string;
  canonVersion: string;
  section:      string;
  excerpt:      string;
  relevance:    number;
}

export interface QueryCorpusResult {
  matches:    readonly CorpusMatch[];
  scope:      string;
  canonCount: number;
}

export interface SoulTag {
  tagId:              string;
  score:              number;
  rawStrength:        number | null;
  evidenceCount:      number;
  firstObservedAt:    string;
  lastReinforcedAt:   string;
}

export interface SoulTrace {
  traceId:    string;
  frameId:    string | null;
  verdict:    string | null;
  outcome:    string;
  startedAt:  string;
  finishedAt: string | null;
}

export interface SubjectSoul {
  subjectId:     string;
  snapshotAt:    string;
  soulVersion:   number;
  tags:          readonly SoulTag[];
  recentTraces:  readonly SoulTrace[];
  retiredCount:  number;
}

// Resource result types
export interface PolicySummary {
  cbPolicyId:  string;
  name:        string;
  description: string;
  scope:       string;
  action:      string;
  enabled:     boolean;
  rules:       readonly Record<string, unknown>[];
  updatedAt:   string | null;
}

export interface InstalledCanon {
  canonId:          string;
  name:             string;
  category:         string | null;
  authorName:       string | null;
  latestVersion:    string | null;
  shortDescription: string;
  iconUrl:          string | null;
  enabled:          boolean;
  installedAt:      string | null;
}

export interface LedgerEntry {
  eventId:     string;
  index:       number;
  prevHash:    string;
  payloadHash: string;
  hash:        string;
  payload:     Record<string, unknown>;
  recordedAt:  string;
}

export interface LedgerPage {
  entries:    readonly LedgerEntry[];
  since:      number;
  limit:      number;
  count:      number;
  nextSince:  number | null;
}

// ---------------------------------------------------------------------------
// Client options + fetch shape.
// ---------------------------------------------------------------------------

// Match the existing client's FetchLike signature so tests can share helpers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FetchLike = (input: any, init?: any) => Promise<any>;

export interface ConcordiaClientOptions {
  apiKey?:     string;
  baseUrl?:    string;
  timeoutMs?:  number;
  userAgent?:  string;
  /** Inject a custom fetch (tests). Falls back to globalThis.fetch. */
  fetch?:      FetchLike;
}

const DEFAULT_BASE_URL = "https://api.dmzagent.com";
const DEFAULT_TIMEOUT  = 10_000;
const USER_AGENT       = "dmzagent-concordia-typescript/0.6.0";
const MCP_PATH         = "/mcp/v1";

// ---------------------------------------------------------------------------
// Tool-call argument shapes (camelCase). Wire field names are converted
// to snake_case by the dispatch helper since the spec is snake_case on
// the wire.
// ---------------------------------------------------------------------------

export interface EnforceCovenantArgs {
  subjectId:       string;
  actionKind:      string;
  actionPayload?:  Record<string, unknown>;
  context?:        Record<string, unknown>;
}

export interface RecordDecisionArgs {
  subjectId:     string;
  decisionKind:  string;
  payload?:      Record<string, unknown>;
  actor?:        "agent" | "human" | "system";
  outcome?:      "completed" | "aborted" | "rejected";
}

export interface QueryCorpusArgs {
  query:         string;
  scope?:        "installed" | "library";
  canonFilter?:  readonly string[];
  limit?:        number;
}

export interface GetSubjectSoulArgs {
  subjectId:    string;
  depth?:       "latest" | "history";
  tagFilter?:   readonly string[];
}

export interface RecentLedgerArgs {
  since?:  number;
  limit?:  number;
}

// ---------------------------------------------------------------------------
// Internal JSON-RPC envelope types.
// ---------------------------------------------------------------------------

interface JrpcRequest {
  jsonrpc: "2.0";
  id:      number;
  method:  string;
  params:  Record<string, unknown>;
}

interface JrpcErrorPayload {
  code:    number;
  message: string;
  data?:   Record<string, unknown>;
}

interface JrpcResponse {
  jsonrpc?: string;
  id?:      unknown;
  result?:  unknown;
  error?:   JrpcErrorPayload;
}

interface ToolResponse {
  content?: Array<{ type: string; text?: string }>;
  _data?:   Record<string, unknown>;
  _latency_ms?: number;
  isError?: boolean;
}

interface ResourceReadResponse {
  contents?: Array<{ uri: string; mimeType: string; text: string }>;
}

// ---------------------------------------------------------------------------
// Client implementation.
// ---------------------------------------------------------------------------

/**
 * Concordia MCP 1.0 client. Construct once per workspace API key and
 * call methods directly:
 *
 *   const c = new ConcordiaClient({ apiKey: "ck_…" });
 *   await c.enforceCovenant({ subjectId, actionKind, … });
 *
 * The client is stateless aside from request-id generation, so it's
 * safe to share across concurrent requests. There's no `close()` —
 * the fetch transport has no persistent connection. For symmetry
 * with disposable patterns we expose `[Symbol.asyncDispose]` so
 * `await using c = new ConcordiaClient({…})` works.
 */
export class ConcordiaClient {
  readonly #apiKey:    string;
  readonly #baseUrl:   string;
  readonly #timeoutMs: number;
  readonly #userAgent: string;
  readonly #fetch:     FetchLike;
  #idSeq:              number = 0;

  constructor(options: ConcordiaClientOptions = {}) {
    const envKey = typeof process !== "undefined"
      ? process.env?.["DMZAGENT_API_KEY"]
      : undefined;
    const key = options.apiKey ?? envKey ?? "";
    if (!key) {
      throw new ConcordiaError(
        "apiKey required (pass apiKey or set DMZAGENT_API_KEY)",
      );
    }
    if (!key.startsWith("ck_")) {
      throw new ConcordiaError(
        "apiKey must start with 'ck_' — double-check you copied a DMZAgent key, not another service's token",
      );
    }
    this.#apiKey    = key;
    this.#baseUrl   = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
    this.#userAgent = options.userAgent ?? USER_AGENT;
    const injected = options.fetch;
    if (injected !== undefined) {
      this.#fetch = injected;
    } else if (typeof globalThis.fetch === "function") {
      this.#fetch = globalThis.fetch.bind(globalThis) as FetchLike;
    } else {
      throw new ConcordiaError(
        "No fetch implementation available — pass `fetch` in options or upgrade to Node 22+/a browser",
      );
    }
  }

  // -- lifecycle -----------------------------------------------------------

  /** No-op (fetch has no persistent pool). Provided for parity with other SDKs. */
  close(): void {
    // intentionally empty
  }

  // Explicit-resource-management: `await using c = new ConcordiaClient(...)`
  async [Symbol.asyncDispose](): Promise<void> {
    this.close();
  }

  // -- JSON-RPC dispatch ---------------------------------------------------

  #nextId(): number {
    this.#idSeq += 1;
    return this.#idSeq;
  }

  async #rpc<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const body: JrpcRequest = {
      jsonrpc: "2.0",
      id:      this.#nextId(),
      method,
      params,
    };

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.#timeoutMs);

    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${MCP_PATH}`, {
        method:  "POST",
        headers: {
          "User-Agent":     this.#userAgent,
          "Authorization": `Bearer ${this.#apiKey}`,
          "Content-Type":  "application/json",
        },
        body:    JSON.stringify(body),
        signal:  ac.signal,
      });
    } catch (e) {
      const cause = e as { name?: string };
      if (cause?.name === "AbortError") {
        throw new ConcordiaProtocolError(
          `Concordia request timed out after ${this.#timeoutMs}ms`,
          { cause: e },
        );
      }
      throw new ConcordiaProtocolError(
        `Concordia transport error: ${(e as Error).message}`,
        { cause: e },
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.status !== 200) {
      const text = await response.text().catch(() => "");
      throw new ConcordiaProtocolError(
        `Concordia returned HTTP ${response.status}`,
        { data: { status: response.status, body: text.slice(0, 1000) } },
      );
    }

    let envelope: JrpcResponse;
    try {
      envelope = (await response.json()) as JrpcResponse;
    } catch (e) {
      throw new ConcordiaProtocolError(
        "Concordia returned non-JSON body",
        { cause: e },
      );
    }

    if (envelope.jsonrpc !== "2.0") {
      throw new ConcordiaProtocolError(
        `Envelope jsonrpc != "2.0" (got ${String(envelope.jsonrpc)})`,
      );
    }

    if (envelope.error !== undefined) {
      const err = envelope.error;
      const code = err.code;
      const data = err.data ?? {};
      const errorId = (data["error_id"] as string | undefined) ?? null;
      const Cls = (code !== undefined && ERROR_CLASS_BY_CODE[code])
        || ConcordiaError;
      throw new Cls(err.message ?? "", {
        code,
        errorId,
        data,
      });
    }

    if (!("result" in envelope)) {
      throw new ConcordiaProtocolError(
        "Envelope missing both `result` and `error`",
      );
    }

    return envelope.result as T;
  }

  async #callTool<T extends Record<string, unknown>>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    const result = await this.#rpc<ToolResponse>("tools/call", {
      name,
      arguments: args,
    });
    if (result == null || typeof result !== "object") {
      throw new ConcordiaProtocolError(
        `tools/call ${name} returned non-object`,
      );
    }
    if (result._data && typeof result._data === "object") {
      return result._data as T;
    }
    // Fallback: parse the canonical content[].text JSON block.
    for (const block of result.content ?? []) {
      if (block.type === "text" && typeof block.text === "string") {
        try {
          return JSON.parse(block.text) as T;
        } catch {
          continue;
        }
      }
    }
    throw new ConcordiaProtocolError(
      `tools/call ${name} response had no decodable content`,
    );
  }

  // -- discovery -----------------------------------------------------------

  /** MCP initialize handshake. Returns the raw server response. */
  initialize(): Promise<Record<string, unknown>> {
    return this.#rpc<Record<string, unknown>>("initialize");
  }

  /** Liveness check. Resolves true if the server returned `{ok: true}`. */
  async ping(): Promise<boolean> {
    const r = await this.#rpc<{ ok?: unknown }>("ping");
    return Boolean(r?.ok);
  }

  /** Return raw tool descriptors. */
  async toolsList(): Promise<readonly Record<string, unknown>[]> {
    const r = await this.#rpc<{ tools?: Record<string, unknown>[] }>("tools/list");
    return r.tools ?? [];
  }

  /** Return raw resource descriptors. */
  async resourcesList(): Promise<readonly Record<string, unknown>[]> {
    const r = await this.#rpc<{ resources?: Record<string, unknown>[] }>(
      "resources/list",
    );
    return r.resources ?? [];
  }

  // -- the four tools ------------------------------------------------------

  async enforceCovenant(args: EnforceCovenantArgs): Promise<EnforceCovenantResult> {
    const d = await this.#callTool<{
      verdict?: string;
      policy_ids?: string[];
      rationale?: string;
      cb_state_change?: { state?: string; warning?: boolean; soul_version?: number };
      ledger_entry_id?: string;
    }>("enforce_covenant", {
      subject_id:     args.subjectId,
      action_kind:    args.actionKind,
      action_payload: args.actionPayload ?? {},
      context:        args.context        ?? {},
    });
    const cb = d.cb_state_change ?? {};
    const verdict = (d.verdict ?? "") as Verdict;
    const result: EnforceCovenantResult = {
      verdict,
      policyIds:     d.policy_ids ?? [],
      rationale:     d.rationale  ?? "",
      cbStateChange: {
        state:       cb.state ?? "",
        warning:     Boolean(cb.warning),
        soulVersion: cb.soul_version ?? null,
      },
      ledgerEntryId: d.ledger_entry_id ?? "",
      allow:         verdict === "allow",
      blocked:       verdict === "block",
    };
    return result;
  }

  async recordDecision(args: RecordDecisionArgs): Promise<RecordDecisionResult> {
    const d = await this.#callTool<{
      ledger_entry_id?: string;
      chain_head_hash?: string;
      index?: number;
    }>("record_decision", {
      subject_id:    args.subjectId,
      decision_kind: args.decisionKind,
      payload:       args.payload ?? {},
      actor:         args.actor   ?? "agent",
      outcome:       args.outcome ?? "completed",
    });
    return {
      ledgerEntryId: d.ledger_entry_id ?? "",
      chainHeadHash: d.chain_head_hash ?? "",
      index:         d.index ?? null,
    };
  }

  async queryCorpus(args: QueryCorpusArgs): Promise<QueryCorpusResult> {
    const wireArgs: Record<string, unknown> = {
      query: args.query,
      scope: args.scope ?? "installed",
      limit: args.limit ?? 20,
    };
    if (args.canonFilter && args.canonFilter.length > 0) {
      wireArgs["canon_filter"] = [...args.canonFilter];
    }
    const d = await this.#callTool<{
      matches?: Array<{
        canon_id?: string; canon_version?: string;
        section?: string; excerpt?: string; relevance?: number;
      }>;
      scope?: string;
      canon_count?: number;
    }>("query_corpus", wireArgs);
    return {
      matches: (d.matches ?? []).map((m) => ({
        canonId:      m.canon_id      ?? "",
        canonVersion: m.canon_version ?? "",
        section:      m.section       ?? "",
        excerpt:      m.excerpt       ?? "",
        relevance:    Number(m.relevance ?? 0),
      })),
      scope:      d.scope       ?? wireArgs["scope"] as string,
      canonCount: d.canon_count ?? 0,
    };
  }

  async getSubjectSoul(args: GetSubjectSoulArgs): Promise<SubjectSoul> {
    const wireArgs: Record<string, unknown> = {
      subject_id: args.subjectId,
      depth:      args.depth ?? "latest",
    };
    if (args.tagFilter && args.tagFilter.length > 0) {
      wireArgs["tag_filter"] = [...args.tagFilter];
    }
    const d = await this.#callTool<{
      subject_id?: string;
      snapshot_at?: string;
      soul_version?: number;
      retired_count?: number;
      tags?: Array<{
        tag_id?: string; score?: number; raw_strength?: number;
        evidence_count?: number;
        first_observed_at?: string; last_reinforced_at?: string;
      }>;
      recent_traces?: Array<{
        trace_id?: string; frame_id?: string | null;
        verdict?: string | null; outcome?: string;
        started_at?: string; finished_at?: string | null;
      }>;
    }>("get_subject_soul", wireArgs);
    return {
      subjectId:    d.subject_id   ?? args.subjectId,
      snapshotAt:   d.snapshot_at  ?? "",
      soulVersion:  d.soul_version ?? 0,
      retiredCount: d.retired_count ?? 0,
      tags: (d.tags ?? []).map((t) => ({
        tagId:              t.tag_id            ?? "",
        score:              Number(t.score ?? 0),
        rawStrength:        t.raw_strength      ?? null,
        evidenceCount:      t.evidence_count    ?? 0,
        firstObservedAt:    t.first_observed_at  ?? "",
        lastReinforcedAt:   t.last_reinforced_at ?? "",
      })),
      recentTraces: (d.recent_traces ?? []).map((tr) => ({
        traceId:    tr.trace_id    ?? "",
        frameId:    tr.frame_id    ?? null,
        verdict:    tr.verdict     ?? null,
        outcome:    tr.outcome     ?? "",
        startedAt:  tr.started_at  ?? "",
        finishedAt: tr.finished_at ?? null,
      })),
    };
  }

  // -- resources -----------------------------------------------------------

  async #readResource<T extends Record<string, unknown>>(uri: string): Promise<T> {
    const r = await this.#rpc<ResourceReadResponse>("resources/read", { uri });
    for (const block of r.contents ?? []) {
      if (block.mimeType === "application/json" && typeof block.text === "string") {
        try {
          return JSON.parse(block.text) as T;
        } catch (e) {
          throw new ConcordiaProtocolError(
            `resources/read ${uri} returned non-JSON content`,
            { cause: e },
          );
        }
      }
    }
    throw new ConcordiaProtocolError(
      `resources/read ${uri} returned no JSON content block`,
    );
  }

  async workspacePolicies(): Promise<PolicySummary[]> {
    const d = await this.#readResource<{
      policies?: Array<{
        cb_policy_id?: string; name?: string; description?: string;
        scope?: string; action?: string; enabled?: boolean;
        rules?: Record<string, unknown>[]; updated_at?: string;
      }>;
    }>("concordia:/workspace/policies");
    return (d.policies ?? []).map((p) => ({
      cbPolicyId:  p.cb_policy_id ?? "",
      name:        p.name        ?? "",
      description: p.description ?? "",
      scope:       p.scope       ?? "",
      action:      p.action      ?? "",
      enabled:     Boolean(p.enabled),
      rules:       p.rules ?? [],
      updatedAt:   p.updated_at  ?? null,
    }));
  }

  async workspaceCanons(): Promise<InstalledCanon[]> {
    const d = await this.#readResource<{
      canons?: Array<{
        canon_id?: string; name?: string; category?: string;
        author_name?: string; latest_version?: string;
        short_description?: string; icon_url?: string;
        enabled?: boolean; installed_at?: string;
      }>;
    }>("concordia:/workspace/canons");
    return (d.canons ?? []).map((c) => ({
      canonId:          c.canon_id          ?? "",
      name:             c.name              ?? "",
      category:         c.category          ?? null,
      authorName:       c.author_name       ?? null,
      latestVersion:    c.latest_version    ?? null,
      shortDescription: c.short_description ?? "",
      iconUrl:          c.icon_url          ?? null,
      enabled:          Boolean(c.enabled),
      installedAt:      c.installed_at      ?? null,
    }));
  }

  async recentLedger(args: RecentLedgerArgs = {}): Promise<LedgerPage> {
    const since = args.since ?? 0;
    const limit = args.limit ?? 100;
    const uri = `concordia:/workspace/recent-ledger?since=${since}&limit=${limit}`;
    const d = await this.#readResource<{
      since?: number; limit?: number; count?: number; next_since?: number | null;
      entries?: Array<{
        event_id?: string; index?: number; prev_hash?: string;
        payload_hash?: string; hash?: string;
        payload?: Record<string, unknown>; recorded_at?: string;
      }>;
    }>(uri);
    const entries: LedgerEntry[] = (d.entries ?? []).map((e) => ({
      eventId:     e.event_id     ?? "",
      index:       e.index        ?? 0,
      prevHash:    e.prev_hash    ?? "",
      payloadHash: e.payload_hash ?? "",
      hash:        e.hash         ?? "",
      payload:     e.payload      ?? {},
      recordedAt:  e.recorded_at  ?? "",
    }));
    return {
      entries,
      since:      d.since ?? since,
      limit:      d.limit ?? limit,
      count:      d.count ?? entries.length,
      nextSince:  d.next_since ?? null,
    };
  }

  /**
   * Async generator: yield every ledger entry from `since` onwards,
   * paginating under the hood. Stops when a page returns `nextSince: null`.
   *
   *   for await (const entry of client.iterLedger({ since: 0 })) {
   *     verify(entry);
   *   }
   */
  async *iterLedger(args: RecentLedgerArgs = {}): AsyncGenerator<LedgerEntry> {
    let cursor: number | null = args.since ?? 0;
    const pageSize = args.limit ?? 100;
    while (cursor !== null) {
      const page: LedgerPage = await this.recentLedger({
        since: cursor,
        limit: pageSize,
      });
      for (const entry of page.entries) {
        yield entry;
      }
      cursor = page.nextSince;
    }
  }
}
