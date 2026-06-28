import prisma from "../dbConnection";
import { logger } from "../utils/logger";
import { getLLMProvider, MatchmakerFilters } from "./llm";

const MAX_RESULTS = 20;
const MAX_CANDIDATES = 500;

export type MatchmakerResult = {
  filters: MatchmakerFilters;
  partialMatch: boolean;
  photographers: any[];
};

export async function searchPhotographersByPrompt(prompt: string): Promise<MatchmakerResult> {
  const trimmed = (prompt || "").trim();
  if (!trimmed) {
    throw new Error("Prompt is required");
  }

  const provider = getLLMProvider();
  const filters = await provider.parseMatchmakerQuery(trimmed);

  if (!filters.keywords?.length && provider.name === "noop") {
    filters.keywords = extractKeywordsFallback(trimmed);
  }

  // Defensive: Gemini occasionally drops obvious geographic mentions.
  // If the prompt clearly contains "in X" / "based in X" / "near X" etc.
  // and locations came back empty, pull capitalized words from the prompt.
  if (!filters.locations?.length) {
    const inferred = inferLocationsFromPrompt(trimmed);
    if (inferred.length > 0) {
      filters.locations = inferred;
    }
  }

  logger(`[MATCHMAKER] provider=${provider.name} prompt="${trimmed}" filters=${JSON.stringify(filters)}`);

  // Fetch the full approved set and filter in JS. Location is the only
  // hard filter; type/rate/rating/availability/keywords all become scoring
  // signals, so photographers always rank highest when they match more
  // of what the user described.
  const candidates = await prisma.photographer_profile.findMany({
    where: { approved: true },
    select: SELECT_FIELDS,
    take: MAX_CANDIDATES,
    orderBy: { updated_at: "desc" },
  });

  let matches = candidates.filter((p) => matchesAllStrict(p, filters));
  let partialMatch = false;

  // If price or rating excluded everyone in the requested location, relax
  // those bounds and try once more so the user still sees nearby options
  // with a partial-match flag. Location itself is never relaxed.
  const hadPriceOrRating =
    filters.minHourlyRate !== undefined ||
    filters.maxHourlyRate !== undefined ||
    filters.minRating !== undefined;
  if (matches.length === 0 && hadPriceOrRating) {
    const relaxed: MatchmakerFilters = {
      ...filters,
      minHourlyRate: undefined,
      maxHourlyRate: undefined,
      minRating: undefined,
    };
    const relaxedMatches = candidates.filter((p) => matchesAllStrict(p, relaxed));
    if (relaxedMatches.length > 0) {
      matches = relaxedMatches;
      partialMatch = true;
    }
  }

  const ranked = rankResults(matches, filters).slice(0, MAX_RESULTS);
  return { filters, partialMatch, photographers: ranked };
}

const SELECT_FIELDS = {
  id: true,
  user_id: true,
  bio: true,
  approved: true,
  application_status: true,
  availability: true,
  weekly_availability: true,
  photographer_type: true,
  years_experience: true,
  service_area: true,
  service_areas: true,
  service_keywords: true,
  portfolio_url: true,
  instagram_url: true,
  website_url: true,
  gear_description: true,
  business_name: true,
  short_pitch: true,
  hourly_rate: true,
  price_min: true,
  price_max: true,
  rating_average: true,
  rating_count: true,
  photographer_responses: true,
  has_new_photographer_response: true,
  submission_count: true,
  admin_feedback: true,
  feedback_provided_at: true,
  created_at: true,
  updated_at: true,
  user: {
    select: { id: true, name: true, email: true, avatar_url: true },
  },
} as const;

// Hard filters: location + price + rating. These are concrete signals — a
// user who says "in California, under $50" really means it. Soft signals
// (photographer_type, availability, keywords) are noisy free-text fields
// that only contribute to ranking, never exclusion.
// Empty/null data on the photographer side never excludes — only an
// explicit mismatch does.
function matchesAllStrict(row: any, filters: MatchmakerFilters): boolean {
  if (filters.locations?.length) {
    const haystack = locationHaystack(row);
    if (!haystack) return false;
    const ok = filters.locations.some((loc) => haystack.includes(loc.toLowerCase()));
    if (!ok) return false;
  }

  if (filters.maxHourlyRate !== undefined && typeof row.hourly_rate === "number") {
    if (row.hourly_rate > filters.maxHourlyRate) return false;
  }
  if (filters.minHourlyRate !== undefined && typeof row.hourly_rate === "number") {
    if (row.hourly_rate < filters.minHourlyRate) return false;
  }

  if (filters.minRating !== undefined && typeof row.rating_average === "number") {
    if (row.rating_average < filters.minRating) return false;
  }

  return true;
}

