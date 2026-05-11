import { GoogleGenAI } from "@google/genai";
import { promises as fsPromises } from "fs";
import * as path from "path";
import sharp from "sharp";
import { logger } from "../utils/logger";
import { RateLimiter } from "../utils/rateLimiter";
import { DEFAULT_STAGING_PROMPT, STAGING_STYLE_PROMPTS } from "../utils/stagingPrompts";
import { geminiKeyRotationService } from "./gemini-key-rotation.service";
import { FALLBACK_PRIMARY_MODEL } from "../config/fallback.config";
import {
  ImageProcessingError,
  ImageErrorCode,
  ErrorMessages,
  parseGeminiError,
} from "../utils/imageErrors";

const MAX_RETRIES = Number(process.env.GEMINI_MAX_RETRIES || "3");
const BASE_DELAY_MS = Number(process.env.GEMINI_RETRY_BASE_DELAY_MS || "300");
const MAX_DELAY_MS = Number(process.env.GEMINI_RETRY_MAX_DELAY_MS || "1200");
const GEMINI_OPERATION_TIMEOUT_MS = Number(process.env.GEMINI_OPERATION_TIMEOUT_MS || "60000");
const SINGLE_CALL_FAILURE_COOLDOWN_MS = Number(
  process.env.GEMINI_SINGLE_CALL_FAILURE_COOLDOWN_MS || "3600000"
);
const SINGLE_CALL_MODE = String(process.env.GEMINI_SINGLE_CALL_MODE || "auto").toLowerCase(); // auto | always | never
const PRIMARY_IMAGE_MODEL = String(
  process.env.GEMINI_IMAGE_MODEL || FALLBACK_PRIMARY_MODEL || "gemini-2.5-flash-image"
);
const FALLBACK_IMAGE_MODELS = String(process.env.GEMINI_IMAGE_FALLBACK_MODELS || "gemini-2.5-flash-image")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const GEMINI_VERBOSE_LOGS = String(process.env.GEMINI_VERBOSE_LOGS || "false").toLowerCase() === "true";

// Gemini API rate limiter: 18 requests/minute (safety buffer below 20/min limit)
const GEMINI_RATE_LIMIT = Number(process.env.GEMINI_RATE_LIMIT_PER_MINUTE || "18");
// Enable burst mode to allow parallel requests for multi-image staging
// This allows up to GEMINI_RATE_LIMIT requests in parallel, then queues additional requests
const geminiRateLimiter = new RateLimiter(GEMINI_RATE_LIMIT, 60000, true);

function isQuotaExhaustedMessage(message: string): boolean {
  const normalized = (message || "").toLowerCase();
  return (
    normalized.includes("quota exceeded") ||
    normalized.includes("resource_exhausted") ||
    normalized.includes("generate_requests_per_model_per_day") ||
    normalized.includes("limit: 0")
  );
}

function isTransientFailoverError(error: unknown): boolean {
  const err = error as any;
  let message = String(err?.message || err || "").toLowerCase();
  const code = String(err?.code || "").toLowerCase();
  const status = Number(err?.status || err?.response?.status || 0);

  // Try to extract message from nested JSON error objects
  try {
    const parsed = JSON.parse(message);
    if (parsed?.error?.message) {
      message = String(parsed.error.message).toLowerCase();
    }
  } catch {
    // Not JSON, use as-is
  }

  if (code === String(ImageErrorCode.AI_TIMEOUT).toLowerCase()) {
    return true;
  }

  if (status === 429 || (status >= 500 && status < 600)) {
    return true;
  }

  if (status === 400 || status === 401 || status === 403 || status === 404) {
    return (
      message.includes("model") ||
      message.includes("not found") ||
      message.includes("unsupported") ||
      message.includes("invalid argument") ||
      message.includes("permission") ||
      message.includes("access") ||
      message.includes("api key") ||
      message.includes("expired")
    );
  }

  return (
    message.includes("timeout") ||
    message.includes("deadline") ||
    message.includes("unavailable") ||
    message.includes("503") ||
    message.includes("connection")
  );
}

