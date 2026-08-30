/**
 * Exception hierarchy for the DMZAgent TypeScript SDK.
 *
 * The hierarchy is deliberately shallow — most consumers only need to
 * catch `DMZAgentError` to bail out gracefully, or `CBOpenError`
 * specifically when they want to handle a blocked subject differently
 * from other failures.
 *
 *   DMZAgentError                base
 *     |- AuthError                API key invalid / expired / revoked
 *     |- PermissionError          key valid but lacks the needed scope
 *     |- ValidationError          server rejected the payload (400 or 422)
 *     |- RateLimitError           429; carries retryAfter when the server sent it
 *     |- ServerError              5xx from DMZAgent; safe to retry
 *     \- CBOpenError              cb.check() returned open — action blocked
 *
 * `CBOpenError` is intentionally an `Error` (not just a flag) so that
 * production code paths that wrap CB checks can use `try/catch` as a
 * natural control-flow seam, mirroring the Python / C# / Java SDKs.
 *
 * Every exception exposes:
 *   - `message`     human-readable string (inherited from Error)
 *   - `statusCode`  numeric HTTP status, or null when not from the wire
 *   - `body`        parsed response body (object / string / null)
 *
 * The original network or parse error is preserved via the standard
 * ES2022 `Error.cause` mechanism — `new DMZAgentError("...", { cause: e })`.
 */

import type { FiredPolicy, AnchorRef } from "./models.js";

/**
 * Spec §3 says every exception exposes `body: object | string | null`.
 * We widen the type slightly to `Record<string, unknown> | string | null`
 * so consumers can index without first narrowing — the runtime contract
 * matches the spec exactly.
 */
export type ErrorBody = Record<string, unknown> | string | null;

export interface DMZAgentErrorInit {
  statusCode?: number | null;
  body?: ErrorBody | unknown;
  cause?: unknown;
}

export class DMZAgentError extends Error {
  public readonly statusCode: number | null;
  public readonly body: ErrorBody;

  constructor(message: string, init: DMZAgentErrorInit = {}) {
    // ES2022 Error supports { cause } on the options bag.
    super(message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = "DMZAgentError";
    this.statusCode = init.statusCode ?? null;
    this.body = normalizeBody(init.body);
    // Preserve prototype chain for instanceof checks under transpilation.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function normalizeBody(value: unknown): ErrorBody {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object") return value as Record<string, unknown>;
  // Coerce primitives (number/boolean) to a string for the spec contract.
  return String(value);
}

export class AuthError extends DMZAgentError {
  constructor(message: string, init: DMZAgentErrorInit = {}) {
    super(message, init);
    this.name = "AuthError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class PermissionError extends DMZAgentError {
  constructor(message: string, init: DMZAgentErrorInit = {}) {
    super(message, init);
    this.name = "PermissionError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * The server rejected the payload.
 *
 * 400 means the request was malformed; 422 means it parsed but failed
 * evaluation. The spec's error taxonomy maps both here, because the caller's
 * remedy is the same — fix the request, do not retry it unchanged.
 * `statusCode` distinguishes them when that matters.
 */
export class ValidationError extends DMZAgentError {
  constructor(message: string, init: DMZAgentErrorInit = {}) {
    super(message, init);
    this.name = "ValidationError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface RateLimitErrorInit extends DMZAgentErrorInit {
  retryAfter?: number | null;
}

/**
 * The server returned 429 — the caller is being rate limited.
 *
 * `retryAfter` is seconds, taken from the `Retry-After` response header, or
 * `null` when the server did not send one. Callers should handle `null`
 * rather than assume a default: the spec carries a vector for each case
 * precisely because both occur.
 */
export class RateLimitError extends DMZAgentError {
  public readonly retryAfter: number | null;

  constructor(message: string, init: RateLimitErrorInit = {}) {
    super(message, init);
    this.name = "RateLimitError";
    this.retryAfter = init.retryAfter ?? null;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * 409 — a request carrying this `Idempotency-Key` is already in flight.
 *
 * Deliberately not a `ServerError`: this is not a transient fault. The
 * duplicate is the caller's *own* earlier request, still running. Retrying
 * the same key after a short pause replays that request's stored response
 * rather than producing a second side effect, so the caller can safely wait
 * and retry — but the SDK never does so on its own (spec §1.8).
 */
export class ConflictError extends DMZAgentError {
  constructor(message: string, init: DMZAgentErrorInit = {}) {
    super(message, init);
    this.name = "ConflictError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ServerError extends DMZAgentError {
  constructor(message: string, init: DMZAgentErrorInit = {}) {
    super(message, init);
    this.name = "ServerError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface CBOpenErrorInit extends DMZAgentErrorInit {
  reason?: string;
  firedPolicies?: ReadonlyArray<FiredPolicy>;
  anchor?: AnchorRef | null;
  scopeRef?: string;
}

export class CBOpenError extends DMZAgentError {
  public readonly reason: string;
  public readonly firedPolicies: ReadonlyArray<FiredPolicy>;
  public readonly anchor: AnchorRef | null;
  public readonly scopeRef: string;

  constructor(message: string, init: CBOpenErrorInit = {}) {
    super(message, init);
    this.name = "CBOpenError";
    this.reason = init.reason ?? "";
    this.firedPolicies = init.firedPolicies ?? [];
    this.anchor = init.anchor ?? null;
    this.scopeRef = init.scopeRef ?? "";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
