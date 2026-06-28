import dotenv from 'dotenv'
import app from './app';
import prisma from './dbConnection';
import { mongoDb } from './config/mongodb.config';
import { supabaseStorage } from './services/supabaseStorage.service';
import { startCleanupCron } from './cron/cleanupExpiredInvitations';
import { startImageCleanupCron } from './cron/cleanupExpiredImages';
import { startUploadsDiskCleanupCron } from './cron/cleanupUploadsDir';
import processSubscriptionRenewals from './cron/processSubscriptionRenewals';
import { processPendingPurchases } from './services/payment.service';
import { processTeamPaidExtraSeatsDaily } from './services/teams.service';
// Crash-safety: surface unexpected async errors instead of silently dying.
// Logging only; we deliberately do NOT exit to preserve current flow.
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
});

dotenv.config();

const PORT = process.env.PORT || 3003;

// 🔥 ROOT ROUTE (Render-safe)
app.get("/", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Elevated Spaces Backend is running 🚀",
  });
});

// Track intervals/timeouts so we can clear them during graceful shutdown.
const scheduledTimers: Array<NodeJS.Timeout> = [];

const httpServer = app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);

  // Tune Node HTTP timeouts. requestTimeout left at 0 (disabled) by default
  // so long-lived SSE streams aren't killed; override with REQUEST_TIMEOUT_MS.
  httpServer.keepAliveTimeout = Number(process.env.KEEP_ALIVE_TIMEOUT_MS) || 65_000;
  httpServer.headersTimeout = Number(process.env.HEADERS_TIMEOUT_MS) || 66_000;
  httpServer.requestTimeout = Number(process.env.REQUEST_TIMEOUT_MS) || 0;

  // Initialize MongoDB for logging
  try {
    await mongoDb.connect();
    if (mongoDb.isReady()) {
      console.log('MongoDB logging system initialized');
    }
  } catch (err) {
    console.warn('MongoDB logging unavailable:', err);
  }

  // Initialize Supabase bucket
  try {
    await supabaseStorage.initBucket();
    console.log('Supabase Storage initialized');
  } catch (err) {
    console.error('Failed to initialize Supabase Storage:', err);
  }

  // Test DB connection before starting critical services
  try {
    await prisma.$connect();
    console.log('✅ Connected to PostgreSQL database');

    // Only start cron job if database connection succeeds
    startCleanupCron();
    startImageCleanupCron();
    startUploadsDiskCleanupCron();
  } catch (err: any) {
    console.error('❌ Failed to connect to database:', err.message || err);
    console.error('Please verify your DATABASE_URL credentials in .env');
    console.warn('⚠️  Server running but database-dependent services are disabled');
  }

  // Start cron job for processing subscription renewals
  scheduleSubscriptionRenewalsCron();

  // Process pending purchases on startup
  try {
    await processPendingPurchases();
    console.log('Pending purchases processed on startup');
  } catch (err) {
    console.error('Failed to process pending purchases on startup:', err);
  }

  // Reconcile paid extra seats on startup
  try {
    const result = await processTeamPaidExtraSeatsDaily();
    console.log(`[TEAM_SEATS] Startup reconciliation complete: ${result.processed} processed, ${result.failed} failed`);
  } catch (err) {
    console.error('[TEAM_SEATS] Startup reconciliation failed:', err);
  }

  // Schedule pending purchase processing every 5 minutes
  scheduledTimers.push(setInterval(() => {
    processPendingPurchases().catch(err => {
      console.error('Scheduled pending purchase processing failed:', err);
    });
  }, 60 * 1000)); // 5 minutes
});

// --- Graceful shutdown -------------------------------------------------------
let shuttingDown = false;
async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[SHUTDOWN] Received ${signal}. Closing server...`);

  // Stop accepting new connections; existing requests are allowed to finish.
  httpServer.close(() => {
    console.log('[SHUTDOWN] HTTP server closed');
  });

  // Clear background intervals/timeouts we own.
  for (const t of scheduledTimers) {
    try { clearInterval(t as any); clearTimeout(t as any); } catch { /* noop */ }
  }

  // Hard ceiling so a stuck request can't keep us alive forever.
  const forceExitMs = Number(process.env.SHUTDOWN_FORCE_EXIT_MS) || 30_000;
  const forceTimer = setTimeout(() => {
    console.error('[SHUTDOWN] Force-exiting after timeout');
    process.exit(1);
  }, forceExitMs);
  forceTimer.unref();

  try {
    await prisma.$disconnect();
    console.log('[SHUTDOWN] Prisma disconnected');
  } catch (err) {
    console.warn('[SHUTDOWN] Prisma disconnect error:', err);
  }
  try {
    await mongoDb.disconnect();
    console.log('[SHUTDOWN] MongoDB disconnected');
  } catch (err) {
    console.warn('[SHUTDOWN] MongoDB disconnect error:', err);
  }

  console.log('[SHUTDOWN] Clean exit');
  process.exit(0);
}
process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });
process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });

/**
 * Schedules subscription renewals.
 * In production this runs daily at 8 AM UTC.
 * In test mode, SUBSCRIPTION_RENEWAL_TEST_INTERVAL_MINUTES switches it to a short interval.
 */
function scheduleSubscriptionRenewalsCron() {
  const testIntervalMinutes = Number(process.env.SUBSCRIPTION_RENEWAL_TEST_INTERVAL_MINUTES || 0);

  async function runRenewalCycle() {
    console.log(`[CRON] Running subscription renewal processing at ${new Date().toISOString()}`);

    const result = await processSubscriptionRenewals();

    console.log(
      `[CRON] Subscription renewal completed: ${result.processed} processed, ${result.successful} successful, ${result.failed} failed`
    );

    const seatResult = await processTeamPaidExtraSeatsDaily();

    console.log(
      `[CRON] Team paid-seat reconciliation completed: ${seatResult.processed} processed, ${seatResult.failed} failed`
    );
  }

  if (Number.isFinite(testIntervalMinutes) && testIntervalMinutes > 0) {
    const intervalMs = testIntervalMinutes * 60 * 1000;

    console.log(
      `[CRON] Subscription renewals test mode enabled. Running every ${testIntervalMinutes} minute(s).`
    );

    void runRenewalCycle().catch((err) => {
      console.error('[CRON] Initial test renewal processing failed:', err);
    });

    scheduledTimers.push(setInterval(() => {
      void runRenewalCycle().catch((err) => {
        console.error('[CRON] Scheduled test renewal processing failed:', err);
      });
    }, intervalMs));

    return;
  }

  function calculateNextRunTime(): Date {
    const now = new Date();
    // Create a date for 8 AM UTC today
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 8, 0, 0, 0));
    
    // If 8 AM UTC has already passed today, schedule for tomorrow
    if (next <= now) {
      next.setUTCDate(next.getUTCDate() + 1);
    }
    
    return next;
  }

  function scheduleNextRun() {
    const nextRun = calculateNextRunTime();
    const timeUntilNext = nextRun.getTime() - Date.now();
    
    console.log(
      `[CRON] Subscription renewals scheduled for ${nextRun.toISOString()} (in ${Math.round(timeUntilNext / 1000 / 60)} minutes)`
    );
    
    scheduledTimers.push(setTimeout(() => {
      void runRenewalCycle().catch((err) => {
          console.error('[CRON] Scheduled subscription renewal processing failed:', err);
        }).finally(() => {
          // Schedule the next run
          scheduleNextRun();
        });
    }, timeUntilNext));
  }

  // Schedule the first run
  scheduleNextRun();
}
