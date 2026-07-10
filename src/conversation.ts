/**
 * High-level conversation handle.
 *
 * The shape generalizes naturally: a single-agent-with-customer chat, a
 * multi-agent workflow, a sensor feed with detected persons — every
 * variant just lists its participants and their roles. No baked-in
 * user/agent dichotomy on the SDK surface.
 *
 *   using conv = cx.conversation({
 *     participants: [
 *       { subject_id: "subject:dv:bot",  role: "agent",    kind: "agent" },
 *       { subject_id: "subject:dv:cust", role: "customer", kind: "human" },
 *     ],
 *   });
 *   await conv.says("subject:dv:cust", "I want a refund.");
 *   await conv.says("subject:dv:bot",  "I can help.");
 *
 * The interaction_id is captured from the first event the server
 * returns and re-sent on subsequent calls so events stitch into the
 * same interaction.
 */

import type {
  DMZAgent,
  ConversationOptions,
  GuardHandle,
} from "./client.js";
import type { CheckResult, EmitResult, Subject } from "./models.js";

// NOTE: Importing `DMZAgent` as `import type` keeps this file at the
// type level of the client module, breaking the runtime cycle that
// would otherwise form (client.ts imports Conversation at runtime).

// Roles the SDK treats as "this participant is an agent for the
// purposes of the wire protocol's agent_subject_id requirement." Mirrors
// the Python reference implementation (`{"agent", "service", "system"}`).
const AGENT_ROLES = new Set(["agent", "service", "system"]);

export class Conversation {
  readonly #client: DMZAgent;
  readonly #agentSubjectId: string;
  readonly #subjectType: string;
  readonly #interactionKind: string;
  // Roster is mutable internally via addSubject; we hand out a frozen
  // snapshot from the public getter.
  #subjects: Subject[];
  #interactionId: string | null = null;
  #closed = false;

  constructor(client: DMZAgent, opts: ConversationOptions) {
    if (!opts || !Array.isArray(opts.participants) || opts.participants.length === 0) {
      throw new RangeError("participants must be a non-empty array");
    }
    const roster: Subject[] = [];
    opts.participants.forEach((p, i) => {
      const sid = (p?.subject_id ?? "").trim();
      if (!sid) {
        throw new RangeError(`participants[${i}] missing subject_id`);
      }
      roster.push({
        subject_id: sid,
        role: p?.role || "other",
        kind: p?.kind || "other",
        ...(p?.subject_type ? { subject_type: p.subject_type } : {}),
        ...(p?.metadata ? { metadata: p.metadata } : {}),
      });
    });

    // Derive the wire-level agent_subject_id when the caller didn't set
    // it explicitly. First participant whose role looks agent-ish wins;
    // otherwise the first participant — every event needs something
    // anchored, and the SDK defaults conservatively.
    let agentSubjectId = opts.agentSubjectId;
    if (!agentSubjectId) {
      const agentish = roster.find((p) =>
        AGENT_ROLES.has((p.role ?? "").toLowerCase()),
      );
      agentSubjectId = agentish?.subject_id ?? roster[0]!.subject_id;
    }

    this.#client = client;
    this.#agentSubjectId = agentSubjectId;
    // Wire-level subject_type for every event this handle emits: first
    // participant that declares one wins, otherwise "chat" — mirrors the
    // C# reference implementation (a conversation is chat-shaped unless
    // the roster says otherwise).
    this.#subjectType =
      roster.find((p) => p.subject_type)?.subject_type ?? "chat";
    this.#interactionKind = opts.kind ?? "chat_session";
    this.#subjects = roster;
  }

  // ---------- properties ----------

  /** Server-assigned interaction id, available after the first event. */
  get interactionId(): string | null {
    return this.#interactionId;
  }

