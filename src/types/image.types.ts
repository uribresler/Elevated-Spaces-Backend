export enum ImageStatus {
    PENDING = "PENDING",
    PROCESSING = "PROCESSING",
    COMPLETED = "COMPLETED",
    FAILED = "FAILED",
}

export interface UploadedImageJob {
    imageId: string;
    originalPath: string;
    userId: string;
}
