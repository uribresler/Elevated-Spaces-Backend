import { Request, Response } from "express";
import crypto from "crypto";
import prisma from "../dbConnection";
import { DEMO_LIMIT, getGuestDemoTracking, getUserDemoTracking, isNewMonth } from "../utils/demoTracking";
import { AuthUser } from "../types/auth";

// Extend Request type to include user
declare module 'express' {
  interface Request {
    user?: AuthUser;
  }
}

/**
 * Initialize or hydrate demo tracking session
 * - For logged-in users: returns user_demo_tracking
 * - For guests: returns guest_tracking
 * This is called on app load to sync client state with DB
 */
export async function initGuest(req: Request, res: Response): Promise<void> {
  try {
    const now = new Date();
    const userId = req.user?.id;
    
    // LOGGED-IN USER FLOW
    if (userId) {
      // Check if user has purchased credits
      const purchaseCount = await prisma.user_credit_purchase.count({
        where: {
          user_id: userId,
          status: 'completed',
        },
      });
      const hasPurchasedCredits = purchaseCount > 0;

      if (hasPurchasedCredits) {
        res.status(200).json({
          success: true,
          data: {
            userId,
            usageCount: 0,
            limit: DEMO_LIMIT,
            limitReached: false,
            blocked: false,
            remainingDemoCredits: 0,
            isDemo: false,
            hasPurchasedCredits: true,
            resetInfo: "N/A - Demo credits converted to paid credits on your first subscription purchase",
          },
        });
        return;
      }

      const userDemoTracking = await getUserDemoTracking(userId);
      const usageCount = userDemoTracking.uploads_count;
      const limitReached = usageCount >= DEMO_LIMIT;
      const remainingDemoCredits = Math.max(0, DEMO_LIMIT - usageCount);
      
      res.status(200).json({
        success: true,
        data: {
          userId,
          usageCount,
          limit: DEMO_LIMIT,
          limitReached,
          blocked: false,
          remainingDemoCredits,
          isDemo: !hasPurchasedCredits,
          hasPurchasedCredits,
          resetInfo: "Resets on the 1st of each month",
          lastResetAt: userDemoTracking.last_reset_at,
        },
      });
      return;
    }
    
    // GUEST USER FLOW
    let deviceId = req.cookies?.device_id || req.headers["x-fingerprint"] as string;    
    let isNewGuest = false;

    // Generate new device ID if needed
    if (!deviceId) {
      deviceId = crypto.randomUUID();
      isNewGuest = true;
    }

    // Get or create guest tracking (auto-resets monthly)
    const guestTracking = await getGuestDemoTracking(deviceId, req.ip || "");
    
    // Check if this is a newly created record
    if (guestTracking.uploads_count === 0 && !guestTracking.blocked) {
      const createdRecently = (now.getTime() - new Date(guestTracking.last_used_at).getTime()) < 5000;
      if (createdRecently) {
        isNewGuest = true;
      }
    }

    const usageCount = guestTracking.uploads_count;
    const limitReached = usageCount >= DEMO_LIMIT;

    // Set cookie with device_id (1 year expiry, client-readable)
    res.cookie("device_id", guestTracking.fingerprint, {
      httpOnly: false, // Needs to be readable by client for hydration
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year in ms
    });

    res.status(200).json({
      success: true,
      data: {
        deviceId: guestTracking.fingerprint,
        usageCount,
        limit: DEMO_LIMIT,
        limitReached,
        blocked: guestTracking.blocked,
        isNewGuest,
        isDemo: true,
        hasPurchasedCredits: false,
        resetInfo: "Resets on the 1st of each month",
        lastUsedAt: guestTracking.last_used_at,
      },
    });
  } catch (error) {
    console.error("[initGuest] Error:", error);
    res.status(500).json({
      success: false,
      error: { message: "Failed to initialize guest session" },
    });
  }
}

/**
 * Get current demo tracking status (read-only, no side effects)
 * - For logged-in users: returns user_demo_tracking
 * - For guests: returns guest_tracking
 */
export async function getGuestStatus(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    
    // LOGGED-IN USER FLOW
    if (userId) {
      // Check if user has purchased credits
      const purchaseCount = await prisma.user_credit_purchase.count({
        where: {
          user_id: userId,
          status: 'completed',
        },
      });
      const hasPurchasedCredits = purchaseCount > 0;

      if (hasPurchasedCredits) {
        res.status(200).json({
          success: true,
          data: {
            userId,
            usageCount: 0,
            limit: DEMO_LIMIT,
            limitReached: false,
            blocked: false,
            remainingDemoCredits: 0,
            isDemo: false,
            hasPurchasedCredits: true,
            exists: true,
          },
        });
        return;
      }

      // Get user demo tracking
      const userDemoTracking = await prisma.user_demo_tracking.findUnique({
        where: { user_id: userId },
      });
      
      if (!userDemoTracking) {
        res.status(200).json({
          success: true,
          data: {
            userId,
            usageCount: 0,
            limit: DEMO_LIMIT,
            limitReached: false,
            blocked: false,
            remainingDemoCredits: DEMO_LIMIT,
            isDemo: !hasPurchasedCredits,
            hasPurchasedCredits,
            exists: false,
          },
        });
        return;
      }
      
      // Check if needs reset
      const now = new Date();
      let usageCount = userDemoTracking.uploads_count;
      if (isNewMonth(userDemoTracking.last_reset_at, now)) {
        usageCount = 0;
      }
      
      res.status(200).json({
        success: true,
        data: {
          userId,
          usageCount,
          limit: DEMO_LIMIT,
          limitReached: usageCount >= DEMO_LIMIT,
          blocked: false,
          remainingDemoCredits: Math.max(0, DEMO_LIMIT - usageCount),
          isDemo: !hasPurchasedCredits,
          hasPurchasedCredits,
          exists: true,
          lastResetAt: userDemoTracking.last_reset_at,
        },
      });
      return;
    }
    
    // GUEST USER FLOW
    const deviceId = req.cookies?.device_id || req.headers["x-fingerprint"] as string;

    if (!deviceId) {
      res.status(200).json({
        success: true,
        data: {
          deviceId: null,
          usageCount: 0,
          limit: DEMO_LIMIT,
          limitReached: false,
          blocked: false,
          exists: false,
        },
      });
      return;
    }

    const guestTracking = await prisma.guest_tracking.findFirst({
      where: { fingerprint: deviceId },
    });

    if (!guestTracking) {
      res.status(200).json({
        success: true,
        data: {
          deviceId,
          usageCount: 0,
          limit: DEMO_LIMIT,
          limitReached: false,
          blocked: false,
          exists: false,
        },
      });
      return;
    }

    // Check for reset without modifying
    const now = new Date();
    const lastUsed = new Date(guestTracking.last_used_at);

    let usageCount = guestTracking.uploads_count;
    if (isNewMonth(lastUsed, now)) {
      usageCount = 0; // Show as reset (actual reset happens on initGuest or upload)
    }

    res.status(200).json({
      success: true,
      data: {
        deviceId: guestTracking.fingerprint,
        usageCount,
        limit: DEMO_LIMIT,
        limitReached: usageCount >= DEMO_LIMIT,
        blocked: guestTracking.blocked,
        exists: true,
        lastUsedAt: guestTracking.last_used_at,
      },
    });
  } catch (error) {
    console.error("[getGuestStatus] Error:", error);
    res.status(500).json({
      success: false,
      error: { message: "Failed to get guest status" },
    });
  }
}
