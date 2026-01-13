import { SimpleQueue } from "../utils/simpleQueue";
import { QUEUE_CONCURRENCY } from "../config/queue.config";
import { processBatchImage } from "../services/image-batch.service";

interface BatchStageJob {
  imageId: string;
  originalPath: string;
  roomType: string;
  stagingStyle: string;
  customPrompt?: string;
}

export const imageQueue = new SimpleQueue<BatchStageJob>(
  QUEUE_CONCURRENCY,
  processBatchImage
);
