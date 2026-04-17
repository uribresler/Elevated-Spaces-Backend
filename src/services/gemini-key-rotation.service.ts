import prisma from "../dbConnection";
import { logger } from "../utils/logger";

type GeminiKeyConfig = {
  keyName: string;
  keyValue: string;
  order: number;
};

const QUOTA_COOLDOWN_MS = Number(process.env.GEMINI_QUOTA_COOLDOWN_MS || "86400000");

class GeminiKeyRotationService {
  private readonly keyConfigs: GeminiKeyConfig[];

  constructor() {
    const configuredKeys: GeminiKeyConfig[] = [
      { keyName: "GEMINI_API_KEY_1", keyValue: process.env.GEMINI_API_KEY_1 || "", order: 1 },
      { keyName: "GEMINI_API_KEY_2", keyValue: process.env.GEMINI_API_KEY_2 || "", order: 2 },
      { keyName: "GEMINI_API_KEY_3", keyValue: process.env.GEMINI_API_KEY_3 || "", order: 3 },
      { keyName: "GEMINI_API_KEY", keyValue: process.env.GEMINI_API_KEY || "", order: 99 },
    ].filter((entry) => entry.keyValue.trim().length > 0);

    const dedupedByValue = new Map<string, GeminiKeyConfig>();
    for (const entry of configuredKeys.sort((a, b) => a.order - b.order)) {
      if (!dedupedByValue.has(entry.keyValue)) {
        dedupedByValue.set(entry.keyValue, entry);
      }
    }

    this.keyConfigs = Array.from(dedupedByValue.values()).sort((a, b) => a.order - b.order);

    if (this.keyConfigs.length === 0) {
      throw new Error("No Gemini API keys configured. Set GEMINI_API_KEY_1 (and optionally _2/_3) in environment variables.");
    }
  }

  private async ensureRows(): Promise<void> {
    await Promise.all(
      this.keyConfigs.map((entry) =>
        prisma.gemini_api_key_state.upsert({
          where: { key_name: entry.keyName },
          update: {},
          create: { key_name: entry.keyName },
        })
      )
    );
  }

  async getAvailableKeys(): Promise<GeminiKeyConfig[]> {
    await this.ensureRows();

    const now = new Date();
    const states = await prisma.gemini_api_key_state.findMany({
      where: { key_name: { in: this.keyConfigs.map((entry) => entry.keyName) } },
    });

    const stateByName = new Map(states.map((state) => [state.key_name, state]));

    return this.keyConfigs.filter((entry) => {
      const state = stateByName.get(entry.keyName);
      if (!state?.blocked_until) return true;
      return state.blocked_until.getTime() <= now.getTime();
    });
  }

  async getNextAvailableAt(): Promise<Date | null> {
    await this.ensureRows();

    const states = await prisma.gemini_api_key_state.findMany({
      where: { key_name: { in: this.keyConfigs.map((entry) => entry.keyName) } },
      orderBy: { blocked_until: "asc" },
    });

    const future = states.find((state) => state.blocked_until && state.blocked_until.getTime() > Date.now());
    return future?.blocked_until || null;
  }

  async markQuotaExceeded(keyName: string): Promise<void> {
    const now = new Date();
    const blockedUntil = new Date(now.getTime() + QUOTA_COOLDOWN_MS);

    await prisma.gemini_api_key_state.upsert({
      where: { key_name: keyName },
      update: {
        last_quota_exceeded_at: now,
        blocked_until: blockedUntil,
      },
      create: {
        key_name: keyName,
        last_quota_exceeded_at: now,
        blocked_until: blockedUntil,
      },
    });

    logger(`[GEMINI_KEYS] ${keyName} marked quota exhausted until ${blockedUntil.toISOString()}`);
  }
}

export const geminiKeyRotationService = new GeminiKeyRotationService();
export type { GeminiKeyConfig };
