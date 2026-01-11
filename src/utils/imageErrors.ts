/**
 * Custom error types for image processing with user-friendly messages
 */

export enum ImageErrorCode {
  // Upload errors
  NO_FILE_PROVIDED = "NO_FILE_PROVIDED",
  INVALID_FILE_TYPE = "INVALID_FILE_TYPE",
  FILE_TOO_LARGE = "FILE_TOO_LARGE",
  FILE_READ_ERROR = "FILE_READ_ERROR",

  // Validation errors
  INVALID_ROOM_TYPE = "INVALID_ROOM_TYPE",
  INVALID_STAGING_STYLE = "INVALID_STAGING_STYLE",

  // AI Processing errors
  AI_SERVICE_UNAVAILABLE = "AI_SERVICE_UNAVAILABLE",
  AI_QUOTA_EXCEEDED = "AI_QUOTA_EXCEEDED",
  AI_CONTENT_BLOCKED = "AI_CONTENT_BLOCKED",
  AI_PROCESSING_FAILED = "AI_PROCESSING_FAILED",
  AI_NO_IMAGE_GENERATED = "AI_NO_IMAGE_GENERATED",
  AI_TIMEOUT = "AI_TIMEOUT",

  // Storage errors
  STORAGE_UNAVAILABLE = "STORAGE_UNAVAILABLE",
  STORAGE_UPLOAD_FAILED = "STORAGE_UPLOAD_FAILED",
  STORAGE_BUCKET_ERROR = "STORAGE_BUCKET_ERROR",

  // General errors
  UNKNOWN_ERROR = "UNKNOWN_ERROR",
}

export class ImageProcessingError extends Error {
  public code: ImageErrorCode;
  public statusCode: number;
  public userMessage: string;
  public details?: string;

  constructor(
    code: ImageErrorCode,
    userMessage: string,
    statusCode: number = 500,
    details?: string
  ) {
    super(userMessage);
    this.name = "ImageProcessingError";
    this.code = code;
    this.statusCode = statusCode;
    this.userMessage = userMessage;
    this.details = details;
  }

  toJSON() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.userMessage,
        details: this.details || undefined,
      },
    };
  }
}

/**
 * Error messages map for consistent user-facing messages
 */
export const ErrorMessages: Record<ImageErrorCode, string> = {
  [ImageErrorCode.NO_FILE_PROVIDED]: "Please upload an image file to continue.",
  [ImageErrorCode.INVALID_FILE_TYPE]:
    "Invalid file type. Please upload a JPEG, PNG, GIF, or WebP image.",
  [ImageErrorCode.FILE_TOO_LARGE]:
    "File is too large. Maximum size is 10MB.",
  [ImageErrorCode.FILE_READ_ERROR]:
    "Unable to read the uploaded file. Please try again.",

  [ImageErrorCode.INVALID_ROOM_TYPE]:
    "Invalid room type selected. Please choose a valid room type.",
  [ImageErrorCode.INVALID_STAGING_STYLE]:
    "Invalid staging style selected. Please choose a valid style.",

  [ImageErrorCode.AI_SERVICE_UNAVAILABLE]:
    "AI staging service is temporarily unavailable. Please try again later.",
  [ImageErrorCode.AI_QUOTA_EXCEEDED]:
    "AI service quota exceeded. Please try again in a few minutes.",
  [ImageErrorCode.AI_CONTENT_BLOCKED]:
    "The image could not be processed due to content restrictions. Please upload a different image.",
  [ImageErrorCode.AI_PROCESSING_FAILED]:
    "Failed to process the image. Please try again with a different image.",
  [ImageErrorCode.AI_NO_IMAGE_GENERATED]:
    "Unable to generate a staged image. Please try with a clearer photo of the room.",
  [ImageErrorCode.AI_TIMEOUT]:
    "Image processing timed out. Please try again.",

  [ImageErrorCode.STORAGE_UNAVAILABLE]:
    "Storage service is temporarily unavailable. Please try again later.",
  [ImageErrorCode.STORAGE_UPLOAD_FAILED]:
    "Failed to save the processed images. Please try again.",
  [ImageErrorCode.STORAGE_BUCKET_ERROR]:
    "Storage configuration error. Please contact support.",

  [ImageErrorCode.UNKNOWN_ERROR]:
    "An unexpected error occurred. Please try again.",
};

