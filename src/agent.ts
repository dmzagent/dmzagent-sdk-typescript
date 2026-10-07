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
  STEP_PHASES,
  DIRECTIVES,
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
  type AgentStepOptions,
  type AgentSessionOptions,
  type ListBehaviorsOptions,
  type StepPhase,
  type Directive,
  type EventKind,
  type EventSubjectType,
  type FetchLike,
  type GuardHandle,
} from "./client.js";

export { Conversation } from "./conversation.js";

// Agent mode is the agent-stream surface too (spec §1.9), so it ships on
// this subpath as well as the main entry point.
export {
  AgentSession,
  type IntentStepOptions,
  type CallStepOptions,
  type ResultStepOptions,
  type RefusedStepOptions,
} from "./agentSession.js";

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
  type PolicyAction,
  type TriageDecision,
  type StepResult,
  type Behavior,
  type BehaviorPage,
  stepResultFromResponse,
  behaviorFromResponse,
  behaviorPageFromResponse,
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
  ServerError,
  CBOpenError,
  type DMZAgentErrorInit,
  type CBOpenErrorInit,
  type ErrorBody,
} from "./errors.js";

// Re-exported, never re-declared. This subpath is published as
// `@dmzagent/sdk/agent`, so a literal here is a second public
// SPEC_VERSION that can drift from the one the main entry point and
// the User-Agent use — which is exactly what happened: this read
// 0.6.0 while `version.ts` read 0.8.0.
export { SPEC_VERSION } from "./version.js";
