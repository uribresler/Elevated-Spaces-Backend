"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRecentUploads = getRecentUploads;
exports.generateImage = generateImage;
exports.analyzeImage = analyzeImage;
const fs = __importStar(require("fs"));
const gemini_service_1 = require("../services/gemini.service");
const supabaseStorage_service_1 = require("../services/supabaseStorage.service");
const logger_1 = require("../utils/logger");
const imageErrors_1 = require("../utils/imageErrors");
/**
 * Get recent uploads from Supabase Storage
 */
async function getRecentUploads(req, res) {
    try {
        const { limit = 10 } = req.query;
        const maxLimit = Math.min(Number(limit), 50); // Cap at 50
        // Fetch from Supabase storage
        const result = await supabaseStorage_service_1.supabaseStorage.listRecentUploads(maxLimit);
        res.status(200).json({
            success: true,
            data: {
                uploads: result.uploads,
                total: result.total,
                limit: maxLimit,
                storage: "supabase",
            },
        });
    }
    catch (error) {
        (0, logger_1.logger)(`Error getting recent uploads: ${error}`);
        res.status(500).json({
            success: false,
            error: {
                code: imageErrors_1.ImageErrorCode.UNKNOWN_ERROR,
                message: "Failed to retrieve recent uploads. Please try again.",
                details: error instanceof Error ? error.message : undefined,
            },
        });
    }
}
async function generateImage(req, res) {
    let inputImagePath = null;
    let stagedImagePath = null;
    try {
        // ============================================
        // VALIDATION: Check if file was uploaded
        // ============================================
        if (!req.file) {
            res.status(400).json({
                success: false,
                error: {
                    code: imageErrors_1.ImageErrorCode.NO_FILE_PROVIDED,
                    message: imageErrors_1.ErrorMessages[imageErrors_1.ImageErrorCode.NO_FILE_PROVIDED],
                },
            });
            return;
        }
        inputImagePath = req.file.path;
        // Validate file exists and is readable
        if (!fs.existsSync(inputImagePath)) {
            res.status(400).json({
                success: false,
                error: {
                    code: imageErrors_1.ImageErrorCode.FILE_READ_ERROR,
                    message: imageErrors_1.ErrorMessages[imageErrors_1.ImageErrorCode.FILE_READ_ERROR],
                },
            });
            return;
        }
        // ============================================
        // VALIDATION: Check file size (10MB max)
        // ============================================
        const stats = fs.statSync(inputImagePath);
        const maxSize = 10 * 1024 * 1024; // 10MB
        if (stats.size > maxSize) {
            fs.unlinkSync(inputImagePath);
            res.status(400).json({
                success: false,
                error: {
                    code: imageErrors_1.ImageErrorCode.FILE_TOO_LARGE,
                    message: imageErrors_1.ErrorMessages[imageErrors_1.ImageErrorCode.FILE_TOO_LARGE],
                    details: `File size: ${(stats.size / 1024 / 1024).toFixed(2)}MB. Maximum: 10MB`,
                },
            });
            return;
        }
        // ============================================
        // VALIDATION: Extract and validate parameters
        // ============================================
        const { prompt, roomType = "living-room", stagingStyle = "modern", keepLocalFiles = false, } = req.body;
        // Validate room type
        if (!imageErrors_1.VALID_ROOM_TYPES.includes(roomType.toLowerCase())) {
            res.status(400).json({
                success: false,
                error: {
                    code: imageErrors_1.ImageErrorCode.INVALID_ROOM_TYPE,
                    message: imageErrors_1.ErrorMessages[imageErrors_1.ImageErrorCode.INVALID_ROOM_TYPE],
                    details: `Valid room types: ${imageErrors_1.VALID_ROOM_TYPES.join(", ")}`,
                },
            });
            return;
        }
        // Validate staging style
        if (!imageErrors_1.VALID_STAGING_STYLES.includes(stagingStyle.toLowerCase())) {
            res.status(400).json({
                success: false,
                error: {
                    code: imageErrors_1.ImageErrorCode.INVALID_STAGING_STYLE,
                    message: imageErrors_1.ErrorMessages[imageErrors_1.ImageErrorCode.INVALID_STAGING_STYLE],
                    details: `Valid styles: ${imageErrors_1.VALID_STAGING_STYLES.join(", ")}`,
                },
            });
            return;
        }
        (0, logger_1.logger)(`Processing image: roomType=${roomType}, style=${stagingStyle}`);
        // ============================================
        // AI PROCESSING: Stage the image
        // (Retry logic with fallback models handled by geminiService)
        // ============================================
        try {
            (0, logger_1.logger)("Starting AI staging...");
            stagedImagePath = await gemini_service_1.geminiService.stageImage(inputImagePath, roomType.toLowerCase(), stagingStyle.toLowerCase(), prompt);
            (0, logger_1.logger)("AI processing complete. Uploading to storage...");
        }
        catch (aiError) {
            (0, logger_1.logger)(`AI staging failed: ${aiError instanceof Error ? aiError.message : aiError}`);
            if (aiError instanceof imageErrors_1.ImageProcessingError) {
                res.status(aiError.statusCode).json(aiError.toJSON());
            }
            else {
                res.status(500).json({
                    success: false,
                    error: {
                        code: imageErrors_1.ImageErrorCode.AI_PROCESSING_FAILED,
                        message: imageErrors_1.ErrorMessages[imageErrors_1.ImageErrorCode.AI_PROCESSING_FAILED],
                        details: aiError instanceof Error ? aiError.message : undefined,
                    },
                });
            }
            return;
        }
        // Verify staged image was created
        if (!stagedImagePath || !fs.existsSync(stagedImagePath)) {
            res.status(500).json({
                success: false,
                error: {
                    code: imageErrors_1.ImageErrorCode.AI_NO_IMAGE_GENERATED,
                    message: imageErrors_1.ErrorMessages[imageErrors_1.ImageErrorCode.AI_NO_IMAGE_GENERATED],
                },
            });
            return;
        }
        // ============================================
        // STORAGE: Upload to Supabase
        // ============================================
        let originalUrl = null;
        let stagedUrl = null;
        try {
            const result = await supabaseStorage_service_1.supabaseStorage.uploadImagePair(inputImagePath, stagedImagePath);
            originalUrl = result.originalUrl;
            stagedUrl = result.stagedUrl;
        }
        catch (storageError) {
            const parsedError = (0, imageErrors_1.parseStorageError)(storageError);
            res.status(parsedError.statusCode).json(parsedError.toJSON());
            return;
        }
        // Check if uploads were successful
        if (!originalUrl || !stagedUrl) {
            res.status(500).json({
                success: false,
                error: {
                    code: imageErrors_1.ImageErrorCode.STORAGE_UPLOAD_FAILED,
                    message: imageErrors_1.ErrorMessages[imageErrors_1.ImageErrorCode.STORAGE_UPLOAD_FAILED],
                    details: !originalUrl
                        ? "Failed to upload original image"
                        : "Failed to upload staged image",
                },
            });
            return;
        }
        // ============================================
        // CLEANUP: Remove local files if requested
        // ============================================
        if (!keepLocalFiles && inputImagePath && stagedImagePath) {
            supabaseStorage_service_1.supabaseStorage.cleanupLocalFiles(inputImagePath, stagedImagePath);
        }
        // ============================================
        // SUCCESS: Return the result
        // ============================================
        (0, logger_1.logger)("Image staging completed successfully");
        res.status(200).json({
            success: true,
            message: "Image staged successfully! Your virtually staged image is ready.",
            data: {
                originalImageUrl: originalUrl,
                stagedImageUrl: stagedUrl,
                roomType,
                stagingStyle,
                prompt: prompt || null,
                storage: "supabase",
            },
        });
    }
    catch (error) {
        // ============================================
        // CATCH-ALL: Handle unexpected errors
        // ============================================
        (0, logger_1.logger)(`Unexpected error in generateImage: ${error}`);
        // Clean up any uploaded files on error
        if (inputImagePath && fs.existsSync(inputImagePath)) {
            try {
                fs.unlinkSync(inputImagePath);
            }
            catch (cleanupError) {
                (0, logger_1.logger)(`Failed to cleanup input file: ${cleanupError}`);
            }
        }
        if (error instanceof imageErrors_1.ImageProcessingError) {
            res.status(error.statusCode).json(error.toJSON());
        }
        else {
            res.status(500).json({
                success: false,
                error: {
                    code: imageErrors_1.ImageErrorCode.UNKNOWN_ERROR,
                    message: imageErrors_1.ErrorMessages[imageErrors_1.ImageErrorCode.UNKNOWN_ERROR],
                    details: error instanceof Error ? error.message : undefined,
                },
            });
        }
    }
}
/**
 * Analyze an image to get room details and suggestions
 */