/**
 * Valid room types for staging
 */
export const VALID_ROOM_TYPES = [
  "living-room",
  "bedroom",
  "kitchen",
  "bathroom",
  "dining-room",
  "office",
  "outdoor",
  "garage",
  "basement",
  "attic",
  "hallway",
  "other",
];

/**
 * Valid staging styles
 */
export const VALID_STAGING_STYLES = [
  "modern",
  "contemporary",
  "minimalist",
  "scandinavian",
  "industrial",
  "traditional",
  "transitional",
  "farmhouse",
  "coastal",
  "bohemian",
  "mid-century",
  "luxury",
];

/**
 * Parse Gemini API errors into user-friendly errors
 */
export function parseGeminiError(error: any): ImageProcessingError {
  const errorMessage = error?.message?.toLowerCase() || "";
  const errorStatus = error?.status || error?.code;

  // Rate limit / Quota errors
  if (
    errorMessage.includes("quota") ||
    errorMessage.includes("rate limit") ||
    errorStatus === 429
  ) {
    return new ImageProcessingError(
      ImageErrorCode.AI_QUOTA_EXCEEDED,
      ErrorMessages[ImageErrorCode.AI_QUOTA_EXCEEDED],
      429,
      "Please wait a moment before trying again."
    );
  }

  // Content blocked
  if (
    errorMessage.includes("blocked") ||
    errorMessage.includes("safety") ||
    errorMessage.includes("harmful")
  ) {
    return new ImageProcessingError(
      ImageErrorCode.AI_CONTENT_BLOCKED,
      ErrorMessages[ImageErrorCode.AI_CONTENT_BLOCKED],
      400
    );
  }

  // Service unavailable
  if (
    errorMessage.includes("unavailable") ||
    errorMessage.includes("503") ||
    errorStatus === 503
  ) {
    return new ImageProcessingError(
      ImageErrorCode.AI_SERVICE_UNAVAILABLE,
      ErrorMessages[ImageErrorCode.AI_SERVICE_UNAVAILABLE],
      503
    );
  }

  // Timeout
  if (errorMessage.includes("timeout") || errorMessage.includes("deadline")) {
    return new ImageProcessingError(
      ImageErrorCode.AI_TIMEOUT,
      ErrorMessages[ImageErrorCode.AI_TIMEOUT],
      504
    );
  }

  // Model not found / API errors
  if (errorMessage.includes("404") || errorMessage.includes("not found")) {
    return new ImageProcessingError(
      ImageErrorCode.AI_SERVICE_UNAVAILABLE,
      ErrorMessages[ImageErrorCode.AI_SERVICE_UNAVAILABLE],
      503,
      "AI model configuration error."
    );
  }

  // Default processing error
  return new ImageProcessingError(
    ImageErrorCode.AI_PROCESSING_FAILED,
    ErrorMessages[ImageErrorCode.AI_PROCESSING_FAILED],
    500,
    error?.message
  );
}

/**
 * Parse Supabase storage errors into user-friendly errors
 */
export function parseStorageError(error: any): ImageProcessingError {
  const errorMessage = error?.message?.toLowerCase() || "";

  if (errorMessage.includes("bucket") || errorMessage.includes("not found")) {
    return new ImageProcessingError(
      ImageErrorCode.STORAGE_BUCKET_ERROR,
      ErrorMessages[ImageErrorCode.STORAGE_BUCKET_ERROR],
      500
    );
  }

  if (
    errorMessage.includes("unavailable") ||
    errorMessage.includes("connection")
  ) {
    return new ImageProcessingError(
      ImageErrorCode.STORAGE_UNAVAILABLE,
      ErrorMessages[ImageErrorCode.STORAGE_UNAVAILABLE],
      503
    );
  }

  return new ImageProcessingError(
    ImageErrorCode.STORAGE_UPLOAD_FAILED,
    ErrorMessages[ImageErrorCode.STORAGE_UPLOAD_FAILED],
    500,
    error?.message
  );
}
