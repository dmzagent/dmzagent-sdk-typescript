/**
 * A handle bound to one agent session (spec §5.23).
 *
 *   const s = cx.agentSession({
 *     agentSubjectId: "subject:dv:agent-a",
 *     interactionId:  "sess_4b1e",
 *   });
 *
 *   await s.intent("Add a trace id to every request.", { paths: ["src/obs/"] });
 *
 *   const r = await s.call("call_7", "Bash", { args: { command: "git push" } });
 *   if (r.runs) {
 *     const out = await runTool();
 *     await s.result("call_7", "Bash", "ok", { result: out });
 *   } else {
 *     // Refusals are reported, whoever refused (spec §1.9).
 *     await s.refused("call_7", "Bash", "governor", { reason: r.reason });
 *   }
 *
 * Each method sends exactly one step through `DMZAgent.agentStep()` and
 * returns its `StepResult`; every local check of §5.22 applies.
 *
 * The handle holds its two ids and nothing else. It does not remember
 * refusals, count attempts, or infer `attemptOf`: a caller that knows a call
 * retries an earlier one says so, and the server does not depend on it.
 * A handle that guessed would put words in the harness's mouth on exactly
 * the evidence circumvention is judged on.
 */

import type { AgentSessionOptions, AgentStepOptions, DMZAgent } from "./client.js";
import { ValidationError } from "./errors.js";
import type { StepResult } from "./models.js";

// `import type` for DMZAgent keeps this module off the runtime import graph
// of client.ts, which imports this one — the same arrangement as
// conversation.ts.

export interface IntentStepOptions {
  paths?: ReadonlyArray<string>;
  tools?: ReadonlyArray<string>;
  idempotencyKey?: string;
}

export interface CallStepOptions {
  args?: Record<string, unknown>;
  attemptOf?: string;
  idempotencyKey?: string;
}

export interface ResultStepOptions {
  result?: unknown;
  reason?: string;
  idempotencyKey?: string;
}

export interface RefusedStepOptions {
  reason?: string;
  attemptOf?: string;
  idempotencyKey?: string;
}

export class AgentSession {
  readonly #client: DMZAgent;
  readonly #agentSubjectId: string;
  readonly #interactionId: string;

  constructor(client: DMZAgent, opts: AgentSessionOptions) {
    if (!opts || typeof opts.agentSubjectId !== "string" || opts.agentSubjectId.length === 0) {
      throw new ValidationError("agentSubjectId is required");
    }
    if (typeof opts.interactionId !== "string" || opts.interactionId.length === 0) {
      throw new ValidationError(
        "interactionId is required: the session is caller-assigned and stable for its life",
      );
    }
    this.#client = client;
    this.#agentSubjectId = opts.agentSubjectId;
    this.#interactionId = opts.interactionId;
  }

  get agentSubjectId(): string {
    return this.#agentSubjectId;
  }

  get interactionId(): string {
    return this.#interactionId;
  }

  /** `phase: intent` — what the agent says it will do and touch. */
  intent(text: string, opts: IntentStepOptions = {}): Promise<StepResult> {
    return this.#step({
      phase: "intent",
      intent: {
        text,
        ...(opts.paths !== undefined ? { paths: opts.paths } : {}),
        ...(opts.tools !== undefined ? { tools: opts.tools } : {}),
      },
      ...(opts.idempotencyKey !== undefined ? { idempotencyKey: opts.idempotencyKey } : {}),
    });
  }

  /** `phase: call` — send BEFORE the tool runs; run it only when `runs`. */
  call(callId: string, tool: string, opts: CallStepOptions = {}): Promise<StepResult> {
    return this.#step({
      phase: "call",
      callId,
      tool,
      ...(opts.args !== undefined ? { args: opts.args } : {}),
      ...(opts.attemptOf !== undefined ? { attemptOf: opts.attemptOf } : {}),
      ...(opts.idempotencyKey !== undefined ? { idempotencyKey: opts.idempotencyKey } : {}),
    });
  }

  /**
   * `phase: result` for a call that ran — `status` is `ok` or `error`.
   * A call that did not run is reported with `refused()`, which says who
   * refused it.
   */
  result(
    callId: string,
    tool: string,
    status: "ok" | "error",
    opts: ResultStepOptions = {},
  ): Promise<StepResult> {
    if (status !== "ok" && status !== "error") {
      return Promise.reject(
        new ValidationError(
          `status must be "ok" or "error" on result(), got ${JSON.stringify(status)}; ` +
            "report a call that did not run with refused(), which names who refused it",
        ),
      );
    }
    return this.#step({
      phase: "result",
      callId,
      tool,
      status,
      ...(opts.result !== undefined ? { result: opts.result } : {}),
      ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
      ...(opts.idempotencyKey !== undefined ? { idempotencyKey: opts.idempotencyKey } : {}),
    });
  }

  /**
   * `phase: result`, `status: refused` — for every call that did not run,
   * whoever refused it: `governor` (DMZAgent's directive), `harness` (your
   * runner's own rules) or `host` (the tool, sandbox or operating system).
   */
  refused(
    callId: string,
    tool: string,
    refusedBy: "governor" | "harness" | "host",
    opts: RefusedStepOptions = {},
  ): Promise<StepResult> {
    return this.#step({
      phase: "result",
      callId,
      tool,
      status: "refused",
      refusedBy,
      ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
      ...(opts.attemptOf !== undefined ? { attemptOf: opts.attemptOf } : {}),
      ...(opts.idempotencyKey !== undefined ? { idempotencyKey: opts.idempotencyKey } : {}),
    });
  }

  #step(
    step: Omit<AgentStepOptions, "agentSubjectId" | "interactionId">,
  ): Promise<StepResult> {
    return this.#client.agentStep({
      agentSubjectId: this.#agentSubjectId,
      interactionId: this.#interactionId,
      ...step,
    });
  }
}
