/**
 * The DMZAgent TypeScript client — the SDK's main entry point.
 *
 * Quick start:
 *
 *   import { DMZAgent } from "@dmzagent/sdk";
 *
 *   const cx = new DMZAgent({ apiKey: "ck_..." });
 *
 *   await cx.subjectSays({
 *     agentSubjectId: "subject:dv:bot",
 *     subjectId:      "subject:dv:cust",
 *     text:           "I want a refund.",
 *   });
 *
 *   const g = await cx.check({ subjectId: "subject:dv:bot" });
 *   if (!g.allow) return refuse(g.reason);
 *
 * Naming follows spec §8: `DMZAgent` (no `Client` suffix), camelCase
 * methods and option keys, `…Error` exception names.
 *
 * Auth: agent-stream and circuit-breaker requests carry
 * `Authorization: Bearer ck_…`. The API key resolves server-side to the
 * workspace; the wire never carries a workspace id directly.
 *
 * Transport: by default the client uses the runtime's global `fetch`
 * (Node >= 18, browsers, Workers). A custom `fetch` impl can be injected
 * at construction time (the contract-test runner uses this to stub the
 * HTTP layer).
 */

import { Conversation as ConversationImpl } from "./conversation.js";
import { SPEC_VERSION } from "./version.js";
import {
  AuthError,
  CBOpenError,
  DMZAgentError,
  PermissionError,
  ServerError,
  ValidationError,
  ConflictError,
  RateLimitError,
} from "./errors.js";
import {
  type CaptureResult,
  type CheckResult,
  type DivisionConfig,
  type EmitResult,
  type NotificationPrefs,
  type OutcomeResult,
  type Subject,
  captureResultFromResponse,
  checkResultFromResponse,
  divisionConfigFromResponse,
  emitResultFromResponse,
  notificationPrefsFromResponse,
  outcomeResultFromResponse,
} from "./models.js";

// ---------- public constants ----------

/**
 * The event kinds accepted by `/v1/agent-stream/event`. The on-wire
 * `kind` string is always the snake_case form regardless of how a
 * binding exposes the enum (spec §8.6).
 */
