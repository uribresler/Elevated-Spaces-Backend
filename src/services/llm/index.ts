import { logger } from "../../utils/logger";
import { GeminiMatchmakerProvider } from "./gemini.provider";
import { LLMProvider, MatchmakerFilters } from "./types";

export type { LLMProvider, MatchmakerFilters } from "./types";

class NoopProvider implements LLMProvider {
  readonly name = "noop";
  async parseMatchmakerQuery(): Promise<MatchmakerFilters> {
    return {};
  }
}

let cachedProvider: LLMProvider | null = null;

export function getLLMProvider(): LLMProvider {
  if (cachedProvider) return cachedProvider;

  const choice = (process.env.LLM_PROVIDER || "gemini").toLowerCase();
  const geminiKey =
    process.env.GEMINI_API_KEY ||
    process.env.GEMINI_API_KEY_1 ||
    process.env.GEMINI_API_KEY_2 ||
    process.env.GEMINI_API_KEY_3 ||
    "";

  if (choice === "gemini" && geminiKey) {
    cachedProvider = new GeminiMatchmakerProvider(geminiKey);
    return cachedProvider;
  }

  logger(`[MATCHMAKER] LLM provider unavailable (LLM_PROVIDER=${choice}); falling back to noop parser`);
  cachedProvider = new NoopProvider();
  return cachedProvider;
}
