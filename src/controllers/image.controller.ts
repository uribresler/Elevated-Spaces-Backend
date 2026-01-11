import { Request, Response } from "express";
import * as fs from "fs";
import { geminiService } from "../services/gemini.service";
import { supabaseStorage } from "../services/supabaseStorage.service";
import { logger } from "../utils/logger";
import {
  ImageProcessingError,
  ImageErrorCode,
  ErrorMessages,
  VALID_ROOM_TYPES,
  VALID_STAGING_STYLES,
  parseStorageError,
} from "../utils/imageErrors";

/**
 * Get recent uploads from Supabase Storage
 */
export async function getRecentUploads(req: Request, res: Response): Promise<void> {
  try {
    const { limit = 10 } = req.query;
    const maxLimit = Math.min(Number(limit), 50); // Cap at 50

    // Fetch from Supabase storage
    const result = await supabaseStorage.listRecentUploads(maxLimit);

    res.status(200).json({
      success: true,
      data: {
        uploads: result.uploads,
        total: result.total,
        limit: maxLimit,
        storage: "supabase",
      },
    });
  } catch (error) {
    logger(`Error getting recent uploads: ${error}`);
    res.status(500).json({
      success: false,
      error: {
        code: ImageErrorCode.UNKNOWN_ERROR,
        message: "Failed to retrieve recent uploads. Please try again.",
        details: error instanceof Error ? error.message : undefined,
      },
    });
  }
}

export async function generateImage(req: Request, res: Response): Promise<void> {
  let inputImagePath: string | null = null;
  let stagedImagePath: string | null = null;

  try {
    // ============================================
    // VALIDATION: Check if file was uploaded
    // ============================================
    if (!req.file) {
      res.status(400).json({
        success: false,
        error: {
          code: ImageErrorCode.NO_FILE_PROVIDED,
          message: ErrorMessages[ImageErrorCode.NO_FILE_PROVIDED],
        },
      });
      return;
    }

    inputImagePath = req.file.path;

    // Validate file exists and is readable
    if (!fs.existsSync(inputImagePath)) {
      res.status(400).json({
        success: false,
        error: {
          code: ImageErrorCode.FILE_READ_ERROR,
          message: ErrorMessages[ImageErrorCode.FILE_READ_ERROR],
        },
      });
      return;
    }

    // ============================================
    // VALIDATION: Check file size (10MB max)
    // ============================================
    const stats = fs.statSync(inputImagePath);
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (stats.size > maxSize) {
      fs.unlinkSync(inputImagePath);
      res.status(400).json({
        success: false,
        error: {
          code: ImageErrorCode.FILE_TOO_LARGE,
          message: ErrorMessages[ImageErrorCode.FILE_TOO_LARGE],
          details: `File size: ${(stats.size / 1024 / 1024).toFixed(2)}MB. Maximum: 10MB`,
        },
      });
      return;
    }

    // ============================================
    // VALIDATION: Extract and validate parameters
    // ============================================
    const {
      prompt,
      roomType = "living-room",
      stagingStyle = "modern",
      keepLocalFiles = false,
    } = req.body;

    // Validate room type
    if (!VALID_ROOM_TYPES.includes(roomType.toLowerCase())) {
      res.status(400).json({
        success: false,
        error: {
          code: ImageErrorCode.INVALID_ROOM_TYPE,
          message: ErrorMessages[ImageErrorCode.INVALID_ROOM_TYPE],
          details: `Valid room types: ${VALID_ROOM_TYPES.join(", ")}`,
        },
      });
      return;
    }

    // Validate staging style
    if (!VALID_STAGING_STYLES.includes(stagingStyle.toLowerCase())) {
      res.status(400).json({
        success: false,
        error: {
          code: ImageErrorCode.INVALID_STAGING_STYLE,
          message: ErrorMessages[ImageErrorCode.INVALID_STAGING_STYLE],
          details: `Valid styles: ${VALID_STAGING_STYLES.join(", ")}`,
        },
      });
      return;
    }

    logger(`Processing image: roomType=${roomType}, style=${stagingStyle}`);

    // ============================================
    // AI PROCESSING: Stage the image
    // (Retry logic with fallback models handled by geminiService)
    // ============================================
    try {
      logger("Starting AI staging...");
      stagedImagePath = await geminiService.stageImage(
        inputImagePath,
        roomType.toLowerCase(),
        stagingStyle.toLowerCase(),
        prompt
      );
      logger("AI processing complete. Uploading to storage...");
    } catch (aiError) {
      logger(`AI staging failed: ${aiError instanceof Error ? aiError.message : aiError}`);
      
      if (aiError instanceof ImageProcessingError) {
        res.status(aiError.statusCode).json(aiError.toJSON());
      } else {
        res.status(500).json({
          success: false,
          error: {
            code: ImageErrorCode.AI_PROCESSING_FAILED,
            message: ErrorMessages[ImageErrorCode.AI_PROCESSING_FAILED],
            details: aiError instanceof Error ? aiError.message : undefined,
          },
        });
      }
      return;
    }

    // Verify staged image was created
    if (!stagedImagePath || !fs.existsSync(stagedImagePath)) {
      res.status(500).json({
        success: false,
        error: {
          code: ImageErrorCode.AI_NO_IMAGE_GENERATED,
          message: ErrorMessages[ImageErrorCode.AI_NO_IMAGE_GENERATED],
        },
      });
      return;
    }

    // ============================================
    // STORAGE: Upload to Supabase
    // ============================================
    let originalUrl: string | null = null;
    let stagedUrl: string | null = null;

    try {
      const result = await supabaseStorage.uploadImagePair(
        inputImagePath,
        stagedImagePath
      );
      originalUrl = result.originalUrl;
      stagedUrl = result.stagedUrl;
    } catch (storageError) {
      const parsedError = parseStorageError(storageError);
      res.status(parsedError.statusCode).json(parsedError.toJSON());
      return;
    }

    // Check if uploads were successful
    if (!originalUrl || !stagedUrl) {
      res.status(500).json({
        success: false,
        error: {
          code: ImageErrorCode.STORAGE_UPLOAD_FAILED,
          message: ErrorMessages[ImageErrorCode.STORAGE_UPLOAD_FAILED],
          details: !originalUrl
            ? "Failed to upload original image"
            : "Failed to upload staged image",
        },
      });
      return;
    }

    // ============================================
    // CLEANUP: Remove local files if requested
    // ============================================
    if (!keepLocalFiles && inputImagePath && stagedImagePath) {
      supabaseStorage.cleanupLocalFiles(inputImagePath, stagedImagePath);
    }

    // ============================================
    // SUCCESS: Return the result
    // ============================================
    logger("Image staging completed successfully");

    res.status(200).json({
      success: true,
      message: "Image staged successfully! Your virtually staged image is ready.",
      data: {
        originalImageUrl: originalUrl,
        stagedImageUrl: stagedUrl,
        roomType,
        stagingStyle,
        prompt: prompt || null,
        storage: "supabase",
      },
    });
  } catch (error) {
    // ============================================
    // CATCH-ALL: Handle unexpected errors
    // ============================================
    logger(`Unexpected error in generateImage: ${error}`);

    // Clean up any uploaded files on error
    if (inputImagePath && fs.existsSync(inputImagePath)) {
      try {
        fs.unlinkSync(inputImagePath);
      } catch (cleanupError) {
        logger(`Failed to cleanup input file: ${cleanupError}`);
      }
    }

    if (error instanceof ImageProcessingError) {
      res.status(error.statusCode).json(error.toJSON());
    } else {
      res.status(500).json({
        success: false,
        error: {
          code: ImageErrorCode.UNKNOWN_ERROR,
          message: ErrorMessages[ImageErrorCode.UNKNOWN_ERROR],
          details: error instanceof Error ? error.message : undefined,
        },
      });
    }
  }
}