export const EVENT_KINDS = [
  "subject_says",
  "tool_call",
  "tool_result",
  "observation",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const EVENT_SUBJECT_TYPES = [
  "chat", "sensor", "lead", "ticket", "journey",
] as const;
export type EventSubjectType = (typeof EVENT_SUBJECT_TYPES)[number];

// ---------- defaults ----------

const DEFAULT_BASE_URL = "https://api.dmzagent.com";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_USER_AGENT = `dmzagent-typescript/${SPEC_VERSION}`;

// Type alias compatible with global `fetch`. The call sites only need
// `(url, init) => Promise<Response>` so we use the widest viable type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FetchLike = (input: any, init?: any) => Promise<any>;

// ---------- constructor options ----------

export interface DMZAgentOptions {
  apiKey: string;
  baseUrl?: string;
  /** Request timeout in milliseconds. Defaults to 10000. */
  timeout?: number;
  userAgent?: string;
  /** Custom `fetch` implementation; tests inject a stub here. */
  fetch?: FetchLike;
}

// ---------- method-arg shapes ----------

export interface EmitEventOptions {
  kind: EventKind | string;
  subjectType?: string;
  agentSubjectId: string;
  payload?: Record<string, unknown>;
  interactionId?: string;
  interactionKind?: string;
  subjects?: ReadonlyArray<Subject>;
  speakerSubjectId?: string;
  speakerRole?: string;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
  /**
   * Caller-generated key making a retry of this request safe (spec §1.8).
   *
   * Supplied by the caller only — the SDK never invents one. A key minted
   * per call is unique per call and deduplicates nothing; a key derived
   * from the payload would collapse two genuinely distinct events that
   * happen to be identical.
   */
  idempotencyKey?: string;
}

export interface SubjectSaysOptions {
  /** The speaker (could be agent, customer, sensor — any subject). */
  subjectId: string;
  text: string;
  /** REQUIRED — every event is grounded against an agent identity. */
  agentSubjectId: string;
  subjectType?: string;
  interactionId?: string;
  interactionKind?: string;
  subjects?: ReadonlyArray<Subject>;
  /** Extra payload fields merged alongside `{text}`. */
  payloadExtra?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
  /** See `EmitEventOptions.idempotencyKey` (spec §1.8). */
  idempotencyKey?: string;
}

export interface ToolCallOptions {
  /** The agent invoking the tool (also `agent_subject_id` on the wire). */
  subjectId: string;
  tool: string;
  subjectType?: string;
  args?: Record<string, unknown>;
  interactionId?: string;
  interactionKind?: string;
  subjects?: ReadonlyArray<Subject>;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
  /** See `EmitEventOptions.idempotencyKey` (spec §1.8). */
  idempotencyKey?: string;
}

export interface ToolResultOptions {
  subjectId: string;
  tool: string;
  subjectType?: string;
  result: unknown;
  interactionId?: string;
  interactionKind?: string;
  subjects?: ReadonlyArray<Subject>;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
  /** See `EmitEventOptions.idempotencyKey` (spec §1.8). */
  idempotencyKey?: string;
}

export interface ObservationOptions {
  agentSubjectId: string;
  subjectType?: string;
  subjects: ReadonlyArray<Subject>;
  payload: Record<string, unknown>;
  interactionId?: string;
  interactionKind?: string;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
  /** See `EmitEventOptions.idempotencyKey` (spec §1.8). */
  idempotencyKey?: string;
}

export interface CheckOptions {
  subjectId?: string;
  interactionId?: string;
}

export interface ConversationOptions {
  participants: ReadonlyArray<Subject>;
  agentSubjectId?: string;
  kind?: string;
  metadata?: Record<string, unknown>;
}

export interface CaptureOptions {
  subjectId: string;
  kind: EventKind | string;
  subjectType: string;
  payload?: Record<string, unknown>;
  agentSubjectId?: string;
  interactionId?: string;
  interactionKind?: string;
  subjects?: ReadonlyArray<Subject>;
  speakerSubjectId?: string;
  speakerRole?: string;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
  /**
   * Caller-generated key making a retry of this request safe (spec §1.8).
   *
   * Supplied by the caller only — the SDK never invents one. A key minted
   * per call is unique per call and deduplicates nothing; a key derived
   * from the payload would collapse two genuinely distinct events that
   * happen to be identical.
   */
  idempotencyKey?: string;
}

export interface AwaitOutcomeOptions {
  frameId: string;
  timeout?: number;
}

// ---------- the client ----------

export class DMZAgent {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #timeout: number;
  readonly #userAgent: string;
  readonly #fetch: FetchLike;
  #closed = false;

  constructor(options: DMZAgentOptions) {
    const apiKey = options?.apiKey;
    if (typeof apiKey !== "string" || apiKey.length === 0 || !apiKey.startsWith("ck_")) {
      throw new ValidationError(
        "apiKey must start with 'ck_' — get one from your tenant_admin",
      );
    }
    this.#apiKey = apiKey;
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    this.#userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    const injectedFetch = options.fetch;
    if (injectedFetch) {
      this.#fetch = injectedFetch;
    } else if (typeof globalThis.fetch === "function") {
      this.#fetch = globalThis.fetch.bind(globalThis) as FetchLike;
    } else {
      throw new ValidationError("fetch is not available; provide options.fetch");
    }
  }

  // ===================================================================== //
  // Event emission — /v1/agent-stream/event
  // ===================================================================== //

  /**
   * Low-level event emitter. Every higher-level helper delegates here.
   */
  async emitEvent(opts: EmitEventOptions): Promise<EmitResult> {
    if (!opts || typeof opts !== "object") {
      throw new ValidationError("emitEvent requires an options object");
    }
    if (!isKnownEventKind(opts.kind)) {
      throw new ValidationError(
        `kind must be one of [${EVENT_KINDS.join(", ")}], got ${JSON.stringify(opts.kind)}`,
      );
    }
    if (opts.subjectType && typeof opts.subjectType === "string" && !(EVENT_SUBJECT_TYPES as ReadonlyArray<string>).includes(opts.subjectType)) {
      throw new ValidationError(
        `subjectType must be one of [${EVENT_SUBJECT_TYPES.join(", ")}], got ${JSON.stringify(opts.subjectType)}`,
      );
    }
    if (typeof opts.agentSubjectId !== "string" || opts.agentSubjectId.length === 0) {
      throw new ValidationError("agentSubjectId is required");
    }

    const body: Record<string, unknown> = {
      kind: opts.kind,
      agent_subject_id: opts.agentSubjectId,
      payload: opts.payload ?? {},
    };
    if (opts.subjectType) body["subject_type"] = opts.subjectType;
    if (opts.interactionId) body["interaction_id"] = opts.interactionId;
    // Always emit interaction_kind — spec says default is "chat_session"
    // and the golden envelopes round-trip it on every event.
    body["interaction_kind"] = opts.interactionKind ?? "chat_session";
    if (opts.subjects && opts.subjects.length > 0) body["subjects"] = opts.subjects;
    if (opts.speakerSubjectId) body["speaker_subject_id"] = opts.speakerSubjectId;
    if (opts.speakerRole) body["speaker_role"] = opts.speakerRole;
    if (opts.occurredAt) body["occurred_at"] = opts.occurredAt;
    if (opts.metadata && Object.keys(opts.metadata).length > 0) {
      body["metadata"] = opts.metadata;
    }

    const data = await this.#postJson(
      "/v1/agent-stream/event",
      body,
      opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : undefined,
    );
    return emitResultFromResponse(data);
  }

  /**
   * A subject in the conversation said something.
   *
   * `subjectId` names the speaker (any kind of subject). `agentSubjectId`
   * is REQUIRED — every event grounds against an agent identity per the
   * wire protocol.
   */
  async subjectSays(opts: SubjectSaysOptions): Promise<EmitResult> {
    if (!opts || typeof opts !== "object") {
      throw new ValidationError("subjectSays requires an options object");
    }
    if (typeof opts.subjectId !== "string" || opts.subjectId.length === 0) {
      throw new ValidationError("subjectId is required");
    }
    if (typeof opts.text !== "string") {
      throw new ValidationError("text is required");
    }
    if (typeof opts.agentSubjectId !== "string" || opts.agentSubjectId.length === 0) {
      throw new ValidationError(
        "agentSubjectId is required — every event grounds against an agent identity",
      );
    }
    return this.emitEvent({
      kind: "subject_says",
      ...(opts.subjectType ? { subjectType: opts.subjectType } : {}),
      agentSubjectId: opts.agentSubjectId,
      payload: { text: opts.text, ...(opts.payloadExtra ?? {}) },
      ...(opts.interactionId ? { interactionId: opts.interactionId } : {}),
      ...(opts.interactionKind ? { interactionKind: opts.interactionKind } : {}),
      ...(opts.subjects ? { subjects: opts.subjects } : {}),
      speakerSubjectId: opts.subjectId,
      ...(opts.metadata ? { metadata: opts.metadata } : {}),
      ...(opts.occurredAt ? { occurredAt: opts.occurredAt } : {}),
      ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
    });
  }

  /**
   * An agent invoked a tool. Emit BEFORE the tool runs — this records
   * the intent. Pair with `toolResult` after the call completes.
   */
  async toolCall(opts: ToolCallOptions): Promise<EmitResult> {
    if (!opts || typeof opts !== "object") {
      throw new ValidationError("toolCall requires an options object");
    }
    if (typeof opts.subjectId !== "string" || opts.subjectId.length === 0) {
      throw new ValidationError("subjectId is required");
    }
    if (typeof opts.tool !== "string" || opts.tool.length === 0) {
      throw new ValidationError("tool is required");
    }
    return this.emitEvent({
      kind: "tool_call",
      ...(opts.subjectType ? { subjectType: opts.subjectType } : {}),
      agentSubjectId: opts.subjectId,
      payload: { tool: opts.tool, args: opts.args ?? {} },
      ...(opts.interactionId ? { interactionId: opts.interactionId } : {}),
      ...(opts.interactionKind ? { interactionKind: opts.interactionKind } : {}),
      ...(opts.subjects ? { subjects: opts.subjects } : {}),
      speakerSubjectId: opts.subjectId,
      speakerRole: "agent",
      ...(opts.metadata ? { metadata: opts.metadata } : {}),
      ...(opts.occurredAt ? { occurredAt: opts.occurredAt } : {}),
      ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
    });
  }

  /**
   * A tool returned a result. Pair with the prior `toolCall`.
   */
  async toolResult(opts: ToolResultOptions): Promise<EmitResult> {
    if (!opts || typeof opts !== "object") {
      throw new ValidationError("toolResult requires an options object");
    }
    if (typeof opts.subjectId !== "string" || opts.subjectId.length === 0) {
      throw new ValidationError("subjectId is required");
    }
    if (typeof opts.tool !== "string" || opts.tool.length === 0) {
      throw new ValidationError("tool is required");
    }
    return this.emitEvent({
      kind: "tool_result",
      ...(opts.subjectType ? { subjectType: opts.subjectType } : {}),
      agentSubjectId: opts.subjectId,
      payload: { tool: opts.tool, result: opts.result },
      ...(opts.interactionId ? { interactionId: opts.interactionId } : {}),
      ...(opts.interactionKind ? { interactionKind: opts.interactionKind } : {}),
      ...(opts.subjects ? { subjects: opts.subjects } : {}),
      speakerSubjectId: opts.subjectId,
      ...(opts.metadata ? { metadata: opts.metadata } : {}),
      ...(opts.occurredAt ? { occurredAt: opts.occurredAt } : {}),
      ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
    });
  }

  /**
   * Structured observation — video keyframe, IoT, sensor reading, any
   * event that doesn't fit a speech-bubble shape.
   */
  async observation(opts: ObservationOptions): Promise<EmitResult> {
    if (!opts || typeof opts !== "object") {
      throw new ValidationError("observation requires an options object");
    }
    if (typeof opts.agentSubjectId !== "string" || opts.agentSubjectId.length === 0) {
      throw new ValidationError("agentSubjectId is required");
    }
    if (!Array.isArray(opts.subjects) || opts.subjects.length === 0) {
      throw new ValidationError("subjects is required (non-empty array)");
    }
    if (!opts.payload || typeof opts.payload !== "object") {
      throw new ValidationError("payload is required");
    }
    return this.emitEvent({
      kind: "observation",
      ...(opts.subjectType ? { subjectType: opts.subjectType } : {}),
      agentSubjectId: opts.agentSubjectId,
      payload: opts.payload,
      ...(opts.interactionId ? { interactionId: opts.interactionId } : {}),
      ...(opts.interactionKind ? { interactionKind: opts.interactionKind } : {}),
      subjects: opts.subjects,
      ...(opts.metadata ? { metadata: opts.metadata } : {}),
      ...(opts.occurredAt ? { occurredAt: opts.occurredAt } : {}),
      ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
    });
  }

  // ===================================================================== //
  // Circuit breaker — /v1/cb/check
  // ===================================================================== //

  /**
   * Synchronous circuit-breaker check.
   *
   * Pass EXACTLY ONE of `subjectId` or `interactionId`. Passing both or
   * neither raises ValidationError (spec §5.6).
   */
  async check(opts: CheckOptions = {}): Promise<CheckResult> {
    const hasSubject = typeof opts.subjectId === "string" && opts.subjectId.length > 0;
    const hasInteraction =
      typeof opts.interactionId === "string" && opts.interactionId.length > 0;
    if (hasSubject === hasInteraction) {
      throw new ValidationError("pass exactly one of subjectId or interactionId");
    }
    const scope = hasSubject ? "subject" : "interaction";
    const scopeRef = hasSubject ? opts.subjectId! : opts.interactionId!;
    const data = await this.#postJson("/v1/cb/check", {
      scope,
      scope_ref: scopeRef,
    });
    return checkResultFromResponse(data);
  }

  /**
   * Resource-scoped wrapper around `check()`.
   *
   * Disposable form (TS 5.2+):
   *
   *   {
   *     using g = await cx.guard({ subjectId: "subject:dv:bot" });
   *     if (!g.result.allow) return refuse(g.result.reason);
   *     // ...sensitive action
   *   }
   *
   * Callback fallback (for runtimes without explicit-resource-management):
   *
   *   await cx.guard({ subjectId: "subject:dv:bot" }, async (result) => {
   *     if (!result.allow) return refuse(result.reason);
   *     await doSensitiveThing();
   *   });
   *
   * With `raiseOnOpen=true`, a CBOpenError throws before the result is
   * yielded if the breaker is open.
   */
  guard(
    opts: CheckOptions & { raiseOnOpen?: boolean },
  ): Promise<GuardHandle>;
  guard<T>(
    opts: CheckOptions & { raiseOnOpen?: boolean },
    fn: (result: CheckResult) => Promise<T> | T,
  ): Promise<T>;
  async guard<T>(
    opts: CheckOptions & { raiseOnOpen?: boolean },
    fn?: (result: CheckResult) => Promise<T> | T,
  ): Promise<GuardHandle | T> {
    const result = await this.check({
      ...(opts.subjectId ? { subjectId: opts.subjectId } : {}),
      ...(opts.interactionId ? { interactionId: opts.interactionId } : {}),
    });
    if (opts.raiseOnOpen && !result.allow) {
      throw new CBOpenError(`circuit breaker open: ${result.reason}`, {
        reason: result.reason,
        firedPolicies: result.firedPolicies,
        anchor: result.anchor,
        scopeRef: opts.subjectId ?? opts.interactionId ?? "",
      });
    }
    if (fn) return await fn(result);
    return buildGuardHandle(result);
  }

  // ===================================================================== //
  // Conversation — high-level handle for the single-agent-one-customer
  // case and its multi-subject generalizations.
  // ===================================================================== //

  conversation(opts: ConversationOptions): ConversationImpl {
    return new ConversationImpl(this, opts);
  }

  // ===================================================================== //
  // Capture — /v1/agent-stream/event (accepted-only)
  // ===================================================================== //

  /**
   * Low-level capture. Returns immediately with accepted-only ack.
   * Per-workspace reasoning outcomes are retrieved via `awaitOutcome()`.
   */
  async capture(opts: CaptureOptions): Promise<CaptureResult> {
    if (!opts || typeof opts !== "object") {
      throw new ValidationError("capture requires an options object");
    }
    if (typeof opts.subjectId !== "string" || opts.subjectId.length === 0) {
      throw new ValidationError("subjectId is required");
    }
    if (typeof opts.kind !== "string" || opts.kind.length === 0) {
      throw new ValidationError("kind is required");
    }
    if (typeof opts.subjectType !== "string" || !(EVENT_SUBJECT_TYPES as ReadonlyArray<string>).includes(opts.subjectType)) {
      throw new ValidationError(
        `subjectType must be one of [${EVENT_SUBJECT_TYPES.join(", ")}], got ${JSON.stringify(opts.subjectType)}`,
      );
    }

    const body: Record<string, unknown> = {
      kind: opts.kind,
      subject_id: opts.subjectId,
      subject_type: opts.subjectType,
      payload: opts.payload ?? {},
    };
    if (opts.agentSubjectId) body["agent_subject_id"] = opts.agentSubjectId;
    if (opts.interactionId) body["interaction_id"] = opts.interactionId;
    body["interaction_kind"] = opts.interactionKind ?? "chat_session";
    if (opts.subjects && opts.subjects.length > 0) body["subjects"] = opts.subjects;
    if (opts.speakerSubjectId) body["speaker_subject_id"] = opts.speakerSubjectId;
    if (opts.speakerRole) body["speaker_role"] = opts.speakerRole;
    if (opts.occurredAt) body["occurred_at"] = opts.occurredAt;
    if (opts.metadata && Object.keys(opts.metadata).length > 0) body["metadata"] = opts.metadata;

    const data = await this.#postJson(
      "/v1/agent-stream/event",
      body,
      opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : undefined,
    );
    return captureResultFromResponse(data);
  }

  // ===================================================================== //
  // Await outcome — /v1/frames/{id}/story (polling)
  // ===================================================================== //

  async awaitOutcome(opts: AwaitOutcomeOptions): Promise<OutcomeResult> {
    const timeout = Math.min(opts.timeout ?? 30, 120);
    const start = Date.now();
    const end = start + timeout * 1000;
    let delay = 100;
    let lastError: Error | undefined;

    while (Date.now() < end) {
      await new Promise(r => setTimeout(r, delay));
      try {
        const data = await this.#getJson(`/v1/frames/${encodeURIComponent(opts.frameId)}/story`);
        return outcomeResultFromResponse(data);
      } catch (e) {
        lastError = e as Error;
        if (e instanceof ValidationError || e instanceof AuthError || e instanceof PermissionError) {
          throw e;
        }
      }
      delay = Math.min(delay * 2, 2000);
    }
    throw new ServerError(`await_outcome timed out after ${timeout}s for frame ${opts.frameId}`, {
      body: lastError?.message ?? null,
    });
  }

  // ===================================================================== //
  // Notification preferences — /v1/settings/notifications
  // ===================================================================== //

  /**
   * Fetch the current user's notification preferences, including
   * email cadence, push state, phone/SMS/WhatsApp settings.
   */
  async getNotificationPrefs(): Promise<NotificationPrefs> {
    const data = await this.#getJson("/v1/settings/notifications");
    return notificationPrefsFromResponse(data);
  }

  /**
   * Update notification preferences. Only supplied fields are touched.
   *
   * Supported fields: `email_cadence` (off|daily|weekly),
   * `push_enabled` (boolean), `phone` (E.164 string),
   * `sms_enabled` (boolean), `whatsapp_enabled` (boolean).
   */
  async updateNotificationPrefs(
    prefs: Record<string, unknown>,
  ): Promise<NotificationPrefs> {
    const data = await this.#putJson("/v1/settings/notifications", prefs);
    return notificationPrefsFromResponse(data);
  }

  // ===================================================================== //
  // Division config — /v1/divisions/{id}/config
  // ===================================================================== //

  /**
   * Read a division's JSON config blob. Contains settings like
   * `reasoning_mode` ("per_frame" | "per_trace").
   */
  async getDivisionConfig(divisionId: string): Promise<DivisionConfig> {
    const path = `/v1/divisions/${encodeURIComponent(divisionId)}/config`;
    const data = await this.#getJson(path);
    return divisionConfigFromResponse(data);
  }

  /**
   * Replace a division's JSON config blob. Pass the full config object
   * (merge happens server-side).
   */
  async updateDivisionConfig(
    divisionId: string,
    config: Record<string, unknown>,
  ): Promise<DivisionConfig> {
    const data = await this.#putJson(
      `/v1/divisions/${encodeURIComponent(divisionId)}/config`,
      config,
    );
    return divisionConfigFromResponse(data);
  }

  // ===================================================================== //
  // Resource management
  // ===================================================================== //

  /**
   * Release the underlying transport. Idempotent — calling more than
   * once is a no-op.
   *
   * Note: the default `fetch`-based transport has no persistent client
   * to close. This method exists for parity with the spec's lifecycle
   * contract (§4.3) and to leave room for a future keep-alive pool.
   */
  close(): void {
    this.#closed = true;
  }

  /** @returns true once close() has been called. */
  get closed(): boolean {
    return this.#closed;
  }

  // ===================================================================== //
  // Internal — HTTP plumbing
  // ===================================================================== //

  async #putJson(
    path: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const url = `${this.#baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeout);
    let response: Response;
    try {
      response = (await this.#fetch(url, {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${this.#apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": this.#userAgent,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })) as Response;
    } catch (e: unknown) {
      const err = e as { name?: string; message?: string };
      if (err?.name === "AbortError") {
        throw new ServerError(`timeout calling ${path}`, {
          cause: e,
          body: err?.message ?? null,
        });
      }
      throw new ServerError(`network error calling ${path}: ${err?.message ?? String(e)}`, {
        cause: e,
      });
    } finally {
      clearTimeout(timer);
    }
    return await this.#handle(response, path);
  }

  async #postJson(
    path: string,
    body: Record<string, unknown>,
    extraHeaders?: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const url = `${this.#baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeout);
    let response: Response;
    try {
      response = (await this.#fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.#apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": this.#userAgent,
          ...(extraHeaders ?? {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })) as Response;
    } catch (e: unknown) {
      const err = e as { name?: string; message?: string };
      if (err?.name === "AbortError") {
        throw new ServerError(`timeout calling ${path}`, {
          cause: e,
          body: err?.message ?? null,
        });
      }
      throw new ServerError(`network error calling ${path}: ${err?.message ?? String(e)}`, {
        cause: e,
      });
    } finally {
      clearTimeout(timer);
    }
    return await this.#handle(response, path);
  }

  async #getJson(path: string): Promise<Record<string, unknown>> {
    const url = `${this.#baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeout);
    let response: Response;
    try {
      response = (await this.#fetch(url, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${this.#apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": this.#userAgent,
        },
        signal: controller.signal,
      })) as Response;
    } catch (e: unknown) {
      const err = e as { name?: string; message?: string };
      if (err?.name === "AbortError") {
        throw new ServerError(`timeout calling ${path}`, {
          cause: e, body: err?.message ?? null,
        });
      }
      throw new ServerError(`network error calling ${path}: ${err?.message ?? String(e)}`, {
        cause: e,
      });
    } finally {
      clearTimeout(timer);
    }
    return await this.#handle(response, path);
  }

  async #handle(
    response: Response,
    path: string,
  ): Promise<Record<string, unknown>> {
    const status = response.status;
    const text = await safeText(response);
    const parsed = safeJsonParse(text);

    if (status >= 200 && status < 300) {
      return (parsed ?? {}) as Record<string, unknown>;
    }

    const body: unknown = parsed ?? text;
    const init = { statusCode: status, body };

    // 400 and 422 both mean "fix the request" — malformed vs
    // parsed-but-rejected. The spec taxonomy maps both to ValidationError;
    // statusCode tells them apart for callers that care.
    if (status === 400 || status === 422) {
      throw new ValidationError(
        `server rejected request to ${path}: ${formatBody(body)}`,
        init,
      );
    }
    // 409 is the Idempotency-Key in-flight conflict (spec §1.8). Kept off
    // the ServerError branch: the duplicate is the caller's own earlier
    // request, so retrying the same key replays its response instead of
    // causing a second side effect.
    if (status === 409) {
      throw new ConflictError(
        `a request with this Idempotency-Key is already in flight on ${path}`,
        init,
      );
    }
    if (status === 429) {
      throw new RateLimitError(`rate limited on ${path}`, {
        ...init,
        retryAfter: parseRetryAfter(response.headers.get("Retry-After")),
      });
    }
    if (status === 401) {
      throw new AuthError("invalid or revoked API key", init);
    }
    if (status === 403) {
      throw new PermissionError(
        "API key lacks required scope for this operation",
        init,
      );
    }
    if (status >= 500) {
      throw new ServerError(`server error from ${path} (${status})`, init);
    }
    throw new DMZAgentError(`unexpected status ${status} from ${path}`, init);
  }
}

// ---------- guard helpers (TS 5.2 explicit resource management) ----------

export interface GuardHandle {
  readonly result: CheckResult;
  [Symbol.dispose](): void;
}

function buildGuardHandle(result: CheckResult): GuardHandle {
  // Symbol.dispose is the TC39 explicit-resource-management symbol that
  // backs the `using` declaration. We polyfill the symbol if the runtime
  // hasn't surfaced it yet — older Node versions still need the value
  // even though `using` itself is a TS 5.2+ syntax sugar.
  const runtimeDisposeSymbol =
    typeof Symbol.dispose === "symbol"
      ? Symbol.dispose
      : (Symbol.for("nodejs.dispose") as unknown as typeof Symbol.dispose);
  const handle: GuardHandle = {
    result,
    [Symbol.dispose]: () => {
      // Currently a no-op (parity with conversation.close()). Reserved
      // for a future end_check signal once the wire supports it.
    },
  };
  if (runtimeDisposeSymbol !== Symbol.dispose) {
    Object.defineProperty(handle, runtimeDisposeSymbol, {
      value: handle[Symbol.dispose],
      enumerable: false,
    });
  }
  return handle;
}

// ---------- helpers ----------

function isKnownEventKind(kind: unknown): kind is EventKind {
  return typeof kind === "string" && (EVENT_KINDS as ReadonlyArray<string>).includes(kind);
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function safeJsonParse(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Seconds from a `Retry-After` header, or null.
 *
 * Only the delta-seconds form is understood. RFC 9110 also permits an
 * HTTP-date, and a caller handed a wrong number is worse off than one handed
 * null, so anything non-numeric returns null rather than guessing. The spec
 * carries a vector for the header-absent case, which lands here too.
 */
function parseRetryAfter(raw: string | null): number | null {
  if (raw === null) return null;
  const seconds = Number(raw.trim());
  if (!Number.isInteger(seconds) || seconds < 0) return null;
  return seconds;
}

function formatBody(body: unknown): string {
  if (body == null) return "null";
  if (typeof body === "string") return body;
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}
