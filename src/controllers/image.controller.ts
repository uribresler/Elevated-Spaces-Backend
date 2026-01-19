import { Request, Response } from "express";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
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
import { imageQueue } from "../queues/image.queue";
import prisma from "../dbConnection";
import { image_status } from "@prisma/client";
import { AuthUser } from "../types/auth";
import { addWatermark } from "../utils/watermark";

// TypeScript: declare global property for demo upload counts
declare global {
  // Use Record<string, number> for session/IP tracking
  var demoUploadCounts: Record<string, number> | undefined;
}

/**
 * Restage a previously staged image with a new prompt (variation/edit)
 * Accepts a staged image file and prompt, returns a new staged image
 */
export async function restageImage(req: Request, res: Response): Promise<void> {
  try {
    const { stagedId, prompt, roomType = "living-room", stagingStyle = "modern", keepLocalFiles = false } = req.body;
    // DEMO LIMIT & ABUSE TRACKING (DB-backed)
    // Apply demo logic to guests and logged-in users without a subscription (subscription logic to be added later)
    let isDemo = true;
    let guestTracking = null;
    let demoCount = 0;
    let demoLimitReached = false;
    let blocked = false;
    const now = new Date();
    let userId = null;
    if (req.user && req.user.id) {
      userId = req.user.id;
      // TODO: Integrate subscription check here in future milestone
      // For now, treat all users as demo unless they have a subscription (not implemented yet)
      // Find or create guest_tracking for user
      guestTracking = await prisma.guest_tracking.findFirst({
        where: { userId },
      });
      if (!guestTracking) {
        guestTracking = await prisma.guest_tracking.create({
          data: {
            userId,
            fingerprint: "",
            ip: req.ip || '',
            uploads_count: 0,
            blocked: false,
            last_used_at: now,
          },
        });
      }
    } else {
      // Guest logic (by session/cookie/ip)
      const sessionId = req.cookies?.session_id || req.headers['x-fingerprint'] || req.ip;
      const ipStr = req.ip || '';
      guestTracking = await prisma.guest_tracking.findFirst({
        where: {
          OR: [
            { fingerprint: sessionId },
            { ip: ipStr },
          ],
        },
      });
      if (!guestTracking) {
        guestTracking = await prisma.guest_tracking.create({
          data: {
            fingerprint: sessionId,
            ip: ipStr,
            uploads_count: 0,
            blocked: false,
            last_used_at: now,
          },
        });
      }
    }
    // Check if blocked
    if (guestTracking.blocked) {
      blocked = true;
    }
    // Check if 30 days have passed since last_used_at
    const lastUsed = new Date(guestTracking.last_used_at);
    const daysSinceLast = Math.floor((now.getTime() - lastUsed.getTime()) / (1000 * 60 * 60 * 24));
    let uploads_count = guestTracking.uploads_count;
    if (daysSinceLast >= 30) {
      // Count previous resets for this guest (event_type: 'demo_limit_reset')
      const resetEvents = await prisma.analytics_event.count({
        where: {
          event_type: 'demo_limit_reset',
          ip: guestTracking.ip,
        },
      });
      // If 2+ resets, block this guest
      if (resetEvents >= 2) {
        await prisma.guest_tracking.update({
          where: { id: guestTracking.id },
          data: { blocked: true },
        });
        blocked = true;
      } else {
        // Log a reset event
        await prisma.analytics_event.create({
          data: {
            event_type: 'demo_limit_reset',
            ip: guestTracking.ip,
            source: 'demo',
            timestamp: now,
          },
        });
        // Reset uploads_count and update last_used_at
        uploads_count = 0;
        await prisma.guest_tracking.update({
          where: { id: guestTracking.id },
          data: { uploads_count: 0, last_used_at: now },
        });
      }
    }
    demoCount = uploads_count;
    if (demoCount >= 10) {
      demoLimitReached = true;
    }
    if (blocked) {
      res.status(403).json({
        success: false,
        error: {
          code: 'DEMO_BLOCKED',
          message: 'Demo access blocked due to abuse. Please contact support or sign up.',
        },
      });
      return;
    }
    if (demoLimitReached) {
      res.status(429).json({
        success: false,
        error: {
          code: 'DEMO_LIMIT_REACHED',
          message: 'Demo limit reached. Please sign up or purchase credits to continue.',
        },
      });
      return;
    }
    if (!stagedId) {
      res.status(400).json({
        success: false,
        error: {
          code: ImageErrorCode.NO_FILE_PROVIDED,
          message: "Missing staged image ID for restaging.",
        },
      });
      return;
    }
    // Download unwatermarked staged image from Supabase
    const stagedUrl = await supabaseStorage.getPublicStagedUrl(stagedId);
    if (!stagedUrl) {
      res.status(400).json({
        success: false,
        error: {
          code: ImageErrorCode.FILE_READ_ERROR,
          message: "Could not find staged image in Supabase.",
        },
      });
      return;
    }
    // Download image to temp file (cross-platform)
    const tempPath = path.join(os.tmpdir(), stagedId);
    const response = await fetch(stagedUrl);
    const arrayBuffer = await response.arrayBuffer();
    await fs.promises.writeFile(tempPath, Buffer.from(arrayBuffer));
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
    // AI PROCESSING: Stage the image (variation)
    let stagedImageBuffer: Buffer | null = null;
    try {
      stagedImageBuffer = await geminiService.stageImage(
        tempPath,
        roomType.toLowerCase(),
        stagingStyle.toLowerCase(),
        prompt
      );
    } catch (aiError) {
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
    if (!stagedImageBuffer || stagedImageBuffer.length === 0) {
      res.status(500).json({
        success: false,
        error: {
          code: ImageErrorCode.AI_NO_IMAGE_GENERATED,
          message: ErrorMessages[ImageErrorCode.AI_NO_IMAGE_GENERATED],
        },
      });
      return;
    }
    // Always watermark restaged images (demo mode)
    if (stagedImageBuffer) {
      stagedImageBuffer = await addWatermark(stagedImageBuffer, "DEMO PREVIEW");
    }
    // STORAGE: Upload to Supabase
    let restagedUrl: string | null = null;
    try {
      const stagedFileName = `restaged-${Date.now()}.png`;
      const result = await supabaseStorage.uploadStagedImageBuffer(
        stagedImageBuffer,
        stagedFileName,
        "image/png"
      );
      restagedUrl = result.stagedUrl;
    } catch (storageError) {
      const parsedError = parseStorageError(storageError);
      res.status(parsedError.statusCode).json(parsedError.toJSON());
      return;
    }
    if (!restagedUrl) {
      res.status(500).json({
        success: false,
        error: {
          code: ImageErrorCode.STORAGE_UPLOAD_FAILED,
          message: ErrorMessages[ImageErrorCode.STORAGE_UPLOAD_FAILED],
          details: "Failed to upload restaged image",
        },
      });
      return;
    }
    // CLEANUP: Remove temp file
    await fs.promises.unlink(tempPath);
    // Track demo upload for session/IP/fingerprint (restage counts as a demo use)
    if (isDemo && guestTracking) {
      await prisma.guest_tracking.update({
        where: { id: guestTracking.id },
        data: {
          uploads_count: { increment: 1 },
          last_used_at: now,
        },
      });
      demoCount += 1;
      // --- Analytics event logging ---
      const ip = req.ip || '';
      const language = req.headers['accept-language'] || null;
      const userAgent = req.headers['user-agent'] || '';
      let deviceType: string | null = null;
      if (/mobile/i.test(userAgent)) deviceType = 'mobile';
      else if (/tablet/i.test(userAgent)) deviceType = 'tablet';
      else deviceType = 'desktop';
      const location = ip;
      // Check if this guest is a repeat demo user (3+ resets)
      const resetEvents = await prisma.analytics_event.count({
        where: { event_type: 'demo_limit_reset', ip },
      });
      const isRepeatDemoUser = resetEvents >= 2;
      await prisma.analytics_event.create({
        data: {
          event_type: isRepeatDemoUser ? 'repeat_demo_upload' : 'demo_upload',
          ip,
          language: typeof language === 'string' ? language.split(',')[0] : null,
          device_type: deviceType,
          location,
          source: 'demo',
        },
      });
    }
    // SUCCESS: Return the result
    res.status(200).json({
      success: true,
      message: "Restaged image generated successfully!",
      data: {
        stagedImageUrl: restagedUrl,
        roomType,
        stagingStyle,
        prompt: prompt || null,
        storage: "supabase",
        demoCount,
      },
    });
  } catch (error) {
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
  // DEMO LIMIT & ABUSE TRACKING (DB-backed)
  // Force all images to be demo (watermarked) for now
  const isDemo = true;
  // Use session cookie, fingerprint, or IP for guest identification
  const sessionId = req.cookies?.session_id || req.headers['x-fingerprint'] || req.ip;
  let guestTracking = null;
  let demoCount = 0;
  let demoLimitReached = false;
  let blocked = false;
  const now = new Date();
  if (isDemo) {
    // Find or create guest_tracking record
    const ipStr = req.ip || '';
    guestTracking = await prisma.guest_tracking.findFirst({
      where: {
        OR: [
          { fingerprint: sessionId },
          { ip: ipStr },
        ],
      },
    });
    if (!guestTracking) {
      guestTracking = await prisma.guest_tracking.create({
        data: {
          fingerprint: sessionId,
          ip: ipStr,
          uploads_count: 0,
          blocked: false,
          last_used_at: now,
        },
      });
    }
    // Check if blocked
    if (guestTracking.blocked) {
      blocked = true;
    }
    // Check if 30 days have passed since last_used_at
    const lastUsed = new Date(guestTracking.last_used_at);
    const daysSinceLast = Math.floor((now.getTime() - lastUsed.getTime()) / (1000 * 60 * 60 * 24));
    let uploads_count = guestTracking.uploads_count;
    if (daysSinceLast >= 30) {
      // Abuse logic: track resets in a custom field or analytics (for now, use a resets_count variable in memory, or add a resets_count field in DB for production)
      // For now, use analytics_event to count resets for this guest
      // Count previous resets for this guest (event_type: 'demo_limit_reset')
      const resetEvents = await prisma.analytics_event.count({
        where: {
          event_type: 'demo_limit_reset',
          ip: ipStr,
          // Optionally, add fingerprint/sessionId if needed
        },
      });
      // If 2+ resets, block this guest
      if (resetEvents >= 2) {
        await prisma.guest_tracking.update({
          where: { id: guestTracking.id },
          data: { blocked: true },
        });
        blocked = true;
      } else {
        // Log a reset event
        await prisma.analytics_event.create({
          data: {
            event_type: 'demo_limit_reset',
            ip: ipStr,
            source: 'demo',
            timestamp: now,
          },
        });
        // Reset uploads_count and update last_used_at
        uploads_count = 0;
        await prisma.guest_tracking.update({
          where: { id: guestTracking.id },
          data: { uploads_count: 0, last_used_at: now },
        });
      }
    }
    demoCount = uploads_count;
    if (demoCount >= 10) {
      demoLimitReached = true;
    }
  }
  if (blocked) {
    res.status(403).json({
      success: false,
      error: {
        code: 'DEMO_BLOCKED',
        message: 'Demo access blocked due to abuse. Please contact support or sign up.',
      },
    });
    return;
  }
  if (demoLimitReached) {
    res.status(429).json({
      success: false,
      error: {
        code: 'DEMO_LIMIT_REACHED',
        message: 'Demo limit reached. Please sign up or purchase credits to continue.',
      },
    });
    return;
  }

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

    inputImagePath = req.file.path;
    // Track demo upload for session/IP/fingerprint
    if (isDemo && guestTracking) {
      await prisma.guest_tracking.update({
        where: { id: guestTracking.id },
        data: {
          uploads_count: { increment: 1 },
          last_used_at: now,
        },
      });
      demoCount += 1;
      // --- Analytics event logging ---
      const ip = req.ip || '';
      const language = req.headers['accept-language'] || null;
      const userAgent = req.headers['user-agent'] || '';
      let deviceType: string | null = null;
      if (/mobile/i.test(userAgent)) deviceType = 'mobile';
      else if (/tablet/i.test(userAgent)) deviceType = 'tablet';
      else deviceType = 'desktop';
      // Basic location: use IP as placeholder (for real use, integrate geoip)
      const location = ip;
      // Check if this guest is a repeat demo user (3+ resets)
      const resetEvents = await prisma.analytics_event.count({
        where: {
          event_type: 'demo_limit_reset',
          ip,
        },
      });
      const isRepeatDemoUser = resetEvents >= 2;
      await prisma.analytics_event.create({
        data: {
          event_type: isRepeatDemoUser ? 'repeat_demo_upload' : 'demo_upload',
          ip,
          language: typeof language === 'string' ? language.split(',')[0] : null,
          device_type: deviceType,
          location,
          source: 'demo',
          // Optionally, add a flag for outreach/notification
        },
      });
    }

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
    // Optimized: Returns Buffer directly, no disk write
    // ============================================
    let stagedImageBuffer: Buffer | null = null;
    let unwatermarkedBuffer: Buffer | null = null;
    try {
      const startTime = Date.now();
      logger("Starting AI staging...");
      unwatermarkedBuffer = await geminiService.stageImage(
        inputImagePath,
        roomType.toLowerCase(),
        stagingStyle.toLowerCase(),
        prompt
      );
      stagedImageBuffer = unwatermarkedBuffer;
      // --- Server-side watermarking for demo images ---
      if (isDemo && stagedImageBuffer) {
        stagedImageBuffer = await addWatermark(stagedImageBuffer, "DEMO PREVIEW");
      }
      const processingTime = Date.now() - startTime;
      logger(`AI processing complete in ${processingTime}ms. Uploading to storage...`);
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
    if (!stagedImageBuffer || stagedImageBuffer.length === 0) {
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
    // STORAGE: Upload to Supabase (OPTIMIZED)
    // Upload staged image directly from Buffer without writing to disk
    // ============================================
    let originalUrl: string | null = null;
    let stagedUrl: string | null = null;
    let stagedId: string | null = null;
    try {
      const stagedFileName = `staged-${Date.now()}.png`;
      const unwatermarkedFileName = `staged-unwatermarked-${Date.now()}.png`;
      const uploadStartTime = Date.now();
      // Upload original image
      originalUrl = await supabaseStorage.uploadOriginal(inputImagePath);
      // Upload watermarked preview
      stagedUrl = await supabaseStorage.uploadStagedFromBuffer(stagedImageBuffer, stagedFileName, "image/png");
      // Upload unwatermarked version for backend use
      await supabaseStorage.uploadStagedFromBuffer(unwatermarkedBuffer, unwatermarkedFileName, "image/png");
      stagedId = unwatermarkedFileName;
      const uploadTime = Date.now() - uploadStartTime;
      logger(`Storage uploads completed in ${uploadTime}ms`);
    } catch (storageError) {
      const parsedError = parseStorageError(storageError);
      res.status(parsedError.statusCode).json(parsedError.toJSON());
      return;
    }
    // Check if uploads were successful
    if (!originalUrl || !stagedUrl || !stagedId) {
      res.status(500).json({
        success: false,
        error: {
          code: ImageErrorCode.STORAGE_UPLOAD_FAILED,
          message: ErrorMessages[ImageErrorCode.STORAGE_UPLOAD_FAILED],
          details: !originalUrl
            ? "Failed to upload original image"
            : !stagedUrl
              ? "Failed to upload staged image"
              : "Failed to upload unwatermarked staged image",
        },
      });
      return;
    }

    // ============================================
    // CLEANUP: Remove local files if requested
    // ============================================
    if (!keepLocalFiles && inputImagePath) {
      supabaseStorage.cleanupLocalFiles(inputImagePath);
    }

    // ============================================
    // SUCCESS: Return the result
    // ============================================
    logger("Image staging completed successfully");

    res.status(200).json({
      success: true,
      message: isDemo
        ? "Demo image preview generated. Sign up or purchase credits to download full-resolution images."
        : "Image staged successfully! Your virtually staged image is ready.",
      data: {
        // For demo, only return watermarked preview (no direct download)
        originalImageUrl: isDemo ? undefined : originalUrl,
        stagedImageUrl: stagedUrl,
        stagedId,
        isDemo,
        roomType,
        stagingStyle,
        prompt: prompt || null,
        storage: "supabase",
        demoCount: isDemo ? demoCount : undefined,
        demoLimit: isDemo ? 10 : undefined,
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

export async function generateMultipleImages(
  req: Request,
  res: Response
): Promise<void> {
  if (!req.files || !Array.isArray(req.files)) {
    res.status(400).json({
      success: false,
      error: {
        code: ImageErrorCode.NO_FILE_PROVIDED,
        message: ErrorMessages[ImageErrorCode.NO_FILE_PROVIDED],
      },
    });
    return;
  }

  if (!req.user) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }

  const userId = req.user.id;
  const { roomType, stagingStyle, prompt } = req.body;

  const files = req.files as Express.Multer.File[];

  // 1️⃣ Create DB records
  const images = await prisma.$transaction(
    files.map((file) =>
      prisma.image.create({
        data: {
          user_id: userId,
          original_image_url: file.path,
          status: image_status.PROCESSING,
        },
      })
    )
  );

  // 2️⃣ Push jobs to queue
  images.forEach((image) => {
    imageQueue.add({
      imageId: image.id,
      originalPath: image.original_image_url,
      roomType,
      stagingStyle,
      customPrompt: prompt,
    });
  });

  // 3️⃣ Respond immediately
  res.status(202).json({
    success: true,
    message: "Images uploaded successfully. Staging started.",
    data: {
      total: images.length,
      imageIds: images.map((img) => img.id),
    },
  });
}