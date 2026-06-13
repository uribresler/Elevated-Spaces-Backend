import multer from "multer";
import * as fs from "fs";
import * as path from "path";
const baseUploadsDir = path.join(process.cwd(), "uploads");
const documentsDir = path.join(baseUploadsDir, "documents");
const portfolioDir = path.join(baseUploadsDir, "photographer-portfolio");
if (!fs.existsSync(documentsDir)) {
  fs.mkdirSync(documentsDir, { recursive: true });
}

if (!fs.existsSync(portfolioDir)) {
  fs.mkdirSync(portfolioDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, file, cb) => {
    if (file.fieldname === "portfolioImages") {
      cb(null, portfolioDir);
      return;
    }
    cb(null, documentsDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    if (file.fieldname === "portfolioImages") {
      cb(null, `photographer-portfolio-${uniqueSuffix}${path.extname(file.originalname)}`);
      return;
    }
    cb(null, `photographer-doc-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const allowedDocMimes = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const allowedPortfolioMimes = ["image/jpeg", "image/png", "image/webp"];

const fileFilter = (
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  if (file.fieldname === "portfolioImages") {
    if (allowedPortfolioMimes.includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error("Portfolio images must be JPEG, PNG, or WebP"));
    return;
  }

  if (allowedDocMimes.includes(file.mimetype)) {
    cb(null, true);
    return;
  }

  cb(new Error("Verification documents must be PDF, DOC/DOCX, or an image (JPEG/PNG/WebP/GIF/HEIC)"));
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 30 * 1024 * 1024,
  },
});

export const uploadPhotographerDocument = upload.single("document");
export const uploadPhotographerOnboardingFiles = upload.fields([
  { name: "verificationDocuments", maxCount: 5 },
  { name: "portfolioImages", maxCount: 5 },
]);
