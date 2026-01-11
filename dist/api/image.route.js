"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const image_controller_1 = require("../controllers/image.controller");
const uploadImage_1 = require("../middlewares/uploadImage");
const router = (0, express_1.Router)();
// Get recent uploads (local storage)
router.get("/recent", image_controller_1.getRecentUploads);
// Generate/stage an image using AI
router.post("/generate", uploadImage_1.uploadImage, image_controller_1.generateImage);
// Analyze an image to get room type and suggestions
router.post("/analyze", uploadImage_1.uploadImage, image_controller_1.analyzeImage);
exports.default = router;