/**
 * Analyze an image to get room details and suggestions
 */
export async function analyzeImage(req: Request, res: Response): Promise<void> {
  try {
    if (!req.file) {
      res.status(400).json({
        success: false,
        error: {
          code: ImageErrorCode.NO_FILE_PROVIDED,
          message: ErrorMessages[ImageErrorCode.NO_FILE_PROVIDED],
        },
      });
      return;
    }

    const inputImagePath = req.file.path;

    try {
      const analysis = await geminiService.analyzeImage(inputImagePath);

      res.status(200).json({
        success: true,
        message: "Image analyzed successfully",
        data: {
          analysis,
          validRoomTypes: VALID_ROOM_TYPES,
          validStyles: VALID_STAGING_STYLES,
        },
      });
    } catch (aiError) {
      if (aiError instanceof ImageProcessingError) {
        res.status(aiError.statusCode).json(aiError.toJSON());
      } else {
        res.status(500).json({
          success: false,
          error: {
            code: ImageErrorCode.AI_PROCESSING_FAILED,
            message: "Failed to analyze the image. Please try again.",
            details: aiError instanceof Error ? aiError.message : undefined,
          },
        });
      }
    } finally {
      // Clean up uploaded file
      if (fs.existsSync(inputImagePath)) {
        fs.unlinkSync(inputImagePath);
      }
    }
  } catch (error) {
    logger(`Error analyzing image: ${error}`);
    res.status(500).json({
      success: false,
      error: {
        code: ImageErrorCode.UNKNOWN_ERROR,
        message: ErrorMessages[ImageErrorCode.UNKNOWN_ERROR],
        details: error instanceof Error ? error.message : undefined,
      },
    });
  }
}
