import path from "path";
import { ImageStatus } from "../types/image.types";
import { geminiService } from "./gemini.service";
import { logger } from "../utils/logger";
import prisma from "../dbConnection";

interface BatchStageJob {
    imageId: string;
    originalPath: string;
    roomType: string;
    stagingStyle: string;
    customPrompt?: string;
}

export async function processBatchImage(job: BatchStageJob): Promise<void> {
    const { imageId, originalPath, roomType, stagingStyle, customPrompt } = job;

    try {
        await prisma.image.update({
            where: { id: imageId },
            data: { status: ImageStatus.PROCESSING },
        });

        const stagedPath = await geminiService.stageImage(
            originalPath,
            roomType,
            stagingStyle,
            customPrompt
        );

        await prisma.image.update({
            where: { id: imageId },
            data: {
                status: ImageStatus.COMPLETED,
                staged_image_url: stagedPath,
            },
        });

        logger(`Image ${imageId} staged successfully`);
    } catch (error) {
        logger(`Image ${imageId} failed staging`);

        await prisma.image.update({
            where: { id: imageId },
            data: {
                status: ImageStatus.FAILED,
                // failureReason:
                //     error instanceof Error ? error.message : "Unknown error",
            },
        });

        throw error;
    }
}
