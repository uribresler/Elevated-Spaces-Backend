import { Request, Response } from "express";
import prisma from "../dbConnection";
import { DEMO_LIMIT, getUnifiedDemoTracking, linkGuestToUser, resolveDemoFingerprint } from "../utils/demoTracking";
import { AuthUser } from "../types/auth";

// Extend Request type to include user
declare module 'express' {
  interface Request {
    user?: AuthUser;
  }
}

/**
 * Initialize or hydrate demo tracking session
 * Uses UNIFIED tracking: max(guest_tracking, user_demo_tracking)
 * This ensures users get only 10 credits total, whether logged in or not
 */
export async function initGuest(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    
    // Get fingerprint from cookie or header
    let deviceId = resolveDemoFingerprint({
      cookieDeviceId: req.cookies?.device_id,
      headerFingerprint: req.headers["x-fingerprint"] as string | undefined,
      ip: req.ip,
    });
    let isNewGuest = false;
    
    // Check if user has purchased credits (bypasses demo system)
    let hasPurchasedCredits = false;
    if (userId) {
      const purchaseCount = await prisma.user_credit_purchase.count({
        where: {
          user_id: userId,
          status: 'completed',
        },
      });
      hasPurchasedCredits = purchaseCount > 0;

      if (hasPurchasedCredits) {
        res.status(200).json({
          success: true,
          data: {
            userId,
            deviceId,
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
      
      // Link guest session to user if not already linked
      await linkGuestToUser(deviceId, userId);
    }

    // Get unified demo tracking (max of guest and user counts)
    const tracking = await getUnifiedDemoTracking(userId || null, deviceId, req.ip || "");
    
    // Set cookie with device_id (1 year expiry, client-readable)
    res.cookie("device_id", deviceId, {
      httpOnly: false, // Needs to be readable by client for hydration
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year in ms
    });

    res.status(200).json({
      success: true,
      data: {
        userId: userId || null,
        deviceId,
        usageCount: tracking.unifiedCount,
        limit: DEMO_LIMIT,
        limitReached: tracking.limitReached,
        blocked: tracking.blocked,
        remainingDemoCredits: tracking.remainingCredits,
        isNewGuest: isNewGuest && !userId,
        isDemo: !hasPurchasedCredits,
        hasPurchasedCredits,
        resetInfo: "Resets on the 1st of each month",
        lastResetAt: tracking.userTracking?.last_reset_at || tracking.guestTracking?.last_used_at,
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
/**
 * Get current demo tracking status (read-only, no side effects)
 * Uses UNIFIED tracking: max(guest_tracking, user_demo_tracking)
 */
export async function getGuestStatus(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    const deviceId = resolveDemoFingerprint({
      cookieDeviceId: req.cookies?.device_id,
      headerFingerprint: req.headers["x-fingerprint"] as string | undefined,
      ip: req.ip,
    });
    
    // Check if user has purchased credits (bypasses demo system)
    let hasPurchasedCredits = false;
    if (userId) {
      const purchaseCount = await prisma.user_credit_purchase.count({
        where: {
          user_id: userId,
          status: 'completed',
        },
      });
      hasPurchasedCredits = purchaseCount > 0;

      if (hasPurchasedCredits) {
        res.status(200).json({
          success: true,
          data: {
            userId,
            deviceId: deviceId || null,
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
    }

    // Get unified demo tracking (max of guest and user counts)
    const tracking = await getUnifiedDemoTracking(userId || null, deviceId, req.ip || "");

    res.status(200).json({
      success: true,
      data: {
        userId: userId || null,
        deviceId,
        usageCount: tracking.unifiedCount,
        limit: DEMO_LIMIT,
        limitReached: tracking.limitReached,
        blocked: tracking.blocked,
        remainingDemoCredits: tracking.remainingCredits,
        isDemo: !hasPurchasedCredits,
        hasPurchasedCredits,
        exists: tracking.guestTracking !== null || tracking.userTracking !== null,
        lastResetAt: tracking.userTracking?.last_reset_at || tracking.guestTracking?.last_used_at,
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
