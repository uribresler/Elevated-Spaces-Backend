import prisma from "../dbConnection";
import { supabaseStorage } from "../services/supabaseStorage.service";

const IMAGE_RETENTION_DAYS = 30;

function getStoragePathFromPublicUrl(url?: string | null): string | null {
  if (!url) return null;

  try {
    const parsed = new URL(url);
    const marker = `/storage/v1/object/public/${process.env.SUPABASE_BUCKET || "elevate-spaces-images"}/`;
    const markerIndex = parsed.pathname.indexOf(marker);
    if (markerIndex >= 0) {
      return parsed.pathname.slice(markerIndex + marker.length);
    }

    const directMarker = "/original/";
    const stagedMarker = "/staged/";
    const watermarkMarker = "/watermarked/";

    const markers = [directMarker, stagedMarker, watermarkMarker];
    for (const item of markers) {
      const idx = parsed.pathname.indexOf(item);
      if (idx >= 0) {
        return parsed.pathname.slice(idx + 1);
      }
    }
  } catch {
    return null;
  }

  return null;
}

async function cleanupExpiredImages() {
  const cutoff = new Date(Date.now() - IMAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const oldImages = await prisma.image.findMany({
    where: {
      created_at: { lt: cutoff },
    },
    select: {
      id: true,
      original_image_url: true,
      staged_image_url: true,
      watermarked_preview_url: true,
    },
    take: 500,
  });

  if (oldImages.length === 0) {
    console.log(`[CRON] Image cleanup: no expired images found at ${new Date().toISOString()}`);
    return;
  }

  let deletedFiles = 0;
  for (const image of oldImages) {
    const paths = [
      getStoragePathFromPublicUrl(image.original_image_url),
      getStoragePathFromPublicUrl(image.staged_image_url),
      getStoragePathFromPublicUrl(image.watermarked_preview_url),
    ].filter((value): value is string => Boolean(value));

    for (const storagePath of paths) {
      const success = await supabaseStorage.deleteImage(storagePath);
      if (success) deletedFiles += 1;
    }
  }

  const ids = oldImages.map((image) => image.id);
  const deleteResult = await prisma.image.deleteMany({
    where: {
      id: { in: ids },
    },
  });

  console.log(
    `[CRON] Image cleanup: deleted ${deleteResult.count} DB rows and ${deletedFiles} storage files at ${new Date().toISOString()}`
  );
}

export function startImageCleanupCron() {
  cleanupExpiredImages().catch((error) => {
    console.warn("[CRON] Initial image cleanup failed:", error instanceof Error ? error.message : error);
  });

  const intervalId = setInterval(() => {
    cleanupExpiredImages().catch((error) => {
      console.error("[CRON] Scheduled image cleanup failed:", error instanceof Error ? error.message : error);
    });
  }, 24 * 60 * 60 * 1000);

  console.log("[CRON] 30-day image cleanup job started (runs every 24 hours)");
  return intervalId;
}
