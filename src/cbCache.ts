/**
 * In-process circuit-breaker state cache (sdk-spec.md §4.4).
 *
 * `check()` is a network round trip on a path callers put in front of a
 * sensitive action, and it is often the only synchronous DMZAgent call in
 * a request. This removes that round trip for repeated checks on the same
 * subject.
 *
 * WHAT THE CALLER IS CHOOSING. A cached `closed` is an allow the server
 * might no longer give. **The TTL is the maximum time a newly-opened
 * breaker can go unobserved by this client.** Nothing here softens that,
 * and every served entry carries its age so the caller can see it.
 *
 * One TTL applies to every state. Holding a deny longer than an allow is
 * a safety policy and it belongs to whoever set the TTL, not to this
 * module.
 *
 * The clock is `performance.now()`: a TTL measured against the wall clock
 * would expire early or late whenever the host's time is adjusted, and
 * the adjustment is invisible to the caller.
 */
import type { CheckResult } from "./models.js";

/**
 * The cache is off at zero. Callers treat <= 0 as "never asked for a
 * cache" and MUST NOT substitute a default.
 */
export const DISABLED_TTL_MS = 0;

export const ON_ERROR_RAISE = "raise";
export const ON_ERROR_LAST_KNOWN = "last_known";
export type CbCacheOnError = typeof ON_ERROR_RAISE | typeof ON_ERROR_LAST_KNOWN;
export const ON_ERROR_POLICIES: ReadonlyArray<string> = [
  ON_ERROR_RAISE,
  ON_ERROR_LAST_KNOWN,
];

export const DEFAULT_MAX_ENTRIES = 1024;

/** A cached result and the age, in ms, at which it was read. */
export interface CacheHit {
  readonly result: CheckResult;
  readonly ageMs: number;
}

interface Entry {
  result: CheckResult;
  storedAt: number; // performance.now()
}

/** NUL cannot occur inside a scope name or a subject id, so `subject`
 *  + `"a"` can never collide with `subjecta` + `""`. Written as an
 *  escape so the source file stays text. */
const KEY_SEP = "\u0000";

/**
 * Bounded, TTL'd map of (scope, scopeRef) → CheckResult.
 *
 * Bounded because the key is a subject id: an agent that sees a hundred
 * thousand subjects would otherwise hold a hundred thousand entries for
 * the life of the process. A JS `Map` iterates in insertion order, so
 * re-inserting on read and evicting the first key is a true LRU.
 */
export class CBStateCache {
  readonly #ttlMs: number;
  readonly #max: number;
  readonly #entries = new Map<string, Entry>();

  constructor(ttlMs: number, maxEntries: number = DEFAULT_MAX_ENTRIES) {
    if (!Number.isFinite(maxEntries) || maxEntries < 1) {
      throw new RangeError("cbCacheMaxEntries must be at least 1");
    }
    this.#ttlMs = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : DISABLED_TTL_MS;
    this.#max = Math.floor(maxEntries);
  }

  get enabled(): boolean {
    return this.#ttlMs > DISABLED_TTL_MS;
  }

  get ttlMs(): number {
    return this.#ttlMs;
  }

  get size(): number {
    return this.#entries.size;
  }

  static key(scope: string, scopeRef: string): string {
    return `${scope}${KEY_SEP}${scopeRef}`;
  }

  /**
   * A live entry, or undefined.
   *
   * An expired entry is left in place rather than dropped — the
   * `last_known` error policy is the reason it is still worth something
   * after the TTL. Eviction is by size, never by age.
   */
  get(key: string): CacheHit | undefined {
    const hit = this.#lookup(key);
    if (hit === undefined) return undefined;
    return hit.ageMs <= this.#ttlMs ? hit : undefined;
  }

  /**
   * A live OR expired entry. Only the `last_known` error policy may use
   * this, and only after a failed check.
   */
  getAny(key: string): CacheHit | undefined {
    return this.#lookup(key);
  }

  /**
   * Store a SUCCESSFUL check. Errors are never cached: a failure is not a
   * state, and serving one back would turn one bad round trip into a
   * TTL's worth of them.
   */
  put(key: string, result: CheckResult): void {
    if (!this.enabled) return;
    this.#entries.delete(key);
    this.#entries.set(key, { result, storedAt: performance.now() });
    while (this.#entries.size > this.#max) {
      const oldest = this.#entries.keys().next();
      if (oldest.done === true) break;
      this.#entries.delete(oldest.value);
    }
  }

  clear(): void {
    this.#entries.clear();
  }

  #lookup(key: string): CacheHit | undefined {
    if (!this.enabled) return undefined;
    const entry = this.#entries.get(key);
    if (entry === undefined) return undefined;
    // Re-insert so this key becomes the most recently used.
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return {
      result: entry.result,
      ageMs: Math.max(0, performance.now() - entry.storedAt),
    };
  }
}
