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

function getDeviceTypeFromUserAgent(userAgent: string | string[] | undefined): string | null {
  const ua = Array.isArray(userAgent) ? userAgent[0] : userAgent || "";
  if (!ua) return null;
  if (/mobile/i.test(ua)) return "mobile";
  if (/tablet/i.test(ua)) return "tablet";
  return "desktop";
}

async function getDemoLimitForUser(userId: string): Promise<number> {
  const demoBonus = await prisma.analytics_event.findFirst({
    where: { user_id: userId, event_type: "demo_bonus_granted" },
    select: { id: true },
  });
  return demoBonus ? 15 : 10;
}

async function getDemoUsageCountForUser(userId: string): Promise<number> {
  return prisma.analytics_event.count({
    where: { user_id: userId, event_type: "demo_credit_used" },
  });
}

/**
 * Restage a previously staged image with a new prompt (variation/edit)
 * Accepts a staged image file and prompt, returns a new staged image
 */
export async function restageImage(req: Request, res: Response): Promise<void> {
  // ADMIN BYPASS: If user is ADMIN, skip all restrictions
  let isAdmin = false;
  let userId: string | null = null;
  
  if (req.user && req.user.id) {
    userId = req.user.id;
    const verifyRole = await prisma.user_roles.findFirst({
      where: { user_id: userId },
      include: { role: true }
    })

    isAdmin = verifyRole?.role.name == "ADMIN" ? true : false;
    // Proceed with no demo/block/plan checks
    // ...existing code, but skip all demoLimitReached, block, and plan logic
    // Only require stagedId and process as normal
    // const { stagedId, prompt, roomType = "living-room", stagingStyle = "modern", keepLocalFiles = false, removeFurniture = false } = req.body;
    const { stagedId } = req.body;
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
    // ...continue with rest of restageImage logic (AI, watermark, upload, respond)
    // (Copy/paste the rest of the function body after the demo logic, or refactor for DRY if needed)
    // To avoid code duplication, fall through to the rest of the function after the demo logic, skipping only the demo checks above
  }
  try {
    const { stagedId, prompt, roomType = "living-room", stagingStyle = "modern", keepLocalFiles = false, removeFurniture = false } = req.body;
    // DEMO LIMIT & ABUSE TRACKING (DB-backed)
    let isDemo = !userId;
    let hasPurchasedCredits = false;
    let guestTracking = null;
    let demoCount = 0;
    let demoLimit = 10;
    let demoLimitReached = false;
    const now = new Date();
    // Always use device fingerprint for demo tracking (from header/cookie or fallback to session)
    const deviceFingerprint = req.headers['x-fingerprint'] || req.cookies?.device_id || req.cookies?.session_id || req.ip;

    if (userId) {
      const purchaseCount = await prisma.user_credit_purchase.count({
        where: {
          user_id: userId,
          status: 'completed',
        },
      });
      hasPurchasedCredits = purchaseCount > 0;
      if (!hasPurchasedCredits) {
        isDemo = true;
      }
    }

    if (userId && isDemo) {
      demoLimit = await getDemoLimitForUser(userId);
      demoCount = await getDemoUsageCountForUser(userId);
    }

    if (!userId) {
      guestTracking = await prisma.guest_tracking.findFirst({
        where: { fingerprint: deviceFingerprint },
      });
      if (!guestTracking) {
        guestTracking = await prisma.guest_tracking.create({
          data: {
            fingerprint: deviceFingerprint,
            ip: req.ip || '',
            uploads_count: 0,
            blocked: false,
            last_used_at: now,
          },
        });
      }
      // Check if 30 days have passed since last_used_at
      const lastUsed = new Date(guestTracking.last_used_at);
      const daysSinceLast = Math.floor((now.getTime() - lastUsed.getTime()) / (1000 * 60 * 60 * 24));
      let uploads_count = guestTracking.uploads_count;
      if (daysSinceLast >= 30) {
        // Log a reset event
        await prisma.analytics_event.create({
          data: {
            event_type: 'demo_limit_reset',
            ip: req.ip || '',
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
      demoCount = uploads_count;
      if (demoCount >= 10) {
        demoLimitReached = true;
      }
    }

    if (!userId && demoLimitReached) {
      res.status(429).json({
        success: false,
        error: {
          code: 'DEMO_LIMIT_REACHED',
          message: 'Demo limit reached for this device. Please sign up or purchase credits to continue. The limit resets every 30 days.',
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
    // (Single image for now, but future-proof for parallel if needed)
    let stagedImageBuffer: Buffer | null = null;
    try {
      // stagedImageBuffer = await geminiService.stageImage(
      //   tempPath,
      //   roomType.toLowerCase(),
      //   stagingStyle.toLowerCase(),
      //   prompt,
      //   removeFurniture
      // );
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
    // Add watermark only for demo users (guests without a paid plan)
    if (isDemo && stagedImageBuffer) {
      stagedImageBuffer = await addWatermark(stagedImageBuffer, "DEMO PREVIEW");
    }
    // STORAGE: Upload to Supabase
    let restagedUrl: string | null = null;
    let stagedFileName = '';
    try {
      stagedFileName = `restaged-${Date.now()}.png`;
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
    if (isDemo && userId) {
      const ip = req.ip || '';
      const language = req.headers['accept-language'] || null;
      const deviceType = getDeviceTypeFromUserAgent(req.headers['user-agent']);
      const location = ip || null;
      await prisma.analytics_event.create({
        data: {
          event_type: 'demo_credit_used',
          user_id: userId,
          ip,
          language: typeof language === 'string' ? language.split(',')[0] : null,
          device_type: deviceType,
          location,
          source: 'demo',
        },
      });
      demoCount += 1;
    }
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
      const deviceType = getDeviceTypeFromUserAgent(req.headers['user-agent']);
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
        stagedId: stagedFileName, // Always return the new staged file name for further restaging
        roomType,
        stagingStyle,
        prompt: prompt || null,
        storage: "supabase",
        demoCount: isDemo ? demoCount : undefined,
        demoLimit: isDemo ? demoLimit : undefined,
        isDemo,
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
    // Check if user is authenticated
    if (!req.user || !req.user.id) {
      res.status(401).json({
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required to view your uploads.",
        },
      });
      return;
    }

    const userId = req.user.id;
    const { limit = 10 } = req.query;
    const maxLimit = Math.min(Number(limit), 50); // Cap at 50

    // Fetch user's images from database
    const userImages = await prisma.image.findMany({
      where: {
        user_id: userId,
      },
      orderBy: {
        created_at: "desc",
      },
      take: maxLimit,
    });

    // Build response with image URLs
    const uploads = userImages.map((img) => {
      const originalUrl = img.original_image_url;
      const stagedUrl = img.staged_image_url || null;

      // Extract original filename from URL if needed
      const originalFilename = originalUrl.split("/").pop() || "original";
      const stagedFilename = stagedUrl ? stagedUrl.split("/").pop() || "staged" : null;

      return {
        original: {
          filename: originalFilename,
          url: originalUrl,
          createdAt: img.created_at.toISOString(),
        },
        staged: stagedUrl
          ? {
              filename: stagedFilename,
              url: stagedUrl,
              createdAt: img.updated_at.toISOString(),
            }
          : null,
        createdAt: img.created_at.toISOString(),
      };
    });

    res.status(200).json({
      success: true,
      data: {
        uploads,
        total: userImages.length,
        limit: maxLimit,
        storage: "database",
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
  let isAdmin = false;
  let userId: string | null = null;
  let teamId: string | null = req.body.teamId || null; // Get teamId from request body
  let projectId: string | null = req.body.projectId || null; // Get projectId from request body
  let teamMembership: any = null;
  let isTeamOwner = false;

  // Check if user is authenticated
  if (req.user && req.user.id) {
    userId = req.user.id;
    const verifyRole = await prisma.user_roles.findFirst({
      where: { user_id: userId },
      include: { role: true }
    })

    isAdmin = verifyRole?.role.name == "ADMIN" ? true : false;
  }

  // Validate teamId - only process if it's a non-empty string
  // Empty strings, "undefined", null, etc. should not be treated as valid teamIds
  if (!teamId || typeof teamId !== 'string' || teamId.trim() === '' || teamId === 'undefined' || teamId === 'null') {
    teamId = null;
  }

  // Validate projectId
  if (!projectId || typeof projectId !== 'string' || projectId.trim() === '' || projectId === 'undefined' || projectId === 'null') {
    projectId = null;
  }

  // If logged in and teamId provided, validate team access and credits
  if (userId && teamId) {
    // Check if user is team owner
    const team = await prisma.teams.findFirst({
      where: { 
        id: teamId,
        owner_id: userId,
        deleted_at: null
      }
    });

    if (team) {
      isTeamOwner = true;
      // Check if owner has credits in team wallet
      if (team.wallet <= 0) {
        res.status(403).json({
          success: false,
          error: {
            code: 'INSUFFICIENT_CREDITS',
            message: 'Team has insufficient credits. Please purchase more credits.',
          },
        });
        return;
      }
    } else {
      // Check if user is team member with allocated credits
      teamMembership = await prisma.team_membership.findUnique({
        where: { 
          team_id_user_id: {
            team_id: teamId,
            user_id: userId
          }
        },
        include: {
          team: true
        }
      });

      if (!teamMembership || teamMembership.team.deleted_at) {
        res.status(403).json({
          success: false,
          error: {
            code: 'TEAM_ACCESS_DENIED',
            message: 'You do not have access to this team.',
          },
        });
        return;
      }

      // Check if member has remaining credits
      const remainingCredits = teamMembership.allocated - teamMembership.used;
      if (remainingCredits <= 0) {
        res.status(403).json({
          success: false,
          error: {
            code: 'INSUFFICIENT_CREDITS',
            message: 'You have no remaining credits in this team. Please contact your team owner.',
          },
        });
        return;
      }
    }
  } else if (userId && !teamId) {
    // Logged in but no teamId provided - check personal credits
    const personalCredits = await prisma.user_credit_balance.findUnique({
      where: { user_id: userId }
    });

    logger(`Personal credits check - userId: ${userId}, balance: ${personalCredits?.balance || 0}`);

    if (!personalCredits || personalCredits.balance <= 0) {
      res.status(403).json({
        success: false,
        error: {
          code: 'INSUFFICIENT_CREDITS',
          message: 'You have no remaining credits. Please purchase more credits to continue.',
        },
      });
      return;
    }
  }

  let inputImagePath: string | null = null;
  // Demo mode: guests OR logged-in users who haven't purchased credits (bonus credits only)
  let isDemo = !userId;
  let hasPurchasedCredits = false;
  
  // If logged in, check if they have purchased credits
  if (userId) {
    const purchaseCount = await prisma.user_credit_purchase.count({
      where: {
        user_id: userId,
        status: 'completed',
      },
    });
    hasPurchasedCredits = purchaseCount > 0;
    // If they haven't purchased credits, treat them as demo users (bonus credits)
    if (!hasPurchasedCredits) {
      isDemo = true;
    }
  }
  
  const sessionId = req.cookies?.session_id || req.headers['x-fingerprint'] || req.ip;
  let guestTracking = null;
  let demoCount = 0;
  let demoLimit = 10;
  let demoLimitReached = false;
  let blocked = false;
  const now = new Date();

  if (userId && isDemo) {
    demoLimit = await getDemoLimitForUser(userId);
    demoCount = await getDemoUsageCountForUser(userId);
  }
  
  // Only apply guest tracking for actual guests (not logged in)
  if (!userId) {
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
  if (blocked && !isAdmin) {
    res.status(403).json({
      success: false,
      error: {
        code: 'DEMO_BLOCKED',
        message: 'Demo access blocked due to abuse. Please contact support or sign up.',
      },
    });
    return;
  }
  if (demoLimitReached && !isAdmin) {
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
    if (isDemo && userId) {
      const ip = req.ip || '';
      const language = req.headers['accept-language'] || null;
      const deviceType = getDeviceTypeFromUserAgent(req.headers['user-agent']);
      const location = ip || null;
      await prisma.analytics_event.create({
        data: {
          event_type: 'demo_credit_used',
          user_id: userId,
          ip,
          language: typeof language === 'string' ? language.split(',')[0] : null,
          device_type: deviceType,
          location,
          source: 'demo',
        },
      });
      demoCount += 1;
    }
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
      const deviceType = getDeviceTypeFromUserAgent(req.headers['user-agent']);
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

    // const {
    //   prompt,
    //   roomType = "living-room",
    //   stagingStyle = "modern",
    //   keepLocalFiles = false,
    //   removeFurniture = false,
    // } = req.body;
    const {
      prompt,
      roomType = "living-room",
      stagingStyle = "modern",
      keepLocalFiles = false
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
    // MULTI-VARIATION AI GENERATION
    // SSE streaming response
    const NUM_VARIATIONS = 5;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders && res.flushHeaders();

    let originalUrl = null;
    try {
      originalUrl = await supabaseStorage.uploadOriginal(inputImagePath);
    } catch (err) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: 'Failed to upload original image' })}\n\n`);
      res.end();
      return;
    }

    // Parallelize image generation for speed
    if (!inputImagePath) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: 'No input image path' })}\n\n`);
      res.end();
      return;
    }
    const imagePromises = Array.from({ length: NUM_VARIATIONS }).map(async (_, i) => {
      try {
        const variationPrompt = prompt ? `${prompt} [variation ${i + 1}]` : undefined;
        // let unwatermarked = await geminiService.stageImage(
        //   inputImagePath as string,
        //   roomType.toLowerCase(),
        //   stagingStyle.toLowerCase(),
        //   variationPrompt,
        //   removeFurniture
        // );
        let unwatermarked = await geminiService.stageImage(
          inputImagePath as string,
          roomType.toLowerCase(),
          stagingStyle.toLowerCase(),
          variationPrompt
        );
        let watermarked = unwatermarked;
        if (isDemo && watermarked) {
          watermarked = await addWatermark(watermarked, "DEMO PREVIEW");
        }
        const stagedFileName = `staged-${Date.now()}-${i}.png`;
        const unwatermarkedFileName = `staged-unwatermarked-${Date.now()}-${i}.png`;
        const stagedUrl = await supabaseStorage.uploadStagedFromBuffer(watermarked, stagedFileName, "image/png");
        await supabaseStorage.uploadStagedFromBuffer(unwatermarked, unwatermarkedFileName, "image/png");
        // Save to database
        const imageRecord = await prisma.image.create({
          data: {
            user_id: userId,
            project_id: projectId,
            original_image_url: originalUrl || '',
            staged_image_url: stagedUrl,
            watermarked_preview_url: isDemo ? stagedUrl : null,
            status: 'COMPLETED',
            is_demo: isDemo,
            room_type: roomType,
            staging_style: stagingStyle,
            prompt: prompt || null,
            source: isDemo ? 'demo' : 'user',
          }
        });

        // Stream each image as soon as it's ready
        res.write(`event: image\ndata: ${JSON.stringify({
          stagedImageUrl: stagedUrl,
          stagedId: unwatermarkedFileName,
          imageId: imageRecord.id,
          index: i,
          isDemo,
          roomType,
          stagingStyle,
          prompt: prompt || null,
          storage: "supabase",
          demoCount: isDemo ? demoCount : undefined,
          demoLimit: isDemo ? demoLimit : undefined,
        })}\n\n`);
      } catch (err) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: 'Failed to generate or upload image', error: String(err) })}\n\n`);
      }
    });
    await Promise.all(imagePromises);

    // Deduct credits after successful generation (1 credit per image set)
    if (userId && teamId) {
      try {
        if (isTeamOwner) {
          // Deduct from team wallet
          await prisma.teams.update({
            where: { id: teamId },
            data: { wallet: { decrement: 1 } }
          });
        } else if (teamMembership) {
          // Deduct from member's allocated credits
          await prisma.team_membership.update({
            where: { id: teamMembership.id },
            data: { used: { increment: 1 } }
          });

          // Log usage
          await prisma.team_usage.create({
            data: {
              membership_id: teamMembership.id,
              image_id: originalUrl || 'unknown',
              credits_used: 1,
              teamsId: teamId,
            }
          });
        }
      } catch (err) {
        logger(`Failed to deduct credits: ${err}`);
        // Don't fail the request, just log the error
      }
    } else if (userId && !teamId) {
      // Deduct from personal credits
      try {
        await prisma.user_credit_balance.update({
          where: { user_id: userId },
          data: { balance: { decrement: 1 } }
        });
      } catch (err) {
        logger(`Failed to deduct personal credits: ${err}`);
        // Don't fail the request, just log the error
      }
    }

    // Signal completion
    res.write('event: done\ndata: {}\n\n');
    res.end();
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

  // Create DB records
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

  // Push jobs to queue
  images.forEach((image) => {
    imageQueue.add({
      imageId: image.id,
      originalPath: image.original_image_url,
      roomType,
      stagingStyle,
      customPrompt: prompt,
    });
  });

  // Respond immediately
  res.status(202).json({
    success: true,
    message: "Images uploaded successfully. Staging started.",
    data: {
      total: images.length,
      imageIds: images.map((img) => img.id),
    },
  });
}