import { logger } from "../utils/logger";
import { RateLimiter } from "../utils/rateLimiter";
import { geminiService } from "./gemini.service";
import {
  FALLBACK_MODEL,
  FALLBACK_API_KEY,
  FALLBACK_RATE_LIMIT,
  FALLBACK_VARIANT_CONCURRENCY,
  FALLBACK_VARIANT_COUNT,
  FALLBACK_MAX_PARALLEL_REQUESTS,
  FALLBACK_PRIMARY_MODEL,
  FALLBACK_BACKUP_MODEL,
  FALLBACK_VARIANT_MAX_INPUT_EDGE,
  FALLBACK_VARIANT_JPEG_QUALITY,
  FALLBACK_VARIANT_TEMPERATURE,
  GEMINI_VARIANT_MAX_RETRIES,
  GEMINI_VARIANT_STYLE_FAMILY,
} from "../config/fallback.config";

type TraceHook = (step: string, details?: Record<string, unknown>) => Promise<void> | void;

type VariantReadyHook = (details: {
  index: number;
  variantId: string;
  style: string;
  modelSlug: string;
  buffer: Buffer;
}) => Promise<void> | void;

const fallbackRateLimiter = new RateLimiter(FALLBACK_RATE_LIMIT, 60000);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeStyle(baseStyle: string): string {
  return String(baseStyle || "modern").trim().toLowerCase();
}

function getStyleVariations(baseStyle: string): string[] {
  const styleMap: Record<string, string[]> = {
    modern: ["modern", "contemporary"],
    minimalist: ["minimalist", "modern"],
    scandinavian: ["scandinavian", "minimalist"],
    industrial: ["industrial", "modern"],
    traditional: ["traditional", "transitional"],
    contemporary: ["contemporary", "modern"],
    luxury: ["luxury", "contemporary"],
    farmhouse: ["farmhouse", "rustic"],
    coastal: ["coastal", "scandinavian"],
    bohemian: ["bohemian", "eclectic"],
    "mid-century": ["mid-century", "modern"],
    transitional: ["transitional", "modern"],
    rustic: ["rustic", "farmhouse"],
    eclectic: ["eclectic", "contemporary"],
    zen: ["zen", "minimalist"],
  };

  return styleMap[normalizeStyle(baseStyle)] || [normalizeStyle(baseStyle), "contemporary"];
}

function buildGeminiFallbackPrompt(roomType: string, style: string, userPrompt?: string): string {
  const hardcodedPrompt = [
    "Use the provided Gemini-staged image as the exact visual reference.",
    "Preserve the same room architecture, layout, camera angle, lens feel, lighting direction, wall color, ceiling details, window and door positions, and floor pattern.",
    "Keep the staged room looking like the same space, not a new or contradictory design.",
    "Make subtle but clearly visible styling improvements using furniture, decor, textiles, and accessories that match the reference image.",
    `Room type: ${roomType}.`,
    `Staging style: ${style}.`,
    `Style family: ${GEMINI_VARIANT_STYLE_FAMILY}.`,
    userPrompt ? `User prompt: ${userPrompt}` : "",
    "If the user prompt conflicts with the reference structure, keep the reference structure and apply only compatible changes.",
    "Return one photorealistic image that stays close to the Gemini reference image.",
  ].filter(Boolean).join(" ");

  return hardcodedPrompt.slice(0, 1200);
}

logger(
  `[FALLBACK] Service initialized | provider=${FALLBACK_MODEL} | primary=${FALLBACK_PRIMARY_MODEL} | backup=${FALLBACK_BACKUP_MODEL} | concurrency=${FALLBACK_VARIANT_CONCURRENCY} | apiKeyPresent=${!!FALLBACK_API_KEY}`
);

class FallbackImageService {
  constructor() {
    if (!FALLBACK_API_KEY) {
      logger(`[FALLBACK] Warning: GEMINI_API_KEY not set, fallback variants will not be generated`);
    }
  }

  async generateStyledVariants(
    inputImagePath: string,
    baseImageBuffer: Buffer,
    roomType: string,
    baseStyle: string,
    userPrompt?: string,
    traceHook?: TraceHook,
    onVariantReady?: VariantReadyHook
  ): Promise<Buffer[]> {
    if (!FALLBACK_API_KEY) {
      logger(`[FALLBACK] WARN: No API key configured, skipping variant generation`);
      return [];
    }

    const startTime = Date.now();
    logger(
      `[FALLBACK] START generateStyledVariants | provider=${FALLBACK_MODEL} | primary=${FALLBACK_PRIMARY_MODEL} | backup=${FALLBACK_BACKUP_MODEL} | roomType=${roomType} | baseStyle=${baseStyle} | baseImageBytes=${baseImageBuffer.length}`
    );
    await traceHook?.("fallback.generateStyledVariants.start", {
      provider: FALLBACK_MODEL,
      roomType,
      baseStyle,
      variantCount: FALLBACK_VARIANT_COUNT,
      variantConcurrency: FALLBACK_VARIANT_CONCURRENCY,
      inputImagePath,
      baseImageBytes: baseImageBuffer.length,
    });

    const styleVariations = getStyleVariations(baseStyle).slice(0, FALLBACK_VARIANT_COUNT);
    const variants: Buffer[] = new Array(styleVariations.length);
    let nextIndex = 0;
    const workerCount = Math.min(FALLBACK_VARIANT_CONCURRENCY, FALLBACK_MAX_PARALLEL_REQUESTS, styleVariations.length);

    await traceHook?.("fallback.generateStyledVariants.workers", {
      configuredConcurrency: FALLBACK_VARIANT_CONCURRENCY,
      maxParallelRequests: FALLBACK_MAX_PARALLEL_REQUESTS,
      workerCount,
    });

    const workers = Array.from({ length: workerCount }, async () => {
      while (true) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        if (currentIndex >= styleVariations.length) {
          return;
        }

        const style = styleVariations[currentIndex];
        const variantId = `v${currentIndex + 1}`;

        try {
          const limiterDelayMs = await fallbackRateLimiter.acquire(`variant-${variantId}`);
          await traceHook?.("fallback.variant.attempt", {
            variantId,
            attempt: 1,
            limiterDelayMs,
            maxAttempts: GEMINI_VARIANT_MAX_RETRIES,
          });

          if (limiterDelayMs > 0) {
            await delay(limiterDelayMs);
          }

          const prompt = buildGeminiFallbackPrompt(roomType, style, userPrompt);
          const variantBuffer = await geminiService.stageImageWithModel(
            inputImagePath,
            roomType,
            style,
            prompt,
            FALLBACK_BACKUP_MODEL,
            {
              maxInputEdge: FALLBACK_VARIANT_MAX_INPUT_EDGE,
              jpegQuality: FALLBACK_VARIANT_JPEG_QUALITY,
              temperature: FALLBACK_VARIANT_TEMPERATURE,
              maxAttempts: GEMINI_VARIANT_MAX_RETRIES,
              promptMode: "variant",
              requestLabel: `fallback.variant.${variantId}`,
            }
          );

          variants[currentIndex] = variantBuffer;
          await onVariantReady?.({
            index: currentIndex,
            variantId,
            style,
            modelSlug: FALLBACK_BACKUP_MODEL,
            buffer: variantBuffer,
          });

          await traceHook?.("fallback.variant.success", {
            variantId,
            modelSlug: FALLBACK_BACKUP_MODEL,
            style,
            bytes: variantBuffer.length,
          });
        } catch (error) {
          logger(`[FALLBACK] VARIANT_${variantId}_SKIPPED | error=${String(error)}`);
          await traceHook?.("fallback.variant.skipped", {
            variantIndex: currentIndex,
            style,
            error: String(error),
          });
        }
      }
    });

    await Promise.all(workers);

    const completedVariants = variants.filter((variant): variant is Buffer => !!variant && variant.length > 0);
    const duration = Date.now() - startTime;
    logger(`[FALLBACK] COMPLETE generateStyledVariants | total=${completedVariants.length}/${styleVariations.length} | durationMs=${duration}`);
    await traceHook?.("fallback.generateStyledVariants.complete", {
      totalGenerated: completedVariants.length,
      targetVariants: styleVariations.length,
      durationMs: duration,
    });
    return completedVariants;
  }
}

export const fallbackImageService = new FallbackImageService();