async function analyzeImage(req, res) {
    try {
        if (!req.file) {
            res.status(400).json({
                success: false,
                error: {
                    code: imageErrors_1.ImageErrorCode.NO_FILE_PROVIDED,
                    message: imageErrors_1.ErrorMessages[imageErrors_1.ImageErrorCode.NO_FILE_PROVIDED],
                },
            });
            return;
        }
        const inputImagePath = req.file.path;
        try {
            const analysis = await gemini_service_1.geminiService.analyzeImage(inputImagePath);
            res.status(200).json({
                success: true,
                message: "Image analyzed successfully",
                data: {
                    analysis,
                    validRoomTypes: imageErrors_1.VALID_ROOM_TYPES,
                    validStyles: imageErrors_1.VALID_STAGING_STYLES,
                },
            });
        }
        catch (aiError) {
            if (aiError instanceof imageErrors_1.ImageProcessingError) {
                res.status(aiError.statusCode).json(aiError.toJSON());
            }
            else {
                res.status(500).json({
                    success: false,
                    error: {
                        code: imageErrors_1.ImageErrorCode.AI_PROCESSING_FAILED,
                        message: "Failed to analyze the image. Please try again.",
                        details: aiError instanceof Error ? aiError.message : undefined,
                    },
                });
            }
        }
        finally {
            // Clean up uploaded file
            if (fs.existsSync(inputImagePath)) {
                fs.unlinkSync(inputImagePath);
            }
        }
    }
    catch (error) {
        (0, logger_1.logger)(`Error analyzing image: ${error}`);
        res.status(500).json({
            success: false,
            error: {
                code: imageErrors_1.ImageErrorCode.UNKNOWN_ERROR,
                message: imageErrors_1.ErrorMessages[imageErrors_1.ImageErrorCode.UNKNOWN_ERROR],
                details: error instanceof Error ? error.message : undefined,
            },
        });
    }
}
