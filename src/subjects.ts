import type { Subject } from "./models.js";

const SUBJECT_PREFIX = "subject";
const DEFAULT_MAX_SLUG_LENGTH = 48;
const NON_SLUG_CHARS = /[^a-z0-9]+/g;

export const SUBJECT_TYPES = [
  "chat", "sensor", "lead", "ticket", "journey", "custom", "other",
] as const;

export type SubjectType = (typeof SUBJECT_TYPES)[number];

export interface SubjectIdOptions {
  maxLength?: number;
}

export interface SubjectForDivisionOptions extends SubjectIdOptions {
  role?: string;
  kind?: string;
  metadata?: Record<string, unknown>;
  /** Subject type for 4-part form: `subject:<div>:<type>:<slug>`.
   *  Omitted → 3-part form. One of: chat, sensor, lead, ticket, journey,
   *  custom, other, or any string. */
  subjectType?: string;
}

export function slugifySubject(value: string, options: SubjectIdOptions = {}): string {
  const maxLength = options.maxLength ?? DEFAULT_MAX_SLUG_LENGTH;
  if (!Number.isInteger(maxLength) || maxLength <= 0) {
    throw new RangeError("maxLength must be a positive integer");
  }
  const slug = value
    .trim()
    .toLowerCase()
    .replace(NON_SLUG_CHARS, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength);
  return slug || "subject";
}

export function isCanonicalSubjectId(subjectId: string | null | undefined): boolean {
  const parts = (subjectId ?? "").split(":");
  const n = parts.length;
  if (n < 3 || parts[0] !== SUBJECT_PREFIX) return false;
  if (n === 3) return !!parts[1] && !!parts[2];
  if (n === 4) return !!parts[1] && !!parts[2] && !!parts[3];
  return false;
}

export function subjectTypeFromSubjectId(subjectId: string | null | undefined): string | undefined {
  const parts = (subjectId ?? "").split(":");
  if (parts.length >= 4 && parts[0] === SUBJECT_PREFIX && !!parts[2]) {
    return parts[2];
  }
  return undefined;
}

export function subjectIdForDivision(
  divisionId: string,
  displayNameOrSlug: string,
  options: SubjectForDivisionOptions = {},
): string {
  const division = divisionId.trim();
  if (!division) {
    throw new RangeError("divisionId is required");
  }
  if (division.includes(":")) {
    throw new RangeError("divisionId must not contain ':'");
  }
  if (typeof displayNameOrSlug !== "string" || displayNameOrSlug.trim().length === 0) {
    throw new RangeError("displayNameOrSlug is required");
  }
  const slug = slugifySubject(displayNameOrSlug, options);
  const subjectType = options.subjectType;
  if (subjectType) {
    return `${SUBJECT_PREFIX}:${division}:${subjectType}:${slug}`;
  }
  return `${SUBJECT_PREFIX}:${division}:${slug}`;
}

export function subjectForDivision(
  divisionId: string,
  displayNameOrSlug: string,
  options: SubjectForDivisionOptions = {},
): Subject {
  const { role, kind, metadata, subjectType, ...idOptions } = options;
  return {
    subject_id: subjectIdForDivision(divisionId, displayNameOrSlug, { subjectType, ...idOptions }),
    role: role ?? "other",
    kind: kind ?? "other",
    ...(metadata ? { metadata } : {}),
  };
}
