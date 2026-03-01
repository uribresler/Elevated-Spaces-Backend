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

/**
 * Link a guest session to a user account when they log in
 * This ensures they don't get extra credits by logging in
 */
export async function linkGuestToUser(fingerprint: string, userId: string) {
  const guestTracking = await prisma.guest_tracking.findFirst({
    where: { fingerprint },
  });
  
  if (guestTracking && !guestTracking.userId) {
    await prisma.guest_tracking.update({
      where: { id: guestTracking.id },
      data: { userId },
    });
  }
}

/**
 * Increment unified demo usage
 * Increments BOTH guest and user tracking if both exist
 */
export async function incrementUnifiedDemoUsage(
  userId: string | null,
  guestId: string | null
) {
  const promises = [];
  
  if (userId) {
    promises.push(
      prisma.user_demo_tracking.upsert({
        where: { user_id: userId },
        create: {
          user_id: userId,
          uploads_count: 1,
          last_reset_at: new Date(),
        },
        update: { uploads_count: { increment: 1 } },
      })
    );
  }
  
  if (guestId) {
    promises.push(
      prisma.guest_tracking.update({
        where: { id: guestId },
        data: {
          uploads_count: { increment: 1 },
          last_used_at: new Date(),
        },
      })
    );
  }
  
  await Promise.all(promises);
}

/**
 * Resolve a stable device fingerprint.
 * Priority:
 * 1) existing cookie (persists per Chrome profile)
 * 2) explicit x-fingerprint header
 * 3) IP address (all browser profiles on same device/network share credits)
 */
export function resolveDemoFingerprint({
  cookieDeviceId,
  headerFingerprint,
  ip,
}: {
  cookieDeviceId?: string;
  headerFingerprint?: string;
  ip?: string;
}) {
  if (cookieDeviceId && cookieDeviceId.trim()) {
    return cookieDeviceId.trim();
  }

  if (headerFingerprint && headerFingerprint.trim()) {
    return headerFingerprint.trim();
  }

  // Fallback: use IP so all profiles on same device/network share the 10-credit pool
  return ip || "unknown-ip";
}

/**
 * Get unified demo tracking across guest and user sessions.
 * Guarantees guest/user records exist, applies monthly reset logic,
 * and uses MAX usage count so users never get extra credits by switching auth/session state.
 */
export async function getUnifiedDemoTracking(
  userId: string | null,
  fingerprint: string,
  ip: string = ""
) {
  // Always ensure the current guest fingerprint has a tracking row.
  let guestTracking = await getGuestDemoTracking(fingerprint, ip);

  // Ensure logged-in users also have user tracking.
  const userTracking = userId ? await getUserDemoTracking(userId) : null;

  // Collect linked guest sessions (for logged-in users) and apply reset logic for safety.
  const linkedGuestTrackings = userId
    ? await prisma.guest_tracking.findMany({ where: { userId } })
    : [];

  const normalizedLinkedGuests = await Promise.all(
    linkedGuestTrackings.map(async (tracking) => {
      if (isNewMonth(tracking.last_used_at, new Date())) {
        return prisma.guest_tracking.update({
          where: { id: tracking.id },
          data: {
            uploads_count: 0,
            last_used_at: new Date(),
          },
        });
      }
      return tracking;
    })
  );

  // Ensure current fingerprint record is included even if not linked yet.
  const allGuestTrackings = [
    guestTracking,
    ...normalizedLinkedGuests.filter((g) => g.id !== guestTracking.id),
  ];

  const guestCount = allGuestTrackings.reduce((maxCount, tracking) => {
    return Math.max(maxCount, tracking.uploads_count);
  }, 0);

  const guestBlocked = allGuestTrackings.some((tracking) => tracking.blocked);
  const userCount = userTracking ? userTracking.uploads_count : 0;
  const unifiedCount = Math.max(guestCount, userCount);

  return {
    unifiedCount,
    guestTracking,
    userTracking,
    blocked: guestBlocked,
    limitReached: unifiedCount >= DEMO_LIMIT,
    remainingCredits: Math.max(0, DEMO_LIMIT - unifiedCount),
  };
}
