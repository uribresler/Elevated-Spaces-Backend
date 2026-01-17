import path from "path";
import * as fs from "fs";
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

        // Get staged image as Buffer (optimized - no disk write during processing)
        const stagedImageBuffer = await geminiService.stageImage(
            originalPath,
            roomType,
            stagingStyle,
            customPrompt
        );

        // For batch processing, save to disk (async for better performance)
        const stagedDir = path.join(path.dirname(path.dirname(originalPath)), "staged");
        if (!fs.existsSync(stagedDir)) {
            fs.mkdirSync(stagedDir, { recursive: true });
        }
        const stagedFileName = `staged-${Date.now()}-${imageId}.png`;
        const stagedPath = path.join(stagedDir, stagedFileName);
        await fs.promises.writeFile(stagedPath, stagedImageBuffer);

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