function locationHaystack(row: any): string {
  const parts: string[] = [];
  if (typeof row.service_area === "string") parts.push(row.service_area);
  if (Array.isArray(row.service_areas)) {
    for (const entry of row.service_areas) {
      if (typeof entry === "string") parts.push(entry);
    }
  }
  return parts.join(" | ").toLowerCase();
}

function availabilityHaystack(row: any): string {
  const parts: string[] = [];
  if (typeof row.availability === "string") parts.push(row.availability);
  if (row.weekly_availability && typeof row.weekly_availability === "object") {
    for (const day of Object.keys(row.weekly_availability)) {
      parts.push(day);
    }
  }
  return parts.join(" ").toLowerCase();
}

function textHaystack(row: any): string {
  return [
    typeof row.service_keywords === "string" ? row.service_keywords : "",
    typeof row.short_pitch === "string" ? row.short_pitch : "",
    typeof row.bio === "string" ? row.bio : "",
    typeof row.photographer_type === "string" ? row.photographer_type : "",
  ]
    .join(" ")
    .toLowerCase();
}

function rankResults(rows: any[], filters: MatchmakerFilters): any[] {
  return rows
    .map((row) => ({ row, score: scoreRow(row, filters) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.row);
}

function scoreRow(row: any, filters: MatchmakerFilters): number {
  let score = 0;

  if (filters.photographerType) {
    const pt = typeof row.photographer_type === "string" ? row.photographer_type.toLowerCase() : "";
    if (pt.includes(filters.photographerType)) score += 3;
  }

  if (filters.locations?.length) {
    const haystack = locationHaystack(row);
    for (const loc of filters.locations) {
      if (haystack.includes(loc.toLowerCase())) score += 2;
    }
  }

  if (filters.availabilityDays?.length) {
    const haystack = availabilityHaystack(row);
    for (const day of filters.availabilityDays) {
      if (haystack.includes(day.toLowerCase())) score += 1;
    }
  }

  if (filters.maxHourlyRate !== undefined && typeof row.hourly_rate === "number") {
    if (row.hourly_rate <= filters.maxHourlyRate) score += 1;
  }

  if (filters.minRating !== undefined && typeof row.rating_average === "number") {
    if (row.rating_average >= filters.minRating) score += 2;
  }

  if (filters.keywords?.length) {
    const haystack = textHaystack(row);
    for (const kw of filters.keywords) {
      if (haystack.includes(kw.toLowerCase())) score += 1;
    }
  }

  return score;
}

// Pulls obvious geographic mentions out of a free-text prompt. Looks for
// capitalized words that follow location-introducing prepositions. Used only
// when the LLM returned no locations — never overrides Gemini.
function inferLocationsFromPrompt(prompt: string): string[] {
  const matches: string[] = [];
  const re = /\b(?:in|based in|near|around|from|located in|nearby)\s+([A-Z][a-zA-Z]+(?:\s+(?:or\s+)?[A-Z][a-zA-Z]+)*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt)) !== null) {
    for (const part of m[1].split(/\s+or\s+|,\s*/)) {
      const trimmed = part.trim();
      if (trimmed && !STOP_WORDS.has(trimmed.toLowerCase())) {
        matches.push(trimmed);
      }
    }
  }
  return Array.from(new Set(matches));
}

const STOP_WORDS = new Set([
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
  "i", "we", "the", "a", "an", "any", "all", "some",
]);

function extractKeywordsFallback(prompt: string): string[] {
  return Array.from(
    new Set(
      prompt
        .toLowerCase()
        .replace(/[^a-z0-9\s$]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2)
    )
  ).slice(0, 8);
}
