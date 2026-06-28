import { GoogleGenAI, Type } from "@google/genai";
import { logger } from "../../utils/logger";
import { LLMProvider, MatchmakerFilters } from "./types";

const MODEL = process.env.LLM_MATCHMAKER_MODEL || "gemini-2.5-flash";
const TIMEOUT_MS = Number(process.env.LLM_MATCHMAKER_TIMEOUT_MS || "6000");

const SYSTEM_INSTRUCTION = `You extract structured search filters from a user's free-text request for a photographer.
Return ONLY JSON matching the provided schema. Omit any field the user did not mention.

Rules:
- Days of the week: lowercase ("monday".."sunday"). "Mon-Fri" expands to all five. "weekend" expands to ["saturday","sunday"]. "any day" / "coming monday" → just that day.
- Locations: ALWAYS extract every city/state/country/region the user mentions, especially after phrases like "in", "based in", "near", "around", "from", "located in", "nearby". Use names as written ("Florida", "Chicago", "Illinois", "California"). If the user says "X or Y" or "X or nearby areas", include BOTH X and Y as separate items.
- photographerType: one short token: "event", "real-estate", "portrait", "drone", "commercial", "3d-tour", "wedding", "product", "fashion".
- Hourly rates are integers in USD. "$50/hr" or "around $50" or "under $50" → maxHourlyRate=50. "at least $30" → minHourlyRate=30.
- minRating: a number 1-5 if a star rating threshold is mentioned ("4.5+", "5-star", "highly rated" → 4.5).
- keywords: descriptive terms NOT covered by the other fields. NEVER put a location, day, price, rating, or photographer type into keywords.`;

const FILTER_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    photographerType: { type: Type.STRING },
    minHourlyRate: { type: Type.NUMBER },
    maxHourlyRate: { type: Type.NUMBER },
    availabilityDays: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    locations: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    keywords: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    minRating: { type: Type.NUMBER },
  },
};

export class GeminiMatchmakerProvider implements LLMProvider {
  readonly name = "gemini";
  private client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async parseMatchmakerQuery(prompt: string): Promise<MatchmakerFilters> {
    const call = this.client.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: FILTER_SCHEMA,
        temperature: 0,
      },
    });

    let timeoutHandle: NodeJS.Timeout | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error("LLM_TIMEOUT")), TIMEOUT_MS);
    });

    try {
      const response = await Promise.race([call, timeout]);
      const text = response.text ?? "";
      if (!text) return {};
      return normalizeFilters(JSON.parse(text));
    } catch (err) {
      logger(`[MATCHMAKER] Gemini parse failed: ${err instanceof Error ? err.message : String(err)}`);
      return {};
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }
}

function normalizeFilters(raw: unknown): MatchmakerFilters {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: MatchmakerFilters = {};

  if (typeof r.photographerType === "string" && r.photographerType.trim()) {
    out.photographerType = r.photographerType.trim().toLowerCase();
  }
  if (typeof r.minHourlyRate === "number" && r.minHourlyRate > 0) out.minHourlyRate = r.minHourlyRate;
  if (typeof r.maxHourlyRate === "number" && r.maxHourlyRate > 0) out.maxHourlyRate = r.maxHourlyRate;
  if (typeof r.minRating === "number" && r.minRating > 0) out.minRating = r.minRating;

  out.availabilityDays = asStringArray(r.availabilityDays).map((d) => d.toLowerCase());
  out.locations = asStringArray(r.locations);
  out.keywords = asStringArray(r.keywords);

  if (out.availabilityDays.length === 0) delete out.availabilityDays;
  if (out.locations.length === 0) delete out.locations;
  if (out.keywords.length === 0) delete out.keywords;

  return out;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}
