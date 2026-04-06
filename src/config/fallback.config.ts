/**
 * Gemini fallback configuration.
 * The primary image stays on Gemini 3 Pro image preview, and the two follow-up variants use Gemini 2.5 Flash image.
 */

export const FALLBACK_MODEL = "gemini";

export const FALLBACK_API_KEY = process.env.GEMINI_API_KEY || "";

export const FALLBACK_RATE_LIMIT = 10;

export const FALLBACK_VARIANT_CONCURRENCY = 2;

export const FALLBACK_VARIANT_COUNT = 2;

export const FALLBACK_MAX_PARALLEL_REQUESTS = 2;

export const FALLBACK_PRIMARY_MODEL = "gemini-3-pro-image-preview";

export const FALLBACK_BACKUP_MODEL = "gemini-2.5-flash-image";

export const FALLBACK_PRIMARY_MAX_INPUT_EDGE = 2048;

export const FALLBACK_PRIMARY_JPEG_QUALITY = 88;

export const FALLBACK_VARIANT_MAX_INPUT_EDGE = 1024;

export const FALLBACK_VARIANT_JPEG_QUALITY = 82;

export const FALLBACK_PRIMARY_TEMPERATURE = 0.35;

export const FALLBACK_VARIANT_TEMPERATURE = 0.2;

export const FALLBACK_PRIMARY_MAX_ATTEMPTS = 1;

export const FALLBACK_VARIANT_MAX_ATTEMPTS = 1;

export const GEMINI_STAGE_MAX_RETRIES = 1;

export const GEMINI_VARIANT_MAX_RETRIES = 1;

export const GEMINI_ANALYSIS_MAX_RETRIES = 1;

export const GEMINI_ANALYSIS_MODEL = "gemini-2.0-flash";

export const GEMINI_ANALYSIS_MAX_IMAGE_EDGE = 1024;

export const GEMINI_ANALYSIS_JPEG_QUALITY = 88;

export const GEMINI_VARIANT_STYLE_FAMILY = "same-style-family";
