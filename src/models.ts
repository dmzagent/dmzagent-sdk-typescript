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
  /**
   * `true` for a live key, `false` for a test key (`ck_test_…`), and
   * `undefined` when the server omitted it (spec §1.2, §2.1).
   *
   * Left absent rather than defaulted: `false` is the positive claim
   * "this is test data", and asserting that about a response that never
   * carried the field is exactly the confusion this signal exists to
   * prevent.
   */
  readonly livemode?: boolean;

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
    ...(typeof data["livemode"] === "boolean"
      ? { livemode: data["livemode"] as boolean }
      : {}),
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
  /** See `EmitResult.livemode` (spec §1.2, §2.1). */
  readonly livemode?: boolean;
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
    ...(typeof data["livemode"] === "boolean"
      ? { livemode: data["livemode"] as boolean }
      : {}),
    raw: Object.freeze({ ...data }),
  };
  return Object.freeze(result);
}

// ---------- OutcomeResult ----------

/**
 * Per-workspace reasoning outcome (sdk-spec.md §7.3).
 *
 * Distinct from `Outcome` above, which is the ingestion outcome on
 * `EmitResult` — same word, different enum, so they are named apart.
 */
export type ReasoningOutcome =
  | "skipped"
  | "no_change"
  | "applied"
  | "failed"
  | "held";

/**
 * Returned by `DMZAgent.awaitOutcome()` (sdk-spec.md §7.3).
 *
 * Per-workspace reasoning results for a captured frame. A frame is
 * division-scoped: it fans out to every workspace in its division and
 * produces one trace per workspace, each entry in `reasoning` naming the
 * `workspace_id` that produced it.
 */
export interface OutcomeResult {
  readonly frameId: string;
  /**
   * Fold over `reasoning` computed server-side, with precedence
   * failed > held > applied > no_change > skipped (§2.7). Null until at
   * least one trace exists — never guessed. This defaulted to
   * `"no_change"` when the key was absent, reporting a clean result for a
   * frame nothing had reasoned over yet.
   */
  readonly outcome: ReasoningOutcome | null;
  readonly divisionId?: string | null;
  readonly workspaceIds?: ReadonlyArray<string>;
  /** Every workspace the frame fanned out to has reported. */
  readonly complete: boolean;
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

  const summary = (data["summary"] ?? {}) as Record<string, unknown>;

  const result: OutcomeResult = {
    frameId:
      typeof data["frame_id"] === "string" ? (data["frame_id"] as string) : "",
    outcome:
      typeof data["outcome"] === "string" ? (data["outcome"] as ReasoningOutcome) : null,
    complete: summary["complete"] === true,
    ...(typeof data["division_id"] === "string"
      ? { divisionId: data["division_id"] as string }
      : {}),
    ...(Array.isArray(data["workspace_ids"])
      ? { workspaceIds: data["workspace_ids"] as ReadonlyArray<string> }
      : {}),
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
  /**
   * How the caller got this result (spec §4.4). No counterpart on the
   * wire: with the state cache off — the default — these are always
   * `false`, `0`, `false`.
   */
  readonly cached: boolean;
  readonly cacheAgeMs: number;
  readonly stale: boolean;
  /**
   * The approval this denial is waiting on, or `null` (spec §2.2).
   *
   * Non-null only alongside `allow === false`. It is a field rather than a
   * fourth breaker state so that code reading `allow` alone still refuses:
   * a client that has never heard of approvals must not start allowing
   * what it used to deny.
   */
  readonly pendingApprovalId: string | null;
  /**
   * `true` when this is an ask rather than a refusal — a human can still
   * clear it. The distinction `pendingApprovalId` exists to express:
   * branch on it to show your approval UI instead of telling the user no.
   */
  readonly awaitingApproval: boolean;
  /** Full server JSON response (verbatim). */
  readonly raw: Readonly<Record<string, unknown>>;
}

/**
 * This result, marked as served from the cache at `ageMs` old.
 *
 * `latencyMs`, `routeLatencyMs`, `checkedAt` and `raw` are left alone:
 * they describe the check that actually happened, and rewriting them to
 * describe the cache hit would erase the only record of when the server
 * was last asked.
 */
export function checkResultAsCached(
  result: CheckResult,
  ageMs: number,
  stale = false,
): CheckResult {
  return Object.freeze({
    ...result,
    cached: true,
    cacheAgeMs: Math.max(0, ageMs),
    stale,
  });
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

  const pendingApprovalId =
    typeof data["pending_approval_id"] === "string"
      ? (data["pending_approval_id"] as string)
      : null;

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
    cached: false,
    cacheAgeMs: 0,
    stale: false,
    pendingApprovalId: pendingApprovalId,
    awaitingApproval: pendingApprovalId !== null,
    raw: Object.freeze({ ...data }),
  };
  return Object.freeze(result);
}