  /** Read-only snapshot of the current roster — mutate via `addSubject`. */
  get subjects(): ReadonlyArray<Subject> {
    return Object.freeze(this.#subjects.map((s) => Object.freeze({ ...s })));
  }

  // ---------- roster management ----------

  /**
   * Add (or refresh) a participant. Idempotent on `subjectId`: re-adding
   * with the same id replaces role/kind/metadata.
   */
  addSubject(
    subjectId: string,
    opts: { role?: string; kind?: string; metadata?: Record<string, unknown> } = {},
  ): void {
    const role = opts.role ?? "other";
    const kind = opts.kind ?? "other";
    const updated: Subject = {
      subject_id: subjectId,
      role,
      kind,
      ...(opts.metadata ? { metadata: opts.metadata } : {}),
    };
    const idx = this.#subjects.findIndex((s) => s.subject_id === subjectId);
    if (idx >= 0) {
      this.#subjects[idx] = updated;
    } else {
      this.#subjects.push(updated);
    }
  }

  // ---------- event emission ----------

  async says(
    subjectId: string,
    text: string,
    payloadExtra?: Record<string, unknown>,
  ): Promise<EmitResult> {
    const result = await this.#client.subjectSays({
      subjectId,
      text,
      agentSubjectId: this.#agentSubjectId,
      subjectType: this.#subjectType,
      interactionKind: this.#interactionKind,
      subjects: this.#subjects,
      ...(this.#interactionId ? { interactionId: this.#interactionId } : {}),
      ...(payloadExtra ? { payloadExtra } : {}),
    });
    this.#captureInteractionId(result);
    return result;
  }

  async toolCall(
    subjectId: string,
    tool: string,
    args?: Record<string, unknown>,
  ): Promise<EmitResult> {
    const result = await this.#client.toolCall({
      subjectId,
      tool,
      subjectType: this.#subjectType,
      ...(args ? { args } : {}),
      interactionKind: this.#interactionKind,
      subjects: this.#subjects,
      ...(this.#interactionId ? { interactionId: this.#interactionId } : {}),
    });
    this.#captureInteractionId(result);
    return result;
  }

  async toolResult(
    subjectId: string,
    tool: string,
    result: unknown,
  ): Promise<EmitResult> {
    const emit = await this.#client.toolResult({
      subjectId,
      tool,
      result,
      subjectType: this.#subjectType,
      interactionKind: this.#interactionKind,
      subjects: this.#subjects,
      ...(this.#interactionId ? { interactionId: this.#interactionId } : {}),
    });
    this.#captureInteractionId(emit);
    return emit;
  }

  async observation(payload: Record<string, unknown>): Promise<EmitResult> {
    const result = await this.#client.observation({
      agentSubjectId: this.#agentSubjectId,
      subjectType: this.#subjectType,
      subjects: this.#subjects,
      payload,
      interactionKind: this.#interactionKind,
      ...(this.#interactionId ? { interactionId: this.#interactionId } : {}),
    });
    this.#captureInteractionId(result);
    return result;
  }

  // ---------- circuit breaker ----------

  check(subjectId: string): Promise<CheckResult> {
    return this.#client.check({ subjectId });
  }

  guard(
    subjectId: string,
    opts: { raiseOnOpen?: boolean } = {},
  ): Promise<GuardHandle> {
    return this.#client.guard({
      subjectId,
      raiseOnOpen: opts.raiseOnOpen ?? false,
    });
  }

  // ---------- lifecycle ----------

  /**
   * Currently a no-op. Reserved for a future `end_interaction` event
   * once the wire protocol grows it (spec §6.3). Idempotent.
   */
  close(): void {
    this.#closed = true;
  }

  /** Whether `close()` has been called. */
  get closed(): boolean {
    return this.#closed;
  }

  // Disposable / using support.
  [Symbol.dispose]?(): void {
    this.close();
  }

  // ---------- internals ----------

  #captureInteractionId(result: EmitResult): void {
    if (!this.#interactionId && result.interactionId) {
      this.#interactionId = result.interactionId;
    }
  }
}

// Symbol.dispose may not be in lib.dom at compile time in every TS lib
// configuration; the runtime always has it (Node 22) or the polyfill via
// Symbol.for, applied in client.ts. We register the method conditionally
// below so the prototype carries it even on older lib targets.
{
  const disposeSymbol =
    typeof Symbol.dispose === "symbol"
      ? Symbol.dispose
      : (Symbol.for("nodejs.dispose") as unknown as typeof Symbol.dispose);
  const proto = Conversation.prototype as unknown as Record<symbol, unknown>;
  if (disposeSymbol && !proto[disposeSymbol]) {
    proto[disposeSymbol] = function (
      this: Conversation,
    ): void {
      this.close();
    };
  }
}