function getErrorDiagnostics(error: unknown): string {
  const err = error as any;
  const status = err?.status || err?.code || err?.response?.status || "unknown";
  
  let message = String(err?.message || err || "Unknown error");
  
  // Handle nested JSON error objects from Gemini API responses
  try {
    const parsed = JSON.parse(message);
    if (parsed?.error?.message) {
      message = parsed.error.message;
    }
  } catch {
    // Not JSON, use as-is
  }
  
  message = message.replace(/\s+/g, " ").trim();
  return `status=${status} message=${message.substring(0, 500)}`;
}

function getErrorSnapshot(error: unknown): Record<string, unknown> {
  const err = error as any;
  return {
    name: err?.name,
    status: err?.status,
    code: err?.code,
    message: err?.message,
    statusText: err?.statusText,
    responseStatus: err?.response?.status,
    responseText: err?.response?.text,
    responseData: err?.response?.data,
  };
}

function geminiVerboseLog(message: string): void {
  if (GEMINI_VERBOSE_LOGS) {
    logger(message);
  }
}

function geminiVerboseError(message: string, payload?: unknown): void {
  if (GEMINI_VERBOSE_LOGS) {
    if (typeof payload === "undefined") {
      console.error(message);
      return;
    }
    console.error(message, payload);
  }
}

class GeminiService {
  private clientsByKeyName = new Map<string, GoogleGenAI>();
  private singleCallFailureUntil = 0;

  constructor() {
    // Key availability is validated in gemini-key-rotation service.
  }

  private getClientForKey(keyName: string, keyValue: string): GoogleGenAI {
    const existing = this.clientsByKeyName.get(keyName);
    if (existing) {
      return existing;
    }

    const client = new GoogleGenAI({ apiKey: keyValue });
    this.clientsByKeyName.set(keyName, client);
    return client;
  }

