import { createHash } from "crypto";

export function stableId(input: string) {
  return createHash("sha256").update(input.trim().toLowerCase()).digest("hex").slice(0, 24);
}

export function todayIsoDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function compactText(value: string | undefined | null, max = 420) {
  const normalized = String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).trim()}...`;
}

export function clampScore(value: number) {
  if (!Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function formatDisplayDate(dateLike: string | null | undefined) {
  if (!dateLike) return "Unknown date";
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return dateLike;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

export function containsLongevitySignal(text: string) {
  const haystack = text.toLowerCase();
  return LONGEVITY_TERMS.some((term) => haystack.includes(term));
}

export const LONGEVITY_TERMS = [
  "aging",
  "ageing",
  "longevity",
  "healthspan",
  "lifespan",
  "senescence",
  "senolytic",
  "epigenetic clock",
  "biological age",
  "rapamycin",
  "metformin",
  "nad",
  "nmn",
  "nr ",
  "glp-1",
  "autophagy",
  "mTOR",
  "sirtuin",
  "mitochondria",
  "inflammaging",
  "rejuvenation",
  "cellular reprogramming",
  "caloric restriction",
  "geroscience",
  "older",
  "older adults",
  "aged",
  "age-related",
  "frailty",
  "sarcopenia",
  "biohacking",
  "supplement"
].map((term) => term.toLowerCase());
