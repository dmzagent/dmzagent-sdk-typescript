/**
 * Wire-shaped result types returned by the SDK's public methods.
 *
 * All fields are `readonly` — result objects are immutable. The full
 * server JSON is always retained on `.raw` for forward-compat (any
 * field the spec adds in a PATCH/MINOR bump is available there before
 * we surface it as a typed property).
 *
 * Naming follows spec §8.4: camelCase TypeScript fields back the
 * canonical snake_case wire keys.
 */

// ---------- shared shapes ----------

export type Outcome =
  | "scored"
  | "tagged"
  | "no_tags_fired"
  | "rejected"
  | "error";

export type CBState = "closed" | "half_open" | "hold" | "open";

export type TriageDecision = "deep" | "shallow";

export interface FiredPolicy {
  readonly cb_policy_id: string;
  readonly name: string;
  readonly action: string;
}

export interface AnchorRef {
  readonly ledger_index: number;
  readonly hash: string;
}

/**
 * Subject / participant shape — same on the wire as on the SDK surface.
 *
 * `role` is free-form (`agent`, `customer`, `observer`, …).
 * `kind` describes the substrate (`agent`, `human`, `sensor`, …).
 * Both default to `"other"` when the SDK normalizes them.
 */
export interface Subject {
  readonly subject_id: string;
  readonly role?: string;
  readonly kind?: string;
  /** Trace-pattern classifier: `chat` | `sensor` | `lead` | `ticket` | `journey`. */
  readonly subject_type?: string;
  readonly metadata?: Record<string, unknown>;
}

// ---------- EmitResult ----------

/**
 * Returned by every event-emit method (`subjectSays`, `toolCall`, …).
 *
 * In accepted-only mode the server returns `interactionId`, `subjects`,
 * `frameId`, `accepted`, `nWorkspaces`, and `followMyData`; consumers
 * fetch per-workspace reasoning outcomes out-of-band.
 *
 * Legacy sync fields (`subjectId`, `outcome`, `triageDecision`,
 * `tagsFired`, `scoredByCanons`, `soulVersion`, `ledgerIndex`) are
 * deprecated and no longer populated — use `capture()` + `awaitOutcome()`
 * instead.
 *
 * Consumers MUST treat `undefined` as "unknown", not as "empty".
 */
export interface EmitResult {
  readonly interactionId: string;
  readonly subjects: ReadonlyArray<string>;
  readonly queued: boolean;
  readonly accepted?: boolean;
  readonly nWorkspaces?: number;
  readonly frameId?: string;
  readonly followMyData?: string | null;

  // Deprecated — no longer populated but kept for type compat.
  /** @deprecated */
  readonly subjectId?: string;
  /** @deprecated */
  readonly outcome?: Outcome | string;
  /** @deprecated */
  readonly triageDecision?: TriageDecision | string;
  /** @deprecated */
  readonly tagsFired?: ReadonlyArray<string>;
  /** @deprecated */
  readonly scoredByCanons?: ReadonlyArray<string>;
  /** @deprecated */
  readonly soulVersion?: number;
  /** @deprecated */
  readonly ledgerIndex?: number;
  readonly error?: unknown;

  /** Full server JSON response (verbatim). */
  readonly raw: Readonly<Record<string, unknown>>;
}

export function emitResultFromResponse(
  data: Record<string, unknown>,
): EmitResult {
  const interactionId =
    typeof data["interaction_id"] === "string"
      ? (data["interaction_id"] as string)
      : "";
  const subjectsField = data["subjects"];
  const subjects: ReadonlyArray<string> = Array.isArray(subjectsField)
    ? (subjectsField.filter((s) => typeof s === "string") as string[])
    : [];
  const accepted =
    typeof data["accepted"] === "boolean" ? (data["accepted"] as boolean) : undefined;
  // Default queued=true matches the Python SDK's behavior when the
  // server omits the field. Accepted-only responses omit `queued`, so
  // use `accepted` when present to avoid treating rejected ingest as
  // successfully queued.
  const queued =
    typeof data["queued"] === "boolean" ? (data["queued"] as boolean) : accepted ?? true;

  const result: EmitResult = {
    interactionId,
    subjects,
    queued,
    ...(typeof accepted === "boolean" ? { accepted } : {}),
    ...(typeof data["n_workspaces"] === "number"
      ? { nWorkspaces: data["n_workspaces"] as number }
      : {}),
    ...(typeof data["frame_id"] === "string"
      ? { frameId: data["frame_id"] as string }
      : {}),
    ...(typeof data["subject_id"] === "string"
      ? { subjectId: data["subject_id"] as string }
      : {}),
    ...(typeof data["outcome"] === "string"
      ? { outcome: data["outcome"] as string }
      : {}),
    ...(typeof data["triage_decision"] === "string"
      ? { triageDecision: data["triage_decision"] as string }
      : {}),
    ...(Array.isArray(data["tags_fired"])
      ? {
          tagsFired: (data["tags_fired"] as unknown[]).filter(
            (t) => typeof t === "string",
          ) as string[],
        }
      : {}),
    ...(Array.isArray(data["scored_by_canons"])
      ? {
          scoredByCanons: (data["scored_by_canons"] as unknown[]).filter(
            (c) => typeof c === "string",
          ) as string[],
        }
      : {}),
    ...(typeof data["soul_version"] === "number"
      ? { soulVersion: data["soul_version"] as number }
      : {}),
    ...(typeof data["ledger_index"] === "number"
      ? { ledgerIndex: data["ledger_index"] as number }
      : {}),
    ...(
      typeof data["follow_my_data"] === "string" || data["follow_my_data"] === null
        ? { followMyData: data["follow_my_data"] as string | null }
        : {}
    ),
    ...(data["error"] !== undefined
      ? { error: data["error"] }
      : {}),
    raw: Object.freeze({ ...data }),
  };
  return Object.freeze(result);
}

