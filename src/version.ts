/**
 * The single source of truth for the pinned spec version.
 *
 * This lived in two places — a private constant in `client.ts` backing the
 * User-Agent, and the exported `SPEC_VERSION` in `index.ts` — which meant a
 * version bump could update one and leave the other behind. It did: the
 * exported constant read 0.8.0 while the User-Agent still said 0.6.0.
 *
 * Keep it here, import it in both. Its own module rather than `index.ts`
 * because `index.ts` re-exports `client.ts`, so importing it back would be
 * circular.
 *
 * MUST match `dmzagent.specVersion` in package.json (spec §12.1).
 */
export const SPEC_VERSION = "0.8.0";
