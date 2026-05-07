// Higher default throughput for large multi-image staging runs.
// For multi-image batches (5+ images), increase concurrency to enable true parallel processing
// With burst rate limiting, this allows 15-20 images to be staged in parallel
const baseConcurrency = Number(process.env.IMAGE_QUEUE_CONCURRENCY || "15");
export const QUEUE_CONCURRENCY = Number.isFinite(baseConcurrency) && baseConcurrency > 0
	? baseConcurrency
	: 15;
export const BATCH_PROCESSING_ENABLED = process.env.ENABLE_BATCH_PROCESSING !== 'false'; // Split large uploads into 5-image batches
