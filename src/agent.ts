/**
 * Worker-friendly agent-stream surface.
 *
 * This subpath intentionally excludes webhook verification and Concordia MCP
 * exports so edge runtimes can import the chat/circuit-breaker client without
 * pulling Node-only crypto modules into the bundle.
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

export const SPEC_VERSION = "0.7.0";
