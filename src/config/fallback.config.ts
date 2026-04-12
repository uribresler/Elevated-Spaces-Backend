export const FALLBACK_VARIANT_COUNT = Number(process.env.FALLBACK_VARIANT_COUNT || "2");

export const FALLBACK_PRIMARY_MODEL =
  process.env.FALLBACK_PRIMARY_MODEL || "gemini-2.5-flash-image";

export const FALLBACK_BACKUP_MODEL =
  process.env.FALLBACK_BACKUP_MODEL || FALLBACK_PRIMARY_MODEL;

export const FALLBACK_MODEL = FALLBACK_PRIMARY_MODEL;

export const FALLBACK_TEMPERATURE = Number(process.env.FALLBACK_TEMPERATURE || "0.8");
export const FALLBACK_MAX_RETRIES = Number(process.env.FALLBACK_MAX_RETRIES || "2");