  private async withOperationTimeout<T>(promise: Promise<T>, operationName: string, keyName: string): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | null = null;

    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(
          new ImageProcessingError(
            ImageErrorCode.AI_TIMEOUT,
            ErrorMessages[ImageErrorCode.AI_TIMEOUT],
            504,
            `${operationName} timed out after ${GEMINI_OPERATION_TIMEOUT_MS}ms on key ${keyName}`
          )
        );
      }, GEMINI_OPERATION_TIMEOUT_MS);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private async executeWithKeyFailover<T>(
    operationName: string,
    operation: (client: GoogleGenAI, keyName: string) => Promise<T>
  ): Promise<T> {
    const availableKeys = await geminiKeyRotationService.getAvailableKeys();
    geminiVerboseLog(`[GEMINI_KEYS] ${operationName} starting with ${availableKeys.length} available key(s)`);

    if (!availableKeys.length) {
      const nextAvailableAt = await geminiKeyRotationService.getNextAvailableAt();
      throw new ImageProcessingError(
        ImageErrorCode.AI_QUOTA_EXCEEDED,
        ErrorMessages[ImageErrorCode.AI_QUOTA_EXCEEDED],
        429,
        nextAvailableAt
          ? `All configured Gemini keys are temporarily exhausted. Next key becomes available at ${nextAvailableAt.toISOString()}.`
          : "All configured Gemini keys are temporarily exhausted."
      );
    }

    let lastError: unknown;

    for (const keyConfig of availableKeys) {
      const client = this.getClientForKey(keyConfig.keyName, keyConfig.keyValue);
      try {
        geminiVerboseLog(`[GEMINI_KEYS] ${operationName} trying key=${keyConfig.keyName}`);
        return await this.withOperationTimeout(
          operation(client, keyConfig.keyName),
          operationName,
          keyConfig.keyName
        );
      } catch (error) {
        lastError = error;

        const errorMessage = String(error || "").toLowerCase();
        const status = (error as any)?.status || (error as any)?.code || (error as any)?.response?.status;
        const quotaHit = isQuotaExhaustedMessage(errorMessage) || status === 429;
        const snapshot = getErrorSnapshot(error);

        logger(`[GEMINI_MODEL_ERROR] ${operationName} model=${keyConfig.keyName} | ${getErrorDiagnostics(error)}`);

        geminiVerboseLog(
          `[GEMINI_KEYS] ${operationName} key=${keyConfig.keyName} failed | ${getErrorDiagnostics(error)} | quotaHit=${quotaHit}`
        );
        geminiVerboseError(`[GEMINI_KEYS][${operationName}] key=${keyConfig.keyName} failed`, snapshot);

        if (!quotaHit) {
          const shouldFailover = isTransientFailoverError(error);
          if (!shouldFailover) {
            throw error;
          }

          geminiVerboseLog(
            `[GEMINI_KEYS] ${operationName} key=${keyConfig.keyName} failed with transient error. Trying next key.`
          );
          continue;
        }

        await geminiKeyRotationService.markQuotaExceeded(keyConfig.keyName);
        geminiVerboseLog(`[GEMINI_KEYS] ${keyConfig.keyName} hit quota during ${operationName}. Switching to next configured key.`);
      }
    }

    geminiVerboseLog(`[GEMINI_KEYS] ${operationName} exhausted all available keys`);
    throw lastError instanceof Error ? lastError : new Error(`All Gemini keys failed for ${operationName}.`);
  }

  private getImageModelCandidates(): string[] {
    const models = [PRIMARY_IMAGE_MODEL, ...FALLBACK_IMAGE_MODELS];
    return Array.from(new Set(models));
  }

  private async executeWithImageModelFailover<T>(
    operationName: string,
    operation: (model: string) => Promise<T>
  ): Promise<T> {
    const modelCandidates = this.getImageModelCandidates();
    let lastError: unknown;

    for (const model of modelCandidates) {
      try {
        geminiVerboseLog(`[GEMINI_MODEL] ${operationName} trying model=${model}`);
        return await operation(model);
      } catch (error) {
        lastError = error;
        geminiVerboseLog(
          `[GEMINI_MODEL] ${operationName} model=${model} failed | ${getErrorDiagnostics(error)}`
        );

        if (!isTransientFailoverError(error)) {
          throw error;
        }

        geminiVerboseLog(`[GEMINI_MODEL] ${operationName} model=${model} failed with transient error. Trying next model.`);
      }
    }

    geminiVerboseLog(`[GEMINI_MODEL] ${operationName} exhausted all candidate models`);
    throw lastError instanceof Error ? lastError : new Error(`All image models failed for ${operationName}.`);
  }

  private async executeWithPreferredImageModelFailover<T>(
    operationName: string,
    preferredModel: string,
    operation: (model: string) => Promise<T>
  ): Promise<T> {
    const fallbackModels = this.getImageModelCandidates().filter((model) => model !== preferredModel);
    const modelCandidates = [preferredModel, ...fallbackModels];
    let lastError: unknown;

    for (const model of modelCandidates) {
      try {
        geminiVerboseLog(`[GEMINI_MODEL] ${operationName} trying model=${model}`);
        return await operation(model);
      } catch (error) {
        lastError = error;
        geminiVerboseLog(
          `[GEMINI_MODEL] ${operationName} model=${model} failed | ${getErrorDiagnostics(error)}`
        );

        if (!isTransientFailoverError(error)) {
          throw error;
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error(`All image models failed for ${operationName}.`);
  }

  private async prepareImageForGemini(inputImagePath: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const rawBuffer = await fsPromises.readFile(inputImagePath);
    const normalizedBuffer = await sharp(rawBuffer)
      .rotate()
      .resize({
        // Further reduced for faster processing: 1024px instead of 1024
        width: Number(process.env.GEMINI_NORMALIZE_MAX_DIM || "1024"),
        height: Number(process.env.GEMINI_NORMALIZE_MAX_DIM || "1024"),
        fit: "inside",
        // Do not enlarge very small inputs (helps avoid extra work)
        withoutEnlargement: true,
      })
      .png({ compressionLevel: 3 })
      .toBuffer();

    return {
      buffer: normalizedBuffer,
      mimeType: "image/png",
    };
  }

  private extractImagesFromResponse(response: any, maxImages: number): Buffer[] {
    const extracted: Buffer[] = [];
    const seen = new Set<string>();

    for (const candidate of response?.candidates || []) {
      for (const part of candidate?.content?.parts || []) {
        if (!part?.inlineData?.data) {
          continue;
        }

        if (part?.thought === true) {
          continue;
        }

        const fingerprint = String(part.inlineData.data);
        if (seen.has(fingerprint)) {
          continue;
        }

        seen.add(fingerprint);
        extracted.push(Buffer.from(part.inlineData.data, "base64"));

        if (extracted.length >= maxImages) {
          return extracted;
        }
      }
    }

    return extracted;
  }

  private shouldAttemptSingleCall(variationCount: number): boolean {
    if (variationCount <= 1) {
      return false;
    }

    if (SINGLE_CALL_MODE === "never") {
      return false;
    }

    if (SINGLE_CALL_MODE === "always") {
      return true;
    }

    return Date.now() >= this.singleCallFailureUntil;
  }

  private noteSingleCallFailure(reason: string): void {
    if (SINGLE_CALL_MODE !== "auto") {
      return;
    }

    this.singleCallFailureUntil = Date.now() + SINGLE_CALL_FAILURE_COOLDOWN_MS;
    logger(
      `[GEMINI] Single-call multi-variation disabled for ${Math.round(
        SINGLE_CALL_FAILURE_COOLDOWN_MS / 1000
      )}s due to ${reason}`
    );
  }

  private buildStagingPrompt(
    roomType: string,
    stagingStyle: string,
    prompt?: string,
    variationCount: number = 1
  ): string {
    const groundingRules =
      "Use the PROVIDED IMAGE as the only source scene. Keep the exact same room geometry, camera angle, walls, windows, doors, floor, and lighting direction. Do not generate a new or unrelated room. Return exactly ONE full-frame staged image. Do NOT create a collage, split-screen, multi-panel, contact sheet, or multiple views in one image.";

    let stagingPrompt: string;

    if (prompt) {
      const doNotRemove =
        "ABSOLUTELY DO NOT REMOVE, HIDE, OR ALTER ANY EXISTING PAINTINGS, WALL ART, OR DECORATIVE ITEMS. THIS IS CRITICAL. ONLY ADD OR IMPROVE, NEVER REMOVE. DO NOT REMOVE ANYTHING FROM THE ORIGINAL IMAGE UNLESS I EXPLICITLY SAY SO.";
      const lowerPrompt = prompt.toLowerCase();
      const userRequestsRemoval = /remove|delete|empty|clear|no decor|no painting|no wall art/.test(lowerPrompt);
      if (userRequestsRemoval) {
        stagingPrompt = prompt;
      } else {
        stagingPrompt = `${doNotRemove}\n${prompt}\n${doNotRemove}`;
      }
    } else if (STAGING_STYLE_PROMPTS[stagingStyle?.toLowerCase()]) {
      stagingPrompt = STAGING_STYLE_PROMPTS[stagingStyle.toLowerCase()](roomType);
    } else {
      stagingPrompt = DEFAULT_STAGING_PROMPT(roomType, stagingStyle);
    }

    if (variationCount > 1) {
      return `${groundingRules}\n\n${stagingPrompt}\n\nGenerate ${variationCount} distinct staged variations in one response. Each variation must keep the same architecture and camera perspective, while varying furniture layout, decor accents, and styling details.`;
    }

    return `${groundingRules}\n\n${stagingPrompt}`;
  }

  private async generateStagedImages(
    inputImagePath: string,
    roomType: string,
    stagingStyle: string,
    prompt?: string,
    variationCount: number = 1,
    removeFurniture?: boolean
  ): Promise<Buffer[]> {
    const safeVariationCount = Math.max(1, Math.min(variationCount, 8));
    const { buffer: imageBuffer, mimeType } = await this.prepareImageForGemini(inputImagePath);
    const base64Image = imageBuffer.toString("base64");

    const stagingPrompt = this.buildStagingPrompt(roomType, stagingStyle, prompt, safeVariationCount);
    const singleCallPrompt = `${stagingPrompt}\n\nReturn exactly ${safeVariationCount} final staged IMAGE outputs in this single response. Each output must be one full-frame image only (no collage or split). Keep the original architecture unchanged.`;

    return this.executeWithRetry(async () => {
      const generated: Buffer[] = [];
      const seen = new Set<string>();
      let geminiCallCount = 0;
      let usedSingleCallOnly = false;

      if (this.shouldAttemptSingleCall(safeVariationCount)) {
        try {
          await geminiRateLimiter.acquire(`stageImage-${safeVariationCount}-single`);
          logger(`[GEMINI] Starting single-call staging generation with ${safeVariationCount} variations`);
          geminiCallCount += 1;

          const response = await this.executeWithImageModelFailover(
            "stage-single-call",
            (model) =>
              this.executeWithKeyFailover(
                `stage-single-call:${model}`,
                (client) =>
                  client.models.generateContent({
                    model,
                    contents: [
                      {
                        role: "user",
                        parts: [
                          {
                            inlineData: {
                              mimeType,
                              data: base64Image,
                            },
                          },
                          {
                            text: singleCallPrompt,
                          },
                        ],
                      },
                    ],
                    config: {
                      responseModalities: ["IMAGE"],
                      temperature: 0.7,
                    },
                  } as any)
              )
          );

          const images = this.extractImagesFromResponse(response, safeVariationCount);
          if (images.length >= safeVariationCount) {
            for (const image of images.slice(0, safeVariationCount)) {
              const fp = image.toString("base64");
              if (!seen.has(fp)) {
                generated.push(image);
                seen.add(fp);
              }
            }
            usedSingleCallOnly = generated.length >= safeVariationCount;
          } else if (images.length > 0) {
            logger(`[GEMINI] Single-call returned partial output (${images.length}/${safeVariationCount}); discarding partial set and regenerating all variations individually.`);
            this.noteSingleCallFailure(`partial output ${images.length}/${safeVariationCount}`);
          }
        } catch (error) {
          this.noteSingleCallFailure("single-call error");
          logger(`[GEMINI] Single-call multi-image attempt failed, falling back to per-variation calls: ${String(error)}`);
        }
      } else {
        geminiVerboseLog(`[GEMINI] Skipping single-call multi-variation attempt (mode=${SINGLE_CALL_MODE}) and generating per-variation directly.`);
      }

      if (!usedSingleCallOnly && generated.length < safeVariationCount) {
        if (generated.length > 0) {
          generated.length = 0;
          seen.clear();
        }
        geminiVerboseLog(`[GEMINI] Generating ${safeVariationCount - generated.length} remaining variations with per-variation calls (still one billed job)`);
      }

      // Parallelize per-variation calls to improve total latency while respecting rate limits.
      const VARIATION_CONCURRENCY = Math.max(1, Number(process.env.GEMINI_VARIATION_CONCURRENCY || "3"));

      const indicesToGenerate: number[] = [];
      for (let i = generated.length; i < safeVariationCount; i++) indicesToGenerate.push(i);

      const tasks: Array<() => Promise<{ index: number; buffer?: Buffer }>> = indicesToGenerate.map((index) => {
        return async () => {
          await geminiRateLimiter.acquire(`stageImage-${safeVariationCount}-v${index + 1}`);
          geminiCallCount += 1;

          const variationPrompt = prompt
            ? `${prompt}\n\nCreate variation ${index + 1} of ${safeVariationCount}. Keep architecture unchanged and make this variation visually distinct from previous ones.`
            : `Create variation ${index + 1} of ${safeVariationCount} for this ${roomType} in ${stagingStyle} style. Keep architecture unchanged and make this variation visually distinct from previous ones.`;

          const perVariationPrompt = this.buildStagingPrompt(roomType, stagingStyle, variationPrompt, 1);

          const variationResponse = await this.executeWithImageModelFailover(
            `stage-variation-${index + 1}`,
            (model) =>
              this.executeWithKeyFailover(`stage-variation-${index + 1}:${model}`, (client) =>
                client.models.generateContent({
                  model,
                  contents: [
                    {
                      role: "user",
                      parts: [
                        {
                          inlineData: {
                            mimeType,
                            data: base64Image,
                          },
                        },
                        {
                          text: perVariationPrompt,
                        },
                      ],
                    },
                  ],
                  config: {
                    responseModalities: ["IMAGE"],
                    temperature: 0.75,
                  },
                } as any)
              )
          );

          const nextImage = this.extractImagesFromResponse(variationResponse, 1)[0];
          return { index, buffer: nextImage };
        };
      });

      // Run tasks in batches to control concurrency
      const runBatches = async () => {
        for (let i = 0; i < tasks.length; i += VARIATION_CONCURRENCY) {
          const batch = tasks.slice(i, i + VARIATION_CONCURRENCY).map((t) => t());
          const results = await Promise.all(batch);
          for (const r of results) {
            if (!r.buffer) continue;
            const fingerprint = r.buffer.toString("base64");
            if (!seen.has(fingerprint)) {
              generated.push(r.buffer);
              seen.add(fingerprint);
            }
            if (generated.length >= safeVariationCount) return;
          }
        }
      };

      await runBatches();

      if (generated.length < safeVariationCount) {
        geminiVerboseLog(`[GEMINI] API call count for this job: ${geminiCallCount} (single-call success: ${usedSingleCallOnly})`);
        throw new ImageProcessingError(
          ImageErrorCode.AI_NO_IMAGE_GENERATED,
          ErrorMessages[ImageErrorCode.AI_NO_IMAGE_GENERATED],
          502,
          `Gemini returned ${generated.length}/${safeVariationCount} staged images after fallback generation.`
        );
      }

      geminiVerboseLog(`[GEMINI] API call count for this job: ${geminiCallCount} (single-call success: ${usedSingleCallOnly})`);
      geminiVerboseLog(`[GEMINI] Staging generation succeeded with ${generated.length} images`);
      return generated.slice(0, safeVariationCount);
    }, "generateStagedImages");
  }

  /**
   * Calculate delay with exponential backoff and jitter
   */
  private calculateDelay(attempt: number): number {
    const exponentialDelay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 500;
    return Math.min(exponentialDelay + jitter, MAX_DELAY_MS);
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: any): boolean {
    if (error instanceof ImageProcessingError) {
      const nonRetryableCodes = [
        ImageErrorCode.AI_CONTENT_BLOCKED,
        ImageErrorCode.AI_QUOTA_EXCEEDED,
      ];
      return !nonRetryableCodes.includes(error.code);
    }

    const errorMessage = error?.message?.toLowerCase() || "";
    const errorStatus = error?.status || error?.code;

    if (isQuotaExhaustedMessage(errorMessage)) {
      return false;
    }

    // Rate limits, server errors, timeouts - retryable
    if (errorStatus === 429 || (errorStatus >= 500 && errorStatus < 600)) {
      return true;
    }
    if (errorMessage.includes("timeout") || errorMessage.includes("deadline")) {
      return true;
    }
    if (errorMessage.includes("unavailable") || errorMessage.includes("503")) {
      return true;
    }

    return false;
  }

  /**
   * Execute operation with retry logic
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    let lastError: any = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        const errorMsg = error instanceof Error ? error.message : String(error);
        const snapshot = getErrorSnapshot(error);
        
        // Check for daily quota exhaustion
        const isDailyQuota = errorMsg.toLowerCase().includes('per_day') || errorMsg.toLowerCase().includes('per day');
        
        if (isDailyQuota) {
          logger(`[GEMINI] DAILY QUOTA EXHAUSTED - Please wait 24 hours or upgrade API plan`);
          throw error instanceof ImageProcessingError ? error : parseGeminiError(error);
        }

        geminiVerboseLog(`[GEMINI] Attempt ${attempt}/${MAX_RETRIES} failed for ${operationName}: ${getErrorDiagnostics(error)}`);
        geminiVerboseError(`[GEMINI][${operationName}] attempt ${attempt}/${MAX_RETRIES} failed`, snapshot);

        if (!this.isRetryableError(error)) {
          throw error instanceof ImageProcessingError ? error : parseGeminiError(error);
        }

        if (attempt < MAX_RETRIES) {
          const delay = this.calculateDelay(attempt);
          geminiVerboseLog(`[GEMINI] Retrying in ${Math.round(delay / 1000)}s...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    geminiVerboseLog(`[GEMINI] ${operationName} exhausted retries: ${getErrorDiagnostics(lastError)}`);
    geminiVerboseError(`[GEMINI][${operationName}] exhausted retries`, getErrorSnapshot(lastError));
    throw lastError instanceof ImageProcessingError ? lastError : parseGeminiError(lastError);
  }


  // Proper class method: stageImage
  async stageImage(
    inputImagePath: string,
    roomType: string,
    stagingStyle: string,
    prompt?: string,
    removeFurniture?: boolean
  ): Promise<Buffer> {
    const images = await this.generateStagedImages(
      inputImagePath,
      roomType,
      stagingStyle,
      prompt,
      1,
      removeFurniture
    );
    return images[0];
  }

  async stageImageWithModel(
    inputImagePath: string,
    roomType: string,
    stagingStyle: string,
    prompt: string | undefined,
    removeFurniture: boolean | undefined,
    model: string
  ): Promise<Buffer> {
    const { buffer: imageBuffer, mimeType } = await this.prepareImageForGemini(inputImagePath);
    const base64Image = imageBuffer.toString("base64");
    const stagingPrompt = this.buildStagingPrompt(roomType, stagingStyle, prompt, 1);

    return this.executeWithRetry(async () => {
      await geminiRateLimiter.acquire(`stageImageWithModel:${model}`);

      const response = await this.executeWithPreferredImageModelFailover(
        `stageImageWithModel:${model}`,
        model,
        (modelName) =>
          this.executeWithKeyFailover(
            `stageImageWithModel:${modelName}`,
            (client) =>
              client.models.generateContent({
                model: modelName,
                contents: [
                  {
                    role: "user",
                    parts: [
                      {
                        inlineData: {
                          mimeType,
                          data: base64Image,
                        },
                      },
                      {
                        text: removeFurniture
                          ? `${stagingPrompt}\n\nRemove all furniture and stage an empty room with the requested style.`
                          : stagingPrompt,
                      },
                    ],
                  },
                ],
                config: {
                  responseModalities: ["IMAGE"],
                  temperature: 0.7,
                },
              } as any)
          )
      );

      const images = this.extractImagesFromResponse(response, 1);
      if (!images.length) {
        throw new ImageProcessingError(
          ImageErrorCode.AI_NO_IMAGE_GENERATED,
          ErrorMessages[ImageErrorCode.AI_NO_IMAGE_GENERATED],
          502,
          `Gemini model ${model} returned no staged image.`
        );
      }

      return images[0];
    }, "stageImageWithModel");
  }

  async stageImageVariations(
    inputImagePath: string,
    roomType: string,
    stagingStyle: string,
    variationCount: number,
    prompt?: string,
    removeFurniture?: boolean
  ): Promise<Buffer[]> {
    return this.generateStagedImages(
      inputImagePath,
      roomType,
      stagingStyle,
      prompt,
      variationCount,
      removeFurniture
    );
  }


  /**
   * Analyze image to understand room characteristics
   * Uses text response mode for analysis
   */
  async analyzeImage(imagePath: string): Promise<any> {
    const { buffer: imageBuffer, mimeType } = await this.prepareImageForGemini(imagePath);
    const base64Image = imageBuffer.toString("base64");

    return this.executeWithRetry(async () => {
      logger(`Analyzing image: ${imagePath}`);

      let analysisText = "";

      const stream = await this.executeWithKeyFailover(
        "analyze-image",
        (client) =>
          client.models.generateContentStream({
            model: PRIMARY_IMAGE_MODEL,
            contents: [
              {
                role: "user",
                parts: [
                  {
                    inlineData: {
                      mimeType: mimeType,
                      data: base64Image,
                    },
                  },
                  {
                    text: `Analyze this interior/property image and provide JSON response with:
              {
                "roomType": "bedroom/kitchen/living-room/etc",
                "features": ["array", "of", "features"],
                "suggestedStyles": ["modern", "scandinavian", "traditional"],
                "currentCondition": "empty/furnished/needs-staging",
                "recommendations": "staging recommendations"
              }
              
              Only respond with valid JSON, no other text.`,
                  },
                ],
              },
            ],
            config: {
              responseModalities: ["TEXT"],
              temperature: 0.7,
            },
          })
      );

      for await (const chunk of stream) {
        if (chunk.candidates) {
          for (const candidate of chunk.candidates) {
            if (candidate.content?.parts) {
              for (const part of candidate.content.parts) {
                if (part.text) {
                  analysisText += part.text;
                }
              }
            }
          }
        }
      }

      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
      const analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

      logger(`Image analysis complete: ${JSON.stringify(analysis)}`);
      return analysis;
    }, "analyzeImage");
  }

  /**
   * Get MIME type from file extension
   */
  private getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: { [key: string]: string } = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".heic": "image/heic",
      ".jfif": "image/jfif",
    };
    return mimeTypes[ext] || "image/jpeg";
  }
}

export const geminiService = new GeminiService();