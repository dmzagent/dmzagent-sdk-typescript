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

// ---------- Logic Canons (rulebook-as-code, spec Phase 14.7) ----------

/** A private, vendor-scoped Logic Canon (rulebook artifact). */
export interface LogicCanon {
  readonly logicCanonId: string;
  readonly vendorId?: string;
  readonly slug?: string;
  readonly name?: string;
  readonly description?: string;
  /** draft | published | unpublished */
  readonly status?: string;
  readonly latestVersion?: number;
  readonly versions?: ReadonlyArray<LogicCanonVersion>;
  /** Full server JSON response (verbatim). */
  readonly raw: Readonly<Record<string, unknown>>;
}

export function logicCanonFromResponse(
  data: Record<string, unknown>,
): LogicCanon {
  const versions = Array.isArray(data["versions"])
    ? (data["versions"] as Array<Record<string, unknown>>).map(logicCanonVersionFromResponse)
    : undefined;
  return Object.freeze({
    logicCanonId: (data["logic_canon_id"] as string) ?? "",
    vendorId: data["vendor_id"] as string | undefined,
    slug: data["slug"] as string | undefined,
    name: data["name"] as string | undefined,
    description: data["description"] as string | undefined,
    status: data["status"] as string | undefined,
    latestVersion: data["latest_version"] as number | undefined,
    versions,
    raw: Object.freeze({ ...data }),
  });
}

/** One immutable, integer-versioned rulebook publication. */
export interface LogicCanonVersion {
  readonly logicCanonId?: string;
  readonly version: number;
  readonly nRules?: number;
  readonly changelog?: string;
  readonly publishedAt?: string;
  /** The rulebook document — present on getLogicCanonVersion. */
  readonly rulebook?: Record<string, unknown>;
  readonly raw: Readonly<Record<string, unknown>>;
}

export function logicCanonVersionFromResponse(
  data: Record<string, unknown>,
): LogicCanonVersion {
  return Object.freeze({
    logicCanonId: data["logic_canon_id"] as string | undefined,
    version: (data["version"] as number) ?? 0,
    nRules: data["n_rules"] as number | undefined,
    changelog: data["changelog"] as string | undefined,
    publishedAt: data["published_at"] as string | undefined,
    rulebook: data["rulebook"] as Record<string, unknown> | undefined,
    raw: Object.freeze({ ...data }),
  });
}

/**
 * A Logic Canon pinned into a workspace at one immutable version —
 * the deploy record returned by `installLogicCanon` and
 * `listWorkspaceLogicCanons`.
 *
 * `status` (when present) is the LIFECYCLE status of the canon
 * (`draft` | `published` | `unpublished`) as an open string — the
 * server may add values; never narrow this to a literal union
 * (review §3.2). Health status lives on `LogicInstallHealthRow`.
 */
export interface LogicCanonInstall {
  readonly logicCanonId: string;
  readonly version?: number;
  readonly workspaceId?: string;
  readonly slug?: string;
  readonly name?: string;
  readonly installedBy?: string;
  readonly installedAt?: string;
  /** Lifecycle status: draft | published | unpublished (open set). */
  readonly status?: string;
  readonly raw: Readonly<Record<string, unknown>>;
}

export function logicCanonInstallFromResponse(
  data: Record<string, unknown>,
): LogicCanonInstall {
  return Object.freeze({
    logicCanonId: (data["logic_canon_id"] as string) ?? "",
    version: data["version"] as number | undefined,
    workspaceId: data["workspace_id"] as string | undefined,
    slug: data["slug"] as string | undefined,
    name: data["name"] as string | undefined,
    installedBy: data["installed_by"] as string | undefined,
    installedAt: data["installed_at"] as string | undefined,
    status: data["status"] as string | undefined,
    raw: Object.freeze({ ...data }),
  });
}

/**
 * One row of the workspace install-health surface — evaluation status
 * for a single installed control.
 *
 * `status` is `ok` | `missing_bytes` | `compile_error` as an OPEN
 * string (the server may add values; review §3.2). Distinct from the
 * lifecycle `status` on `LogicCanonInstall`.
 */
export interface LogicInstallHealthRow {
  readonly logicCanonId: string;
  readonly version?: number;
  readonly slug?: string;
  readonly name?: string;
  /** Health status: ok | missing_bytes | compile_error (open set). */
  readonly status?: string;
  readonly detail?: string;
  readonly raw: Readonly<Record<string, unknown>>;
}

export function logicInstallHealthRowFromResponse(
  data: Record<string, unknown>,
): LogicInstallHealthRow {
  return Object.freeze({
    logicCanonId: (data["logic_canon_id"] as string) ?? "",
    version: data["version"] as number | undefined,
    slug: data["slug"] as string | undefined,
    name: data["name"] as string | undefined,
    status: data["status"] as string | undefined,
    detail: (data["detail"] as string | null | undefined) ?? undefined,
    raw: Object.freeze({ ...data }),
  });
}

/**
 * Install health for one workspace — the fail-open alert surface.
 * `ok === false` means at least one installed control is NOT evaluating
 * (published bytes missing or no longer compiling).
 */
