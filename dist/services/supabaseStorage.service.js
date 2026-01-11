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
exports.supabaseStorage = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const logger_1 = require("../utils/logger");
const imageErrors_1 = require("../utils/imageErrors");
class SupabaseStorageService {
    constructor() {
        this.bucketName = "elevate-spaces-images";
        this.bucketInitialized = false;
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !supabaseServiceKey) {
            throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
        }
        this.client = (0, supabase_js_1.createClient)(supabaseUrl, supabaseServiceKey);
    }
    /**
     * Initialize bucket if it doesn't exist (called automatically before uploads)
     */
    async ensureBucketExists() {
        if (this.bucketInitialized)
            return;
        try {
            const { data: buckets, error: listError } = await this.client.storage.listBuckets();
            if (listError) {
                (0, logger_1.logger)(`Error listing buckets: ${listError.message}`);
                return;
            }
            const bucketExists = buckets?.some((b) => b.name === this.bucketName);
            if (!bucketExists) {
                (0, logger_1.logger)(`Bucket '${this.bucketName}' not found, creating...`);
                const { error } = await this.client.storage.createBucket(this.bucketName, {
                    public: true,
                    fileSizeLimit: 10 * 1024 * 1024, // 10MB
                    allowedMimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
                });
                if (error) {
                    (0, logger_1.logger)(`Error creating bucket: ${error.message}`);
                }
                else {
                    (0, logger_1.logger)(`Bucket '${this.bucketName}' created successfully`);
                    this.bucketInitialized = true;
                }
            }
            else {
                (0, logger_1.logger)(`Bucket '${this.bucketName}' exists`);
                this.bucketInitialized = true;
            }
        }
        catch (error) {
            (0, logger_1.logger)(`Error initializing bucket: ${error}`);
        }
    }
    /**
     * Initialize bucket if it doesn't exist (legacy - use ensureBucketExists)
     */
    async initBucket() {
        return this.ensureBucketExists();
    }
    /**
     * Upload original image to Supabase Storage
     * @throws ImageProcessingError if upload fails
     */
    async uploadOriginal(localFilePath) {
        try {
            // Ensure bucket exists before uploading
            await this.ensureBucketExists();
            const fileName = path.basename(localFilePath);
            const fileBuffer = fs.readFileSync(localFilePath);
            const mimeType = this.getMimeType(localFilePath);
            const storagePath = `original/${fileName}`;
            const { data, error } = await this.client.storage
                .from(this.bucketName)
                .upload(storagePath, fileBuffer, {
                contentType: mimeType,
                upsert: true,
            });
            if (error) {
                (0, logger_1.logger)(`Error uploading original image: ${error.message}`);
                throw new imageErrors_1.ImageProcessingError(imageErrors_1.ImageErrorCode.STORAGE_UPLOAD_FAILED, imageErrors_1.ErrorMessages[imageErrors_1.ImageErrorCode.STORAGE_UPLOAD_FAILED], 500, `Original image upload failed: ${error.message}`);
            }
            // Get public URL
            const { data: publicUrl } = this.client.storage
                .from(this.bucketName)
                .getPublicUrl(storagePath);
            (0, logger_1.logger)(`Original image uploaded: ${publicUrl.publicUrl}`);
            return publicUrl.publicUrl;
        }
        catch (error) {
            (0, logger_1.logger)(`Error uploading original image: ${error}`);
            if (error instanceof imageErrors_1.ImageProcessingError) {
                throw error;
            }
            throw new imageErrors_1.ImageProcessingError(imageErrors_1.ImageErrorCode.STORAGE_UPLOAD_FAILED, imageErrors_1.ErrorMessages[imageErrors_1.ImageErrorCode.STORAGE_UPLOAD_FAILED], 500, error instanceof Error ? error.message : undefined);
        }
    }
    /**
     * Upload staged image to Supabase Storage
     * @throws ImageProcessingError if upload fails
     */
    async uploadStaged(localFilePath) {
        try {
            // Ensure bucket exists before uploading
            await this.ensureBucketExists();
            const fileName = path.basename(localFilePath);
            const fileBuffer = fs.readFileSync(localFilePath);
            const mimeType = this.getMimeType(localFilePath);
            const storagePath = `staged/${fileName}`;
            const { data, error } = await this.client.storage
                .from(this.bucketName)
                .upload(storagePath, fileBuffer, {
                contentType: mimeType,
                upsert: true,
            });
            if (error) {
                (0, logger_1.logger)(`Error uploading staged image: ${error.message}`);
                throw new imageErrors_1.ImageProcessingError(imageErrors_1.ImageErrorCode.STORAGE_UPLOAD_FAILED, imageErrors_1.ErrorMessages[imageErrors_1.ImageErrorCode.STORAGE_UPLOAD_FAILED], 500, `Staged image upload failed: ${error.message}`);
            }
            // Get public URL
            const { data: publicUrl } = this.client.storage
                .from(this.bucketName)
                .getPublicUrl(storagePath);
            (0, logger_1.logger)(`Staged image uploaded: ${publicUrl.publicUrl}`);
            return publicUrl.publicUrl;
        }
        catch (error) {
            (0, logger_1.logger)(`Error uploading staged image: ${error}`);
            if (error instanceof imageErrors_1.ImageProcessingError) {
                throw error;
            }
            throw new imageErrors_1.ImageProcessingError(imageErrors_1.ImageErrorCode.STORAGE_UPLOAD_FAILED, imageErrors_1.ErrorMessages[imageErrors_1.ImageErrorCode.STORAGE_UPLOAD_FAILED], 500, error instanceof Error ? error.message : undefined);
        }
    }
    /**
     * Upload both original and staged images after successful processing
     * Throws ImageProcessingError if either upload fails
     */
    async uploadImagePair(originalLocalPath, stagedLocalPath) {
        try {
            const [originalUrl, stagedUrl] = await Promise.all([
                this.uploadOriginal(originalLocalPath),
                this.uploadStaged(stagedLocalPath),
            ]);
            return { originalUrl, stagedUrl };
        }
        catch (error) {
            (0, logger_1.logger)(`Error uploading image pair: ${error}`);
            if (error instanceof imageErrors_1.ImageProcessingError) {
                throw error;
            }
            throw new imageErrors_1.ImageProcessingError(imageErrors_1.ImageErrorCode.STORAGE_UPLOAD_FAILED, imageErrors_1.ErrorMessages[imageErrors_1.ImageErrorCode.STORAGE_UPLOAD_FAILED], 500, error instanceof Error ? error.message : undefined);
        }
    }
    /**
     * Delete local files after successful upload to Supabase
     */
    cleanupLocalFiles(...filePaths) {
        for (const filePath of filePaths) {
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    (0, logger_1.logger)(`Deleted local file: ${filePath}`);
                }
            }
            catch (error) {
                (0, logger_1.logger)(`Error deleting local file ${filePath}: ${error}`);
            }
        }
    }
    /**
     * Delete image from Supabase Storage
     */
    async deleteImage(storagePath) {
        try {
            const { error } = await this.client.storage
                .from(this.bucketName)
                .remove([storagePath]);
            if (error) {
                (0, logger_1.logger)(`Error deleting image: ${error.message}`);
                return false;
            }
            return true;
        }
        catch (error) {
            (0, logger_1.logger)(`Error deleting image: ${error}`);
            return false;
        }
    }
    /**
     * List recent uploads from Supabase Storage
     * Returns paired original and staged images
     */
    async listRecentUploads(limit = 10) {
        try {
            await this.ensureBucketExists();
            // Get files from both folders
            const [originalResult, stagedResult] = await Promise.all([
                this.client.storage.from(this.bucketName).list("original", {
                    limit: limit * 2,
                    sortBy: { column: "created_at", order: "desc" },
                }),
                this.client.storage.from(this.bucketName).list("staged", {
                    limit: limit * 2,
                    sortBy: { column: "created_at", order: "desc" },
                }),
            ]);
            const originalFiles = originalResult.data || [];
            const stagedFiles = stagedResult.data || [];
            // Build URLs for files
            const getPublicUrl = (folder, filename) => {
                const { data } = this.client.storage
                    .from(this.bucketName)
                    .getPublicUrl(`${folder}/${filename}`);
                return data.publicUrl;
            };
            // Match original with staged based on timestamp proximity (within 5 minutes)
            const pairedUploads = [];
            const processedStaged = new Set();
            for (const original of originalFiles) {
                if (!original.name || original.name === ".emptyFolderPlaceholder")
                    continue;
                const originalCreatedAt = original.created_at || new Date().toISOString();
                // Find matching staged file (within 5 minutes)
                const matchingStaged = stagedFiles.find((staged) => {
                    if (!staged.name || staged.name === ".emptyFolderPlaceholder")
                        return false;
                    if (processedStaged.has(staged.name))
                        return false;
                    const stagedCreatedAt = staged.created_at || new Date().toISOString();
                    const timeDiff = Math.abs(new Date(stagedCreatedAt).getTime() - new Date(originalCreatedAt).getTime());
                    return timeDiff < 300000; // 5 minutes
                });
                pairedUploads.push({
                    original: {
                        filename: original.name,
                        url: getPublicUrl("original", original.name),
                        createdAt: originalCreatedAt,
                    },
                    staged: matchingStaged
                        ? {
                            filename: matchingStaged.name,
                            url: getPublicUrl("staged", matchingStaged.name),
                            createdAt: matchingStaged.created_at || new Date().toISOString(),
                        }
                        : null,
                    createdAt: originalCreatedAt,
                });
                if (matchingStaged) {
                    processedStaged.add(matchingStaged.name);
                }
            }
            return {
                uploads: pairedUploads.slice(0, limit),
                total: pairedUploads.length,
            };
        }
        catch (error) {
            (0, logger_1.logger)(`Error listing recent uploads: ${error}`);
            return { uploads: [], total: 0 };
        }
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
// Export singleton instance
exports.supabaseStorage = new SupabaseStorageService();
