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

const fileFilter = (
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const allowedDocMimes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
  const allowedPortfolioMimes = ["image/jpeg", "image/png", "image/webp"];

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

  cb(new Error("Only PDF, JPEG, PNG, and WebP files are allowed"));
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
});

export const uploadPhotographerDocument = upload.single("document");
export const uploadPhotographerOnboardingFiles = upload.fields([
  { name: "drivingLicense", maxCount: 1 },
  { name: "utilityBill", maxCount: 1 },
  { name: "portfolioImages", maxCount: 5 },
]);
