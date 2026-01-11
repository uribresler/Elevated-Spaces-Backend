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
exports.geminiService = void 0;
const genai_1 = require("@google/genai");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const logger_1 = require("../utils/logger");
const stagingPrompts_1 = require("../utils/stagingPrompts");
const imageErrors_1 = require("../utils/imageErrors");
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 5000;
class GeminiService {
    constructor() {
        this.apiKey = process.env.GEMINI_API_KEY || "";
        if (!this.apiKey) {
            throw new Error("GEMINI_API_KEY is not set in environment variables");
        }
        // Initialize Gemini client
        this.client = new genai_1.GoogleGenAI({ apiKey: this.apiKey });
    }
    /**
     * Calculate delay with exponential backoff and jitter
     */
    calculateDelay(attempt) {
        const exponentialDelay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 500;
        return Math.min(exponentialDelay + jitter, MAX_DELAY_MS);
    }
    /**
     * Check if error is retryable
     */
    isRetryableError(error) {
        if (error instanceof imageErrors_1.ImageProcessingError) {
            const nonRetryableCodes = [
                imageErrors_1.ImageErrorCode.AI_CONTENT_BLOCKED,
                imageErrors_1.ImageErrorCode.AI_QUOTA_EXCEEDED,
            ];
            return !nonRetryableCodes.includes(error.code);
        }
        const errorMessage = error?.message?.toLowerCase() || "";
        const errorStatus = error?.status || error?.code;
        // Rate limits, server errors, timeouts - retryable
        if (errorStatus === 429 || (errorStatus >= 500 && errorStatus < 600)) {
            return true;
        }
        if (errorMessage.includes("timeout") || errorMessage.includes("deadline")) {
            return true;
        }
        if (errorMessage.includes("unavailable") || errorMessage.includes("503")) {
            return true;
        }
        return false;
    }
    /**
     * Execute operation with retry logic
     */
    async executeWithRetry(operation, operationName) {
        let lastError = null;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                (0, logger_1.logger)(`${operationName}: Attempt ${attempt}/${MAX_RETRIES}`);
                return await operation();
            }
            catch (error) {
                lastError = error;
                const errorMsg = error instanceof Error ? error.message : String(error);
                (0, logger_1.logger)(`${operationName}: Attempt ${attempt} failed: ${errorMsg}`);
                if (!this.isRetryableError(error)) {
                    (0, logger_1.logger)(`${operationName}: Non-retryable error, stopping`);
                    throw error instanceof imageErrors_1.ImageProcessingError ? error : (0, imageErrors_1.parseGeminiError)(error);
                }
                if (attempt < MAX_RETRIES) {
                    const delay = this.calculateDelay(attempt);
                    (0, logger_1.logger)(`${operationName}: Waiting ${Math.round(delay)}ms before retry...`);
                    await new Promise((resolve) => setTimeout(resolve, delay));
                }
            }
        }
        (0, logger_1.logger)(`${operationName}: All ${MAX_RETRIES} attempts failed`);
        throw lastError instanceof imageErrors_1.ImageProcessingError ? lastError : (0, imageErrors_1.parseGeminiError)(lastError);
    }
    /**
     * Generate image from text prompt using gemini-3-pro-image-preview
     */
    async generateImage(prompt, outputPath) {
        return this.executeWithRetry(async () => {
            (0, logger_1.logger)(`Generating image with prompt: ${prompt}`);
            let imageData = null;
            const stream = await this.client.models.generateContentStream({
                model: "gemini-3-pro-image-preview",
                contents: [
                    {
                        role: "user",
                        parts: [{ text: prompt }],
                    },
                ],
                config: {
                    responseModalities: ["IMAGE"],
                    temperature: 1.0,
                },
            });
            for await (const chunk of stream) {
                if (chunk.candidates) {
                    for (const candidate of chunk.candidates) {
                        if (candidate.content?.parts) {
                            for (const part of candidate.content.parts) {
                                if (part.inlineData?.data) {
                                    imageData = Buffer.from(part.inlineData.data, "base64");
                                }
                            }
                        }
                    }
                }
            }
            if (!imageData) {
                throw new imageErrors_1.ImageProcessingError(imageErrors_1.ImageErrorCode.AI_NO_IMAGE_GENERATED, imageErrors_1.ErrorMessages[imageErrors_1.ImageErrorCode.AI_NO_IMAGE_GENERATED], 500);
            }
            const dir = path.dirname(outputPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(outputPath, imageData);
            (0, logger_1.logger)(`Image generated successfully at: ${outputPath}`);
            return outputPath;
        }, "generateImage");
    }
    /**
     * Stage/enhance a real estate image with AI
     * Uses gemini-3-pro-image-preview for actual image generation
     */
    async stageImage(inputImagePath, roomType, stagingStyle, prompt) {
        const imageBuffer = fs.readFileSync(inputImagePath);
        const base64Image = imageBuffer.toString("base64");
        const mimeType = this.getMimeType(inputImagePath);
        // Use specialized prompt if available, else default
        let stagingPrompt;
        if (prompt) {
            stagingPrompt = prompt;
        }
        else if (stagingPrompts_1.STAGING_STYLE_PROMPTS[stagingStyle?.toLowerCase()]) {
            stagingPrompt = stagingPrompts_1.STAGING_STYLE_PROMPTS[stagingStyle.toLowerCase()](roomType);
        }
        else {
            stagingPrompt = (0, stagingPrompts_1.DEFAULT_STAGING_PROMPT)(roomType, stagingStyle);
        }
        return this.executeWithRetry(async () => {
            (0, logger_1.logger)(`Staging image: ${inputImagePath}, Room: ${roomType}, Style: ${stagingStyle}`);
            let stagedImageData = null;
            const stream = await this.client.models.generateContentStream({
                model: "gemini-3-pro-image-preview",
                contents: [
                    {
                        role: "user",
                        parts: [
                            {
                                inlineData: {
                                    mimeType: mimeType,
                                    data: base64Image,
                                },
                            },
                            { text: stagingPrompt },
                        ],
                    },
                ],
                config: {
                    responseModalities: ["IMAGE"],
                    temperature: 1.0,
                },
            });
            for await (const chunk of stream) {
                if (chunk.candidates) {
                    for (const candidate of chunk.candidates) {
                        if (candidate.content?.parts) {
                            for (const part of candidate.content.parts) {
                                if (part.inlineData?.data) {
                                    stagedImageData = Buffer.from(part.inlineData.data, "base64");
                                }
                            }
                        }
                    }
                }
            }
            if (!stagedImageData) {
                throw new imageErrors_1.ImageProcessingError(imageErrors_1.ImageErrorCode.AI_NO_IMAGE_GENERATED, imageErrors_1.ErrorMessages[imageErrors_1.ImageErrorCode.AI_NO_IMAGE_GENERATED], 500, "The AI could not generate a staged version of this image. Try with a clearer photo.");
            }
            const stagedDir = path.join(path.dirname(path.dirname(inputImagePath)), "staged");
            if (!fs.existsSync(stagedDir)) {
                fs.mkdirSync(stagedDir, { recursive: true });
            }
            const outputFileName = `staged-${Date.now()}.png`;
            const outputPath = path.join(stagedDir, outputFileName);
            fs.writeFileSync(outputPath, stagedImageData);
            (0, logger_1.logger)(`Staged image saved to: ${outputPath}`);
            return outputPath;
        }, "stageImage");
    }
    /**
     * Analyze image to understand room characteristics
     * Uses text response mode for analysis
     */
    async analyzeImage(imagePath) {
        const imageBuffer = fs.readFileSync(imagePath);
        const base64Image = imageBuffer.toString("base64");
        const mimeType = this.getMimeType(imagePath);
        return this.executeWithRetry(async () => {
            (0, logger_1.logger)(`Analyzing image: ${imagePath}`);
            let analysisText = "";
            const stream = await this.client.models.generateContentStream({
                model: "gemini-3-pro-image-preview",
                contents: [
                    {
                        role: "user",
                        parts: [
                            {
                                inlineData: {
                                    mimeType: mimeType,
                                    data: base64Image,
                                },
                            },
                            {
                                text: `Analyze this interior/property image and provide JSON response with:
              {
                "roomType": "bedroom/kitchen/living-room/etc",
                "features": ["array", "of", "features"],
                "suggestedStyles": ["modern", "scandinavian", "traditional"],
                "currentCondition": "empty/furnished/needs-staging",
                "recommendations": "staging recommendations"
              }
              
              Only respond with valid JSON, no other text.`,
                            },
                        ],
                    },
                ],
                config: {
                    responseModalities: ["TEXT"],
                    temperature: 0.7,
                },
            });
            for await (const chunk of stream) {
                if (chunk.candidates) {
                    for (const candidate of chunk.candidates) {
                        if (candidate.content?.parts) {
                            for (const part of candidate.content.parts) {
                                if (part.text) {
                                    analysisText += part.text;
                                }
                            }
                        }
                    }
                }
            }
            const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
            const analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
            (0, logger_1.logger)(`Image analysis complete: ${JSON.stringify(analysis)}`);
            return analysis;
        }, "analyzeImage");
    }
    /**
     * Get MIME type from file extension
     */
    getMimeType(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".gif": "image/gif",
            ".webp": "image/webp",
            ".heic": "image/heic",
            ".jfif": "image/jfif",
        };
        return mimeTypes[ext] || "image/jpeg";
    }
}
exports.geminiService = new GeminiService();
