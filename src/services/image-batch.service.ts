import { ImageStatus } from "../types/image.types";
import { geminiService } from "./gemini.service";
import { logger } from "../utils/logger";
import prisma from "../dbConnection";
import { supabaseStorage } from "./supabaseStorage.service";

interface BatchStageJob {
    imageId: string;
    originalPath: string;
    roomType: string;
    stagingStyle: string;
    customPrompt?: string;
}

const VARIATIONS_PER_IMAGE = Number(process.env.MULTI_STAGE_VARIATIONS || "3");
const MAX_ATTEMPTS_PER_VARIATION = Number(process.env.MULTI_STAGE_MAX_ATTEMPTS || "4");
const RETRY_BACKOFF_BASE_MS = Number(process.env.MULTI_STAGE_RETRY_BACKOFF_MS || "120");
const FIRST_VARIATION_MODEL = "gemini-3.1-flash-image-preview";
const FOLLOWUP_VARIATION_MODEL = "gemini-2.5-flash-image";
const REQUIRE_EXACT_VARIANT_COUNT = String(
    process.env.MULTI_STAGE_REQUIRE_EXACT_VARIANTS || "true"
).toLowerCase() !== "false";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const isQuotaExhaustedError = (error: unknown): boolean => {
    const message = String(error || "").toLowerCase();
    return (
        message.includes("quota exceeded") ||
        message.includes("resource_exhausted") ||
        message.includes("generate_requests_per_model_per_day") ||
        message.includes("limit: 0")
    );
};

export async function processBatchImage(job: BatchStageJob): Promise<void> {
    const { imageId, originalPath, roomType, stagingStyle, customPrompt } = job;
    const jobStartTime = Date.now();
    const fileName = originalPath.split('/').pop() || originalPath.split('\\').pop() || 'unknown';
    logger(`[JOB][${imageId.slice(0, 8)}] START ${fileName.substring(0, 30)} (staging in parallel mode)`);

    try {
        const baseImage = await prisma.image.findUnique({ where: { id: imageId } });
        if (!baseImage) {
            logger(`[JOB][${imageId.slice(0, 8)}] ERROR: Image not found in database`);
            return;
        }

        // Cleanup any previously created sibling variants for this same original so retries replace, not append.
        await prisma.image.deleteMany({
            where: {
                id: { not: imageId },
                original_image_url: baseImage.original_image_url,
                user_id: baseImage.user_id,
                guest_id: baseImage.guest_id,
            },
        });

        await prisma.image.update({
            where: { id: imageId },
            data: {
                status: ImageStatus.PROCESSING,
                staged_image_url: null,
            },
        });

        const generatedVariations: Buffer[] = [];

        // First pass: ask the generator for the full set in one job. This reduces request count and improves batch throughput.
        try {
            const fullSet = await geminiService.stageImageVariations(
                originalPath,
                roomType,
                stagingStyle,
                VARIATIONS_PER_IMAGE,
                customPrompt,
                false
            );
            generatedVariations.push(...fullSet.slice(0, VARIATIONS_PER_IMAGE));
        } catch (firstPassError) {
            logger(`[JOB][${imageId.slice(0, 8)}] Full-set generation fallback: ${String(firstPassError)}`);
        }

        // Recovery pass: fill any missing variants with per-variant calls and model failover.
        while (generatedVariations.length < VARIATIONS_PER_IMAGE) {
            const variationIndex = generatedVariations.length;
            const modelPlan =
                variationIndex === 0
                    ? [FIRST_VARIATION_MODEL, FOLLOWUP_VARIATION_MODEL]
                    : [FOLLOWUP_VARIATION_MODEL, FIRST_VARIATION_MODEL];
            let variationBuffer: Buffer | null = null;

            for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_VARIATION && !variationBuffer; attempt++) {
                for (const variationModel of modelPlan) {
                    try {
                        variationBuffer = await geminiService.stageImageWithModel(
                            originalPath,
                            roomType,
                            stagingStyle,
                            customPrompt,
                            false,
                            variationModel
                        );
                        if (variationBuffer) {
                            break;
                        }
                    } catch (attemptError) {
                        if (isQuotaExhaustedError(attemptError)) {
                            logger(`[JOB][${imageId.slice(0, 8)}] QUOTA EXHAUSTED on variation ${variationIndex + 1}`);
                            continue;
                        }
                    }
                }

                if (!variationBuffer && attempt < MAX_ATTEMPTS_PER_VARIATION) {
                    await delay(RETRY_BACKOFF_BASE_MS * attempt);
                }
            }

            if (!variationBuffer) {
                break;
            }

            generatedVariations.push(variationBuffer);
        }

        const successfulVariants = await Promise.all(
            generatedVariations.map(async (stagedImageBuffer, variationIndex) => {
                const stagedFileName = `staged-${Date.now()}-${imageId}-${variationIndex}.png`;
                const stagedUrl = await supabaseStorage.uploadStagedFromBuffer(
                    stagedImageBuffer,
                    stagedFileName,
                    "image/png"
                );

                return {
                    variationIndex,
                    stagedUrl,
                };
            })
        );

        const completedCount = successfulVariants.length;

        if (completedCount > 0) {
            const [baseVariant, ...otherVariants] = successfulVariants;

            await prisma.image.update({
                where: { id: imageId },
                data: {
                    staged_image_url: baseVariant.stagedUrl,
                    room_type: roomType,
                    staging_style: stagingStyle,
                    prompt: customPrompt || null,
                    status: ImageStatus.PROCESSING,
                },
            });

            if (otherVariants.length > 0) {
                await prisma.image.createMany({
                    data: otherVariants.map((variant) => ({
                        user_id: baseImage.user_id,
                        guest_id: baseImage.guest_id,
                        project_id: baseImage.project_id,
                        original_image_url: baseImage.original_image_url,
                        staged_image_url: variant.stagedUrl,
                        watermarked_preview_url: null,
                        status: ImageStatus.COMPLETED,
                        is_demo: false,
                        room_type: roomType,
                        staging_style: stagingStyle,
                        prompt: customPrompt || null,
                        source: baseImage.source || "user",
                        revisions: 0,
                        max_revisions: baseImage.max_revisions || 3,
                    })),
                });
            }
        }

        if (completedCount === 0 || (REQUIRE_EXACT_VARIANT_COUNT && completedCount < VARIATIONS_PER_IMAGE)) {
            await prisma.image.update({
                where: { id: imageId },
                data: {
                    status: ImageStatus.FAILED,
                },
            });
            throw new Error(
                completedCount === 0
                    ? `All ${VARIATIONS_PER_IMAGE} variations failed for image ${imageId}`
                    : `Incomplete variant set (${completedCount}/${VARIATIONS_PER_IMAGE}) for image ${imageId}`
            );
        }

        await prisma.image.update({
            where: { id: imageId },
            data: {
                status: ImageStatus.COMPLETED,
            },
        });

        const jobElapsed = Math.round((Date.now() - jobStartTime) / 1000);
        logger(`[JOB][${imageId.slice(0, 8)}] DONE ${completedCount}/${VARIATIONS_PER_IMAGE} in ${jobElapsed}s`);
    } catch (error) {
        const jobElapsed = Math.round((Date.now() - jobStartTime) / 1000);
        logger(`[JOB][${imageId.slice(0, 8)}] FAILED after ${jobElapsed}s`);

        await prisma.image.update({
            where: { id: imageId },
            data: {
                status: ImageStatus.FAILED,
            },
        });

        throw error;
    }
}
