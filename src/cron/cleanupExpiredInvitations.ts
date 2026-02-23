import prisma from "../dbConnection";
import { invite_status } from "@prisma/client";

/**
 * Cleans up expired pending invitations (older than 24 hours)
 */
async function cleanupExpiredInvitations() {
    try {
        // Calculate the date 24 hours ago
        const oneDayAgo = new Date(Date.now() - 60 * 1000);

        // Find and delete pending invitations that expired more than 24 hours ago
        const result = await prisma.team_invites.deleteMany({
            where: {
                status: invite_status.PENDING,
                expires_at: {
                    lt: oneDayAgo, // expires_at is less than (before) 24 hours ago
                },
            },
        });

        if (result.count > 0) {
            console.log(
                `[CRON] Cleanup: Deleted ${result.count} expired pending invitations at ${new Date().toISOString()}`
            );
        } else {
            console.log(
                `[CRON] Cleanup: No expired pending invitations found at ${new Date().toISOString()}`
            );
        }

        return result;
    } catch (error) {
        console.error(
            `[CRON] Error cleaning up expired invitations: ${error instanceof Error ? error.message : error}`
        );
        throw error;
    }
}

/**
 * Starts the cron job that runs cleanup every 24 hours
 */
export function startCleanupCron() {
    // Run immediately on startup
    cleanupExpiredInvitations();

    // Run every 24 hours (24 * 60 * 60 * 1000 milliseconds)
    const CRON_INTERVAL = 24 * 60 * 60 * 1000;
    const intervalId = setInterval(() => {
        cleanupExpiredInvitations();
    }, CRON_INTERVAL);

    console.log("[CRON] Expired invitations cleanup job started (runs every 24 hours)");

    // Return interval ID in case we need to stop it later
    return intervalId;
}

/**
 * Stops the cron job
 */
export function stopCleanupCron(intervalId: NodeJS.Timeout) {
    clearInterval(intervalId);
    console.log("[CRON] Expired invitations cleanup job stopped");
}