// ---------------------------------------------------------------------------
// Human-in-the-loop approvals and the incident ledger (spec §2.8–§2.10, 0.10.0)
// ---------------------------------------------------------------------------

/** The held call, verbatim — the caller named its own tools (spec §2.8). */
export interface HeldAction {
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
}

/**
 * The human half of an `Approval` — who decided, and why.
 *
 * `actorId` is the *caller's* identifier for a person, not ours. We resolve
 * it against no directory and store it as given, which is what lets a
 * customer's own users decide without ever holding an account here.
 */
export interface ApprovalDecision {
  readonly decision: "approve" | "decline" | string;
  readonly actorId: string;
  readonly actorLabel: string | null;
  readonly reason: string | null;
  readonly decidedAt: string;
}

/**
 * An action held pending a human decision (spec §7.12).
 *
 * Every field here is something *you* render. There is no message written
 * for your end user, no copy of ours, and no display string: `reason` and
 * each `firedPolicies[].name` are the words your operator typed when they
 * wrote the policy, and `action` is the call your agent was about to make.
 * Building display text out of them is your job precisely because a
 * sentence we wrote would read the same in every customer's product.
 *
 * `expiresAt` stays the server's ISO-8601 string rather than a parsed
 * countdown. Seconds-remaining computed at parse time is wrong by however
 * long you held the object, and the caller rendering an approval deadline
 * is exactly the caller who holds it.
 */
export interface Approval {
  readonly approvalId: string;
  readonly status: "pending" | "approved" | "declined" | "expired" | string;
  readonly subjectId: string;
  readonly interactionId: string | null;
  readonly frameId: string | null;
  readonly action: HeldAction;
  readonly reason: string;
  readonly firedPolicies: ReadonlyArray<FiredPolicy>;
  readonly requestedAt: string;
  readonly expiresAt: string;
  /** Always `"decline"`. An approval that becomes an allow because nobody
   *  looked at it is a delay with extra steps, not a control (spec §2.9). */
  readonly onExpiry: "decline";
  readonly anchor: AnchorRef | null;
  readonly decision: ApprovalDecision | null;
  readonly raw: Readonly<Record<string, unknown>>;
}

/** One page of `listApprovals()` (spec §7.11). Nothing here follows
 *  `nextCursor` for you — see `iterApprovals()`. */
export interface ApprovalPage {
  readonly approvals: ReadonlyArray<Approval>;
  readonly nextCursor: string | null;
  readonly raw: Readonly<Record<string, unknown>>;
}

/** One thing that was done about an incident (spec §7.14). */
export interface Remediation {
  readonly remediationId: string;
  readonly kind: "approval" | "policy_change" | "manual" | "auto" | string;
  readonly outcome: string;
  readonly approvalId: string | null;
  readonly actorId: string | null;
  readonly reason: string | null;
  readonly occurredAt: string;
  readonly anchor: AnchorRef | null;
}

/**
 * One entry of the append-only incident ledger (spec §7.14).
 *
 * `anchor` is the ledger entry that opened this incident, in the same
 * `{ledger_index, hash}` shape `CheckResult.anchor` carries. A caller who
 * recorded an anchor at check time can find that entry here and compare
 * hashes; a mismatch is the one alarm the ledger exists to make possible.
 *
 * An incident with no remediations and status `open` is the normal shape of
 * something nobody has answered yet — not an error, and not something to
 * collapse to null.
 */
export interface Incident {
  readonly incidentId: string;
  readonly status: "open" | "remediated" | "accepted" | string;
  readonly kind:
    | "cb_open" | "cb_half_open" | "policy_fired" | "approval_required" | string;
  readonly subjectId: string;
  readonly frameId: string | null;
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly reason: string;
  readonly firedPolicies: ReadonlyArray<FiredPolicy>;
  readonly remediations: ReadonlyArray<Remediation>;
  readonly anchor: AnchorRef | null;
  readonly raw: Readonly<Record<string, unknown>>;
}

/**
 * One page of `getIncidents()` (spec §7.13).
 *
 * Newest `ledger_index` first, as the server ordered it. The SDK does not
 * re-sort: ordering by a timestamp cannot separate two entries written in
 * the same second, and the ledger's own order is the one that means
 * something.
 */
export interface IncidentPage {
  readonly incidents: ReadonlyArray<Incident>;
  readonly nextCursor: string | null;
  readonly raw: Readonly<Record<string, unknown>>;
}

function str(data: Record<string, unknown>, key: string, dflt = ""): string {
  return typeof data[key] === "string" ? (data[key] as string) : dflt;
}

function nullableStr(data: Record<string, unknown>, key: string): string | null {
  return typeof data[key] === "string" ? (data[key] as string) : null;
}

