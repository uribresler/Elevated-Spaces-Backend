import multer from "multer";
import * as path from "path";
import * as fs from "fs";

const baseUploadsDir = path.join(process.cwd(), "uploads");
const originalDir = path.join(baseUploadsDir, "original");
const stagedDir = path.join(baseUploadsDir, "staged");
const generatedDir = path.join(baseUploadsDir, "generated");

// Create directories if they don't exist
[originalDir, stagedDir, generatedDir].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, originalDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `upload-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

// File filter - only allow images
const fileFilter = (
  req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const allowedMimes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only image files are allowed (JPEG, PNG, GIF, WebP)"));
  }
};

// Multer upload instance
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
});

// Export middleware for single image upload
export const uploadImage = upload.single("file");

// Export middleware for multiple image uploads (for future use)
export const uploadImages = (maxCount: number = 5) => upload.array("files", maxCount);

// Export directory paths for use in other modules
export const uploadDirs = {
  base: baseUploadsDir,
  original: originalDir,
  staged: stagedDir,
  generated: generatedDir,
};
