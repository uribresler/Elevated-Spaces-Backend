import * as fs from 'fs';
import * as path from 'path';
import { uploadDirs } from '../middlewares/uploadImage';

// Removes stale files from the local uploads/ tree. Originals are uploaded to
// Supabase shortly after multer writes them; the local copy is no longer
// needed once it has aged past UPLOADS_LOCAL_TTL_HOURS (default 24h).
// This cron is additive: it does not change any upload-time flow.

const TTL_HOURS = Number(process.env.UPLOADS_LOCAL_TTL_HOURS) || 24;
const INTERVAL_MS = Number(process.env.UPLOADS_LOCAL_CLEANUP_INTERVAL_MS) || 60 * 60 * 1000;

async function cleanupDir(dir: string, cutoffMs: number): Promise<{ deleted: number; kept: number }> {
  let deleted = 0;
  let kept = 0;
  let entries: fs.Dirent[] = [];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (err: any) {
    if (err?.code === 'ENOENT') return { deleted, kept };
    throw err;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = path.join(dir, entry.name);
    try {
      const stat = await fs.promises.stat(full);
      if (stat.mtimeMs < cutoffMs) {
        await fs.promises.unlink(full);
        deleted++;
      } else {
        kept++;
      }
    } catch (err) {
      console.warn('[UPLOADS_CLEANUP] Failed to inspect/delete', full, err);
    }
  }
  return { deleted, kept };
}

async function runOnce() {
  const cutoff = Date.now() - TTL_HOURS * 60 * 60 * 1000;
  const dirs = [uploadDirs.original, uploadDirs.staged, uploadDirs.generated];

  let totalDeleted = 0;
  let totalKept = 0;
  for (const dir of dirs) {
    try {
      const res = await cleanupDir(dir, cutoff);
      totalDeleted += res.deleted;
      totalKept += res.kept;
    } catch (err) {
      console.error('[UPLOADS_CLEANUP] Error cleaning', dir, err);
    }
  }
  console.log(
    `[UPLOADS_CLEANUP] Deleted ${totalDeleted} stale files, kept ${totalKept} recent (TTL=${TTL_HOURS}h)`
  );
}

export function startUploadsDiskCleanupCron(): NodeJS.Timeout {
  runOnce().catch((err) => {
    console.warn('[UPLOADS_CLEANUP] Initial run failed:', err instanceof Error ? err.message : err);
  });
  const intervalId = setInterval(() => {
    runOnce().catch((err) => {
      console.error('[UPLOADS_CLEANUP] Scheduled run failed:', err instanceof Error ? err.message : err);
    });
  }, INTERVAL_MS);
  console.log(`[UPLOADS_CLEANUP] Local uploads cleanup started (every ${Math.round(INTERVAL_MS / 60000)}m, TTL=${TTL_HOURS}h)`);
  return intervalId;
}