function firedPoliciesFrom(data: Record<string, unknown>): ReadonlyArray<FiredPolicy> {
  const raw = data["fired_policies"];
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[])
    .filter(
      (p) =>
        p != null && typeof p === "object" &&
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
    );
}

function anchorFrom(value: unknown): AnchorRef | null {
  if (
    value && typeof value === "object" &&
    typeof (value as Record<string, unknown>)["ledger_index"] === "number" &&
    typeof (value as Record<string, unknown>)["hash"] === "string"
  ) {
    const a = value as Record<string, unknown>;
    return Object.freeze({
      ledger_index: a["ledger_index"] as number,
      hash: a["hash"] as string,
    });
  }
  return null;
}

export function approvalFromResponse(data: Record<string, unknown>): Approval {
  const actionRaw = data["action"];
  const action: HeldAction = Object.freeze({
    tool: actionRaw && typeof actionRaw === "object"
      ? str(actionRaw as Record<string, unknown>, "tool")
      : "",
    args: Object.freeze(
      actionRaw && typeof actionRaw === "object" &&
      (actionRaw as Record<string, unknown>)["args"] &&
      typeof (actionRaw as Record<string, unknown>)["args"] === "object"
        ? { ...((actionRaw as Record<string, unknown>)["args"] as Record<string, unknown>) }
        : {},
    ),
  });

  const decisionRaw = data["decision"];
  const decision: ApprovalDecision | null =
    decisionRaw && typeof decisionRaw === "object"
      ? Object.freeze({
          decision: str(decisionRaw as Record<string, unknown>, "decision"),
          actorId: str(decisionRaw as Record<string, unknown>, "actor_id"),
          actorLabel: nullableStr(decisionRaw as Record<string, unknown>, "actor_label"),
          reason: nullableStr(decisionRaw as Record<string, unknown>, "reason"),
          decidedAt: str(decisionRaw as Record<string, unknown>, "decided_at"),
        })
      : null;

  return Object.freeze({
    approvalId: str(data, "approval_id"),
    status: str(data, "status"),
    subjectId: str(data, "subject_id"),
    interactionId: nullableStr(data, "interaction_id"),
    frameId: nullableStr(data, "frame_id"),
    action,
    reason: str(data, "reason"),
    firedPolicies: firedPoliciesFrom(data),
    requestedAt: str(data, "requested_at"),
    expiresAt: str(data, "expires_at"),
    // Not read from the server: expiry declines, and a server that ever
    // sent "approve" would be describing a control this SDK does not
    // implement (spec §2.9).
    onExpiry: "decline",
    anchor: anchorFrom(data["anchor"]),
    decision,
    raw: Object.freeze({ ...data }),
  });
}

export function approvalPageFromResponse(
  data: Record<string, unknown>,
): ApprovalPage {
  const raw = data["approvals"];
  return Object.freeze({
    approvals: Object.freeze(
      Array.isArray(raw)
        ? (raw as Record<string, unknown>[]).map(approvalFromResponse)
        : [],
    ),
    nextCursor: nullableStr(data, "next_cursor"),
    raw: Object.freeze({ ...data }),
  });
}

function remediationFromResponse(data: Record<string, unknown>): Remediation {
  return Object.freeze({
    remediationId: str(data, "remediation_id"),
    kind: str(data, "kind"),
    outcome: str(data, "outcome"),
    approvalId: nullableStr(data, "approval_id"),
    actorId: nullableStr(data, "actor_id"),
    reason: nullableStr(data, "reason"),
    occurredAt: str(data, "occurred_at"),
    anchor: anchorFrom(data["anchor"]),
  });
}

export function incidentFromResponse(data: Record<string, unknown>): Incident {
  const remRaw = data["remediations"];
  return Object.freeze({
    incidentId: str(data, "incident_id"),
    status: str(data, "status"),
    kind: str(data, "kind"),
    subjectId: str(data, "subject_id"),
    frameId: nullableStr(data, "frame_id"),
    openedAt: str(data, "opened_at"),
    closedAt: nullableStr(data, "closed_at"),
    reason: str(data, "reason"),
    firedPolicies: firedPoliciesFrom(data),
    remediations: Object.freeze(
      Array.isArray(remRaw)
        ? (remRaw as Record<string, unknown>[]).map(remediationFromResponse)
        : [],
    ),
    anchor: anchorFrom(data["anchor"]),
    raw: Object.freeze({ ...data }),
  });
}

export function incidentPageFromResponse(
  data: Record<string, unknown>,
): IncidentPage {
  const raw = data["incidents"];
  return Object.freeze({
    incidents: Object.freeze(
      Array.isArray(raw)
        ? (raw as Record<string, unknown>[]).map(incidentFromResponse)
        : [],
    ),
    nextCursor: nullableStr(data, "next_cursor"),
    raw: Object.freeze({ ...data }),
  });
}