export interface LogicInstallHealth {
  readonly workspaceId: string;
  readonly ok: boolean;
  readonly broken: number;
  readonly installs: ReadonlyArray<LogicInstallHealthRow>;
  readonly raw: Readonly<Record<string, unknown>>;
}

export function logicInstallHealthFromResponse(
  data: Record<string, unknown>,
): LogicInstallHealth {
  const installs = Array.isArray(data["installs"])
    ? (data["installs"] as Array<Record<string, unknown>>).map(logicInstallHealthRowFromResponse)
    : [];
  return Object.freeze({
    workspaceId: (data["workspace_id"] as string) ?? "",
    ok: Boolean(data["ok"]),
    broken: (data["broken"] as number) ?? 0,
    installs,
    raw: Object.freeze({ ...data }),
  });
}

/** Compile-only rulebook validation (CI / pre-publish lint). */
export interface RulebookValidation {
  readonly valid: boolean;
  readonly error?: string;
  readonly nRules?: number;
  readonly nStateless?: number;
  readonly nStateful?: number;
  readonly raw: Readonly<Record<string, unknown>>;
}

export function rulebookValidationFromResponse(
  data: Record<string, unknown>,
): RulebookValidation {
  return Object.freeze({
    valid: Boolean(data["valid"]),
    error: data["error"] as string | undefined,
    nRules: data["n_rules"] as number | undefined,
    nStateless: data["n_stateless"] as number | undefined,
    nStateful: data["n_stateful"] as number | undefined,
    raw: Object.freeze({ ...data }),
  });
}

/**
 * One rule that fired at the logic door (wire key `rule_id`).
 * The full wire item is preserved on `raw` (review §3.5).
 */
export interface FiredRule {
  readonly ruleId: string;
  /** Full wire item (verbatim). */
  readonly raw: Readonly<Record<string, unknown>>;
}

export function firedRuleFromResponse(
  data: Record<string, unknown>,
): FiredRule {
  return Object.freeze({
    ruleId: (data["rule_id"] as string) ?? "",
    raw: Object.freeze({ ...data }),
  });
}

/**
 * One escalation emitted at the logic door. `band` / `lane` are OPEN
 * strings (review §3.2). The full wire item is preserved on `raw`.
 */
export interface Escalation {
  readonly ruleId: string;
  readonly band?: string;
  readonly lane?: string;
  /** Full wire item (verbatim). */
  readonly raw: Readonly<Record<string, unknown>>;
}

export function escalationFromResponse(
  data: Record<string, unknown>,
): Escalation {
  return Object.freeze({
    ruleId: (data["rule_id"] as string) ?? "",
    band: data["band"] as string | undefined,
    lane: data["lane"] as string | undefined,
    raw: Object.freeze({ ...data }),
  });
}

/**
 * Ack from the live logic door — one evaluated event (202 accepted).
 *
 * `degraded === true` means at least one installed control was NOT
 * evaluated (fail-open gap) — compare `installsEvaluated` against
 * `installsTotal`. `responded === false` means the best-effort respond
 * step failed, so `dispositions` / `emittedFrames` /
 * `expectedLossAvoided` may under-report.
 */
export interface LogicEventAck {
  readonly accepted: boolean;
  readonly workspaceId: string;
  readonly subjectId: string;
  readonly nLogicPass: number;
  readonly nDeferred: number;
  readonly fired: ReadonlyArray<FiredRule>;
  readonly escalations: ReadonlyArray<Escalation>;
  readonly dispositions: number;
  readonly emittedFrames: number;
  readonly expectedLossAvoided: number;
  /** True when at least one installed control was skipped (fail-open). */
  readonly degraded: boolean;
  /** True when the best-effort respond step completed. */
  readonly responded: boolean;
  readonly installsEvaluated: number;
  readonly installsTotal: number;
  readonly raw: Readonly<Record<string, unknown>>;
}

export function logicEventAckFromResponse(
  data: Record<string, unknown>,
): LogicEventAck {
  const fired = Array.isArray(data["fired"])
    ? (data["fired"] as Array<Record<string, unknown>>).map(firedRuleFromResponse)
    : [];
  const escalations = Array.isArray(data["escalations"])
    ? (data["escalations"] as Array<Record<string, unknown>>).map(escalationFromResponse)
    : [];
  return Object.freeze({
    accepted: Boolean(data["accepted"]),
    workspaceId: (data["workspace_id"] as string) ?? "",
    subjectId: (data["subject_id"] as string) ?? "",
    nLogicPass: (data["n_logic_pass"] as number) ?? 0,
    nDeferred: (data["n_deferred"] as number) ?? 0,
    fired,
    escalations,
    dispositions: (data["dispositions"] as number) ?? 0,
    emittedFrames: (data["emitted_frames"] as number) ?? 0,
    expectedLossAvoided: (data["expected_loss_avoided"] as number) ?? 0,
    degraded: typeof data["degraded"] === "boolean" ? (data["degraded"] as boolean) : false,
    responded: typeof data["responded"] === "boolean" ? (data["responded"] as boolean) : false,
    installsEvaluated:
      typeof data["installs_evaluated"] === "number" ? (data["installs_evaluated"] as number) : 0,
    installsTotal:
      typeof data["installs_total"] === "number" ? (data["installs_total"] as number) : 0,
    raw: Object.freeze({ ...data }),
  });
}
