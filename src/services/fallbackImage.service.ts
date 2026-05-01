import { GoogleGenAI } from "@google/genai";
import * as path from "path";
import { logger } from "../utils/logger";
import {
  FALLBACK_BACKUP_MODEL,
  FALLBACK_MAX_RETRIES,
  FALLBACK_PRIMARY_MODEL,
  FALLBACK_TEMPERATURE,
  FALLBACK_VARIANT_COUNT,
} from "../config/fallback.config";

const FALLBACK_OPERATION_TIMEOUT_MS = Number(process.env.FALLBACK_OPERATION_TIMEOUT_MS || "15000");

type VariantReadyPayload = {
  index: number;
  variantId: string;
  style: string;
  modelSlug: string;
  buffer: Buffer;
};

type TraceHook = (step: string, details?: Record<string, unknown>) => Promise<void> | void;
type VariantReadyHook = (details: VariantReadyPayload) => Promise<void> | void;

class FallbackImageService {
  private client: GoogleGenAI;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY || "";
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set in environment variables");
    }
    this.client = new GoogleGenAI({ apiKey });
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | null = null;

    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".heic": "image/heic",
      ".jfif": "image/jfif",
    };
    return mimeTypes[ext] || "image/png";
  }

  private extractFirstImageBuffer(response: any): Buffer | null {
    for (const candidate of response?.candidates || []) {
      for (const part of candidate?.content?.parts || []) {
        if (part?.inlineData?.data) {
          return Buffer.from(part.inlineData.data, "base64");
        }
      }
    }
    return null;
  }

  private buildVariantPrompt(
    roomType: string,
    baseStyle: string,
    variantNumber: number,
    totalVariants: number,
    userPrompt?: string
  ): string {
    const grounding =
      "Use the PROVIDED IMAGE as the only source scene. Preserve architecture, camera angle, walls, windows, doors, floor and lighting direction. Return one full-frame staged image only.";

    const variationInstruction =
      `Create variation ${variantNumber} of ${totalVariants}. Keep ${baseStyle} style direction but change furniture arrangement, decor accents, and color balance so each variant looks distinct.`;

    if (userPrompt && userPrompt.trim()) {
      return `${grounding}\n\n${userPrompt.trim()}\n\n${variationInstruction}`;
    }

    return `${grounding}\n\nStage this ${roomType} in ${baseStyle} style. ${variationInstruction}`;
  }

  private async generateSingleVariant(
    baseImageBuffer: Buffer,
    mimeType: string,
    prompt: string,
    model: string
  ): Promise<Buffer | null> {
    for (let attempt = 1; attempt <= FALLBACK_MAX_RETRIES; attempt++) {
      try {
        const timedResponse = await this.withTimeout(
          this.client.models.generateContent({
            model,
            contents: [
              {
                role: "user",
                parts: [
                  {
                    inlineData: {
                      mimeType,
                      data: baseImageBuffer.toString("base64"),
                    },
                  },
                  {
                    text: prompt,
                  },
                ],
              },
            ],
            config: {
              responseModalities: ["IMAGE"],
              temperature: FALLBACK_TEMPERATURE,
            },
          } as any),
          FALLBACK_OPERATION_TIMEOUT_MS,
          `fallback ${model} image generation`
        );

        const extracted = this.extractFirstImageBuffer(timedResponse);
        if (extracted) {
          return extracted;
        }
      } catch (error) {
        if (attempt === FALLBACK_MAX_RETRIES) {
          throw error;
        }
      }
    }

    return null;
  }

  async generateStyledVariants(
    inputImagePath: string,
    baseImageBuffer: Buffer,
    roomType: string,
    baseStyle: string,
    userPrompt?: string,
    traceHook?: TraceHook,
    onVariantReady?: VariantReadyHook,
    options?: {
      maxDurationMs?: number;
    }
  ): Promise<Buffer[]> {
    const variantCount = Math.max(1, FALLBACK_VARIANT_COUNT);
    const mimeType = this.getMimeType(inputImagePath);
    const results: Buffer[] = [];
    const startedAt = Date.now();
    const maxDurationMs = options?.maxDurationMs;

    await traceHook?.("phase2.fallback.start", {
      model: FALLBACK_PRIMARY_MODEL,
      backupModel: FALLBACK_BACKUP_MODEL,
      variantCount,
    });

    for (let index = 0; index < variantCount; index++) {
      if (maxDurationMs && Date.now() - startedAt >= maxDurationMs) {
        await traceHook?.("phase2.fallback.timeout_budget_reached", {
          generated: results.length,
          requested: variantCount,
          maxDurationMs,
        });
        break;
      }

      const variantNumber = index + 1;
      const variantId = `variant-${variantNumber}-${Date.now()}`;
      const prompt = this.buildVariantPrompt(roomType, baseStyle, variantNumber, variantCount, userPrompt);

      try {
        const buffer =
          (await this.generateSingleVariant(baseImageBuffer, mimeType, prompt, FALLBACK_PRIMARY_MODEL)) ||
          (FALLBACK_BACKUP_MODEL !== FALLBACK_PRIMARY_MODEL
            ? await this.generateSingleVariant(baseImageBuffer, mimeType, prompt, FALLBACK_BACKUP_MODEL)
            : null);

        if (!buffer) {
          await traceHook?.("phase2.fallback.variant.missing", {
            index: variantNumber,
            variantId,
          });
          continue;
        }

        results.push(buffer);

        await traceHook?.("phase2.fallback.variant.success", {
          index: variantNumber,
          variantId,
          bytes: buffer.length,
          model: FALLBACK_PRIMARY_MODEL,
        });

        await onVariantReady?.({
          index,
          variantId,
          style: baseStyle,
          modelSlug: "GEMINI_2_5_FLASH_IMAGE",
          buffer,
        });
      } catch (error) {
        logger(`[FALLBACK] Variant ${variantNumber} failed: ${String(error)}`);
        await traceHook?.("phase2.fallback.variant.error", {
          index: variantNumber,
          variantId,
          error: String(error),
        });
      }
    }

    await traceHook?.("phase2.fallback.complete", {
      generated: results.length,
      requested: variantCount,
    });

    return results;
  }
}

export const fallbackImageService = new FallbackImageService();