// ---------- CaptureResult ----------

/**
 * Returned by `DMZAgent.capture()`.
 *
 * Lightweight accepted-only ack. Per-workspace reasoning outcomes
 * are retrieved via `awaitOutcome()`, webhooks, or the SDK stream.
 */
export interface CaptureResult {
  readonly frameId: string;
  readonly accepted: boolean;
  readonly nWorkspaces: number;
  readonly interactionId: string;
  readonly subjects: ReadonlyArray<string>;
  readonly followMyData?: string | null;
  /** Full server JSON response (verbatim). */
  readonly raw: Readonly<Record<string, unknown>>;
}

export function captureResultFromResponse(
  data: Record<string, unknown>,
): CaptureResult {
  const result: CaptureResult = {
    frameId:
      typeof data["frame_id"] === "string" ? (data["frame_id"] as string) : "",
    accepted:
      typeof data["accepted"] === "boolean" ? (data["accepted"] as boolean) : false,
    nWorkspaces:
      typeof data["n_workspaces"] === "number" ? (data["n_workspaces"] as number) : 0,
    interactionId:
      typeof data["interaction_id"] === "string"
        ? (data["interaction_id"] as string)
        : "",
    subjects: Array.isArray(data["subjects"])
      ? (data["subjects"] as string[])
      : [],
    ...(typeof data["follow_my_data"] === "string" || data["follow_my_data"] === null
      ? { followMyData: data["follow_my_data"] as string | null }
      : {}),
    raw: Object.freeze({ ...data }),
  };
  return Object.freeze(result);
}

// ---------- OutcomeResult ----------

/**
 * Returned by `DMZAgent.awaitOutcome()`.
 *
 * Per-workspace reasoning results for a captured frame.
 */
export interface OutcomeResult {
  readonly frameId: string;
  readonly outcome: string; // "skipped" | "no_change" | "applied" | "failed"
  readonly error?: { readonly code: string; readonly message: string } | null;
  readonly tagsFired?: ReadonlyArray<Record<string, unknown>>;
  readonly reasoning?: ReadonlyArray<Record<string, unknown>>;
  readonly soulVersion?: number;
  readonly finishedAt?: string;
}

export function outcomeResultFromResponse(
  data: Record<string, unknown>,
): OutcomeResult {
  const errorRaw = data["error"];
  const error =
    errorRaw && typeof errorRaw === "object"
      ? {
          code:
            typeof (errorRaw as Record<string, unknown>)["code"] === "string"
              ? ((errorRaw as Record<string, unknown>)["code"] as string)
              : "",
          message:
            typeof (errorRaw as Record<string, unknown>)["message"] === "string"
              ? ((errorRaw as Record<string, unknown>)["message"] as string)
              : "",
        }
      : undefined;

  const result: OutcomeResult = {
    frameId:
      typeof data["frame_id"] === "string" ? (data["frame_id"] as string) : "",
    outcome:
      typeof data["outcome"] === "string" ? (data["outcome"] as string) : "no_change",
    ...(error ? { error } : {}),
    ...(Array.isArray(data["tags_fired"])
      ? { tagsFired: data["tags_fired"] as ReadonlyArray<Record<string, unknown>> }
      : {}),
    ...(Array.isArray(data["reasoning"])
      ? { reasoning: data["reasoning"] as ReadonlyArray<Record<string, unknown>> }
      : {}),
    ...(typeof data["soul_version"] === "number"
      ? { soulVersion: data["soul_version"] as number }
      : {}),
    ...(typeof data["finished_at"] === "string"
      ? { finishedAt: data["finished_at"] as string }
      : {}),
  };
  return Object.freeze(result);
}

// ---------- NotificationPrefs ----------

/**
 * Returned by `DMZAgent.getNotificationPrefs()` and
 * `updateNotificationPrefs()`.
 */
export interface NotificationPrefs {
  readonly emailCadence: string;
  readonly emailPausedUntil: string | null;
  readonly pushEnabled: boolean;
  readonly phone: string | null;
  readonly smsEnabled: boolean;
  readonly whatsappEnabled: boolean;
  readonly webhookUrl: string | null;
  readonly raw: Readonly<Record<string, unknown>>;
}

