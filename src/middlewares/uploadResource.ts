import multer from "multer";
import os from "os";
import path from "path";
import fs from "fs";

// Stream resource uploads to disk instead of buffering them in RAM. With
// memoryStorage a single 200 MB PDF + Node baseline + Prisma easily breaches
// the 512 MB available on small hosts; with diskStorage the per-request
// memory cost is a few MB regardless of file size, so the same workload runs
// comfortably on a Render Starter-class container.
//
// The file is read back into a Buffer in the resource service (so it can be
// written to the `pdf` bytea column unchanged) and the temp file is cleaned
// up there. If the request errors before the handler runs, multer leaves the
// temp file behind — the OS tmp dir is cleared on container restart.
const UPLOAD_TMP_DIR = path.join(os.tmpdir(), "elevate-resource-uploads");
try {
  fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
} catch {
  // Falls back to os.tmpdir() if mkdir races / fails; multer handles that.
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_TMP_DIR),
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^\w.\-]/g, "_");
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: {
    // 75 MB covers any reasonable PDF / short video. Going higher just
    // invites people to upload uncompressed footage that we'd then re-stream
    // through Postgres on every fetch.
    fileSize: 75 * 1024 * 1024,
  },
});

export const uploadResourceFiles = upload.fields([
  { name: "pdf", maxCount: 1 },
]);

export default uploadResourceFiles;
