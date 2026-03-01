import prisma from "../dbConnection";

export const DEMO_LIMIT = 10;

/**
 * Check if we're in a new month compared to the last reset/use date
 * Returns true if the month or year has changed
 */
export function isNewMonth(lastDate: Date, currentDate: Date = new Date()): boolean {
  const lastMonth = lastDate.getMonth();
  const lastYear = lastDate.getFullYear();
  const currentMonth = currentDate.getMonth();
  const currentYear = currentDate.getFullYear();

  return currentYear > lastYear || (currentYear === lastYear && currentMonth > lastMonth);
}

/**
 * Get or create demo tracking for a logged-in user
 * Automatically resets count if we're in a new month
 */
export async function getUserDemoTracking(userId: string) {
  const now = new Date();
  
  let tracking = await prisma.user_demo_tracking.findUnique({
    where: { user_id: userId },
  });

  if (!tracking) {
    // Create new tracking record
    tracking = await prisma.user_demo_tracking.create({
      data: {
        user_id: userId,
        uploads_count: 0,
        last_reset_at: now,
      },
    });
  } else {
    // Check if we need to reset for new month
    if (isNewMonth(tracking.last_reset_at, now)) {
      tracking = await prisma.user_demo_tracking.update({
        where: { user_id: userId },
        data: {
          uploads_count: 0,
          last_reset_at: now,
        },
      });

      // Log reset event
      await prisma.analytics_event.create({
        data: {
          event_type: "demo_limit_reset",
          user_id: userId,
          source: "user_demo",
          timestamp: now,
        },
      });
    }
  }

  return tracking;
}

/**
 * Get or create guest tracking
 * Automatically resets count if we're in a new month
 */
export async function getGuestDemoTracking(fingerprint: string, ip: string = "") {
  const now = new Date();
  
  let tracking = await prisma.guest_tracking.findFirst({
    where: { fingerprint },
  });

  if (!tracking) {
    // Create new tracking record
    tracking = await prisma.guest_tracking.create({
      data: {
        fingerprint,
        ip,
        uploads_count: 0,
        blocked: false,
        last_used_at: now,
      },
    });
  } else {
    // Check if we need to reset for new month
    if (isNewMonth(tracking.last_used_at, now)) {
      tracking = await prisma.guest_tracking.update({
        where: { id: tracking.id },
        data: {
          uploads_count: 0,
          last_used_at: now,
        },
      });

      // Log reset event
      await prisma.analytics_event.create({
        data: {
          event_type: "demo_limit_reset",
          ip,
          source: "guest_demo",
          timestamp: now,
        },
      });
    }
  }

  return tracking;
}

/**
 * Increment demo usage for a logged-in user
 */
export async function incrementUserDemoUsage(userId: string) {
  return await prisma.user_demo_tracking.update({
    where: { user_id: userId },
    data: {
      uploads_count: {
        increment: 1,
      },
    },
  });
}

/**
 * Increment demo usage for a guest
 */
export async function incrementGuestDemoUsage(guestId: string) {
  return await prisma.guest_tracking.update({
    where: { id: guestId },
    data: {
      uploads_count: {
        increment: 1,
      },
      last_used_at: new Date(),
    },
  });
}
