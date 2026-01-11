import { Router } from "express";
import { generateImage, getRecentUploads, analyzeImage } from "../controllers/image.controller";
import { uploadImage } from "../middlewares/uploadImage";

const router = Router();

// Get recent uploads (local storage)
router.get("/recent", getRecentUploads);

// Generate/stage an image using AI
router.post("/generate", uploadImage, generateImage);

// Analyze an image to get room type and suggestions
router.post("/analyze", uploadImage, analyzeImage);

export default router;
