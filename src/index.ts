/**
 * DMZAgent — TypeScript SDK.
 *
 * DMZAgent is the codex of trust between minds: a reference work that
 * indexes how agents reveal themselves (Anima), how they move under
 * conditions (Augur), and how trust between them is sustained
 * (Concordia). This SDK is the customer-facing surface for streaming
 * agent events and gating actions through circuit breakers.
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
 * See README.md for the full conceptual model and additional examples.
 */

export {
  DMZAgent,
  EVENT_KINDS,
  EVENT_SUBJECT_TYPES,
  type DMZAgentOptions,
  type ConversationOptions,
  type CaptureOptions,
  type AwaitOutcomeOptions,
  type EmitEventOptions,
  type SubjectSaysOptions,
  type ToolCallOptions,
  type ToolResultOptions,
  type ObservationOptions,
  type CheckOptions,
  type EventKind,
  type EventSubjectType,
  type FetchLike,
  type GuardHandle,
} from "./client.js";

export { Conversation } from "./conversation.js";

export {
  slugifySubject,
  subjectIdForDivision,
  subjectForDivision,
  isCanonicalSubjectId,
  subjectTypeFromSubjectId,
  type SubjectIdOptions,
  type SubjectForDivisionOptions,
} from "./subjects.js";

export {
  type EmitResult,
  type CaptureResult,
  type OutcomeResult,
  type CheckResult,
  type NotificationPrefs,
  type DivisionConfig,
  type ReviewEvent,
  type Subject,
  type FiredPolicy,
  type AnchorRef,
  type Outcome,
  type CBState,
  type TriageDecision,
  captureResultFromResponse,
  outcomeResultFromResponse,
  notificationPrefsFromResponse,
  divisionConfigFromResponse,
} from "./models.js";

export {
  DMZAgentError,
  AuthError,
  PermissionError,
  ValidationError,
  RateLimitError,
  ServerError,
  CBOpenError,
  type DMZAgentErrorInit,
  type RateLimitErrorInit,
  type CBOpenErrorInit,
  type ErrorBody,
} from "./errors.js";

export { verifyWebhookSignature } from "./webhook.js";

/**
 * Concordia MCP client — the governance side of DMZAgent. Same shape
 * as the Python `dmzagent.concordia` submodule. Prefer the subpath
 * import for tree-shaking:
 *
 *   import { ConcordiaClient } from "@dmzagent/sdk/concordia";
 *
 * The namespace re-export below is provided for symmetry; bundlers
 * that don't support package subpaths can still reach the client via
 * `concordia.ConcordiaClient`.
 */
export * as concordia from "./concordia.js";

/** Pinned spec version the agent-stream surface implements (spec §11.1). */
export const SPEC_VERSION = "0.6.0";