export function notificationPrefsFromResponse(data: Record<string, unknown>): NotificationPrefs {
  return Object.freeze({
    emailCadence: typeof data["email_cadence"] === "string" ? data["email_cadence"] as string : "off",
    emailPausedUntil: typeof data["email_paused_until"] === "string" ? data["email_paused_until"] as string : null,
    pushEnabled: typeof data["push_enabled"] === "boolean" ? data["push_enabled"] as boolean : false,
    phone: typeof data["phone"] === "string" ? data["phone"] as string : null,
    smsEnabled: typeof data["sms_enabled"] === "boolean" ? data["sms_enabled"] as boolean : false,
    whatsappEnabled: typeof data["whatsapp_enabled"] === "boolean" ? data["whatsapp_enabled"] as boolean : false,
    webhookUrl: typeof data["webhook_url"] === "string" ? data["webhook_url"] as string : null,
    raw: Object.freeze({ ...data }),
  });
}

// ---------- DivisionConfig ----------

/**
 * Returned by `DMZAgent.getDivisionConfig()` and
 * `updateDivisionConfig()`.
 */
export interface DivisionConfig {
  readonly config: Readonly<Record<string, unknown>>;
  readonly raw: Readonly<Record<string, unknown>>;
}

export function divisionConfigFromResponse(data: Record<string, unknown>): DivisionConfig {
  return Object.freeze({
    config: Object.freeze((data["config"] as Record<string, unknown>) ?? {}),
    raw: Object.freeze({ ...data }),
  });
}

// ---------- ReviewEvent ----------

export interface ReviewEvent {
  readonly eventId: string;
  readonly type: string;
  readonly reviewId: string;
  readonly subjectId: string;
  readonly tagId: string;
  readonly level: string;
  readonly status: string;
  readonly tier: string;
  readonly decision: string | null;
  readonly workspaceId: string;
  readonly divisionId: string | null;
  readonly frameId: string | null;
  readonly occurredAt: string;
  readonly raw: Readonly<Record<string, unknown>>;
}

// ---------- CheckResult ----------

/**
 * Returned by `DMZAgent.check()`.
 *
 * `allow` is the binary the caller normally branches on. `warning` is
 * set when state is `half_open` — the breaker is in review mode but
 * not yet blocking.
 */
export interface CheckResult {
  readonly state: CBState | string; // tolerate unknown enum values
  readonly allow: boolean;
  readonly warning: boolean;
  readonly reason: string;
  readonly firedPolicies: ReadonlyArray<FiredPolicy>;
  readonly anchor: AnchorRef | null;
  readonly checkedAt: string;
  readonly latencyMs: number;
  readonly routeLatencyMs: number;
  /** Full server JSON response (verbatim). */
  readonly raw: Readonly<Record<string, unknown>>;
}

export function checkResultFromResponse(
  data: Record<string, unknown>,
): CheckResult {
  const firedRaw = data["fired_policies"];
  const firedPolicies: ReadonlyArray<FiredPolicy> = Array.isArray(firedRaw)
    ? (firedRaw as Record<string, unknown>[])
        .filter(
          (p) =>
            p != null &&
            typeof p === "object" &&
            typeof p["cb_policy_id"] === "string" &&
            typeof p["name"] === "string" &&
            typeof p["action"] === "string",
        )
        .map((p) =>
          Object.freeze({
            cb_policy_id: p["cb_policy_id"] as string,
            name: p["name"] as string,
            action: p["action"] as string,
          }),
        )
    : [];

  let anchor: AnchorRef | null = null;
  const anchorRaw = data["anchor"];
  if (
    anchorRaw &&
    typeof anchorRaw === "object" &&
    typeof (anchorRaw as Record<string, unknown>)["ledger_index"] === "number" &&
    typeof (anchorRaw as Record<string, unknown>)["hash"] === "string"
  ) {
    const a = anchorRaw as Record<string, unknown>;
    anchor = Object.freeze({
      ledger_index: a["ledger_index"] as number,
      hash: a["hash"] as string,
    });
  }

  const state = typeof data["state"] === "string" ? (data["state"] as string) : "closed";
  // Default-allow when the server omits `allow`; mirrors the Python SDK.
  const allow = typeof data["allow"] === "boolean" ? (data["allow"] as boolean) : true;
  const warning =
    typeof data["warning"] === "boolean" ? (data["warning"] as boolean) : false;

  const result: CheckResult = {
    state,
    allow,
    warning,
    reason: typeof data["reason"] === "string" ? (data["reason"] as string) : "",
    firedPolicies,
    anchor,
    checkedAt:
      typeof data["checked_at"] === "string" ? (data["checked_at"] as string) : "",
    latencyMs:
      typeof data["latency_ms"] === "number" ? (data["latency_ms"] as number) : 0,
    routeLatencyMs:
      typeof data["route_latency_ms"] === "number"
        ? (data["route_latency_ms"] as number)
        : 0,
    raw: Object.freeze({ ...data }),
  };
  return Object.freeze(result);
}
