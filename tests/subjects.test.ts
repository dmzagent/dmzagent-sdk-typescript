import { describe, expect, it } from "vitest";

import {
  isCanonicalSubjectId,
  slugifySubject,
  subjectForDivision,
  subjectIdForDivision,
} from "../src/index.js";

describe("subject helpers", () => {
  it("slugifies display names the same way as the backend", () => {
    expect(slugifySubject("Acme Leasing Bot")).toBe("acme-leasing-bot");
    expect(slugifySubject("foo!!! bar??")).toBe("foo-bar");
    expect(slugifySubject("  --hello--  ")).toBe("hello");
    expect(slugifySubject("!!!---???")).toBe("subject");
    expect(slugifySubject("x".repeat(100), { maxLength: 10 })).toHaveLength(10);
  });

  it("builds canonical division-scoped subject ids", () => {
    expect(subjectIdForDivision("dv_demo", "Acme Leasing Bot")).toBe(
      "subject:dv_demo:acme-leasing-bot",
    );
    expect(isCanonicalSubjectId("subject:dv_demo:acme-leasing-bot")).toBe(true);
    expect(isCanonicalSubjectId("user:ws_demo:acme-leasing-bot")).toBe(false);
  });

  it("builds participant objects for conversation rosters", () => {
    expect(subjectForDivision("dv_demo", "Customer 42", {
      role: "customer",
      kind: "human",
      metadata: { leadId: "lead_42" },
    })).toEqual({
      subject_id: "subject:dv_demo:customer-42",
      role: "customer",
      kind: "human",
      metadata: { leadId: "lead_42" },
    });
  });

  it("rejects invalid division ids", () => {
    expect(() => subjectIdForDivision("", "bot")).toThrow(RangeError);
    expect(() => subjectIdForDivision("dv:bad", "bot")).toThrow(RangeError);
  });
});
