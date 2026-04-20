import multer from "multer";
import path from "path";
import fs from "fs";
import { Request } from "express";

const messageUploadsDir = path.join(process.cwd(), "uploads", "messages");
if (!fs.existsSync(messageUploadsDir)) {
  fs.mkdirSync(messageUploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, messageUploadsDir),
  filename: (_req, file, cb) => {
    const timestamp = Date.now();
    const safeName = file.originalname.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9._-]/g, "");
    cb(null, `${timestamp}-${safeName}`);
  },
});

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function fileFilter(_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  if (allowedMimeTypes.has(file.mimetype)) {
    cb(null, true);
    return;
  }
  cb(new Error("Unsupported file type for chat attachment"));
}

export const uploadChatAttachments = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 8 * 1024 * 1024,
    files: 8,
  },
}).array("attachments", 8);
