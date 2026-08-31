/**
 * The spec version is written down in several places; they have to agree.
 *
 * Found while adding the state cache: `src/agent.ts` declared its own
 * `SPEC_VERSION = "0.6.0"` while `src/version.ts` read `0.8.0`. Both are
 * published — `@dmzagent/sdk` and `@dmzagent/sdk/agent` — so two entry
 * points of the same package exported the same symbol with different
 * values, and the User-Agent used one of them.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SPEC_VERSION as AGENT_SUBPATH_VERSION } from "../src/agent.js";
import { DMZAgent } from "../src/client.js";
import { SPEC_VERSION } from "../src/version.js";

const HERE = dirname(fileURLToPath(import.meta.url));

function pinnedVersion(): string {
  const pkg = JSON.parse(
    readFileSync(resolve(HERE, "..", "package.json"), "utf8"),
  ) as { dmzagent?: { specVersion?: string } };
  return pkg.dmzagent?.specVersion ?? "";
}

describe("spec version markers", () => {
  it("every published marker agrees with the manifest pin", () => {
    expect(SPEC_VERSION).toBe(pinnedVersion());
    expect(AGENT_SUBPATH_VERSION).toBe(pinnedVersion());
  });

  it("the User-Agent carries the pinned version", async () => {
    // The marker a server actually sees.
    let seen = "";
    const cx = new DMZAgent({
      apiKey: "ck_test_x",
      fetch: (async (_url: string, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        seen = headers.get("user-agent") ?? "";
        return new Response(JSON.stringify({ state: "closed", allow: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as never,
    });
    await cx.check({ subjectId: "user:ws:a" });
    expect(seen).toBe(`dmzagent-typescript/${pinnedVersion()}`);
  });
});
