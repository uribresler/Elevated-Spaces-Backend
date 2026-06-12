type JobHandler<T> = (job: T) => Promise<void>;

// Thrown when the queue backlog exceeds maxQueueSize. Callers should respond
// with HTTP 503 (or equivalent) so clients back off instead of piling up.
export class QueueFullError extends Error {
    constructor(public readonly queued: number, public readonly maxQueueSize: number) {
        super(`Queue full: ${queued}/${maxQueueSize}`);
        this.name = 'QueueFullError';
    }
}

export class SimpleQueue<T> {
    private queue: T[] = [];
    private running = 0;
    private completed = 0;
    private failed = 0;
    private rejected = 0;
    private readonly maxQueueSize: number;

    constructor(
        private concurrency: number,
        private handler: JobHandler<T>,
        maxQueueSize?: number
    ) {
        // Default unbounded preserves prior behavior. Set via env or arg to
        // enable backpressure under load.
        const envMax = Number(process.env.SIMPLE_QUEUE_MAX_BACKLOG);
        this.maxQueueSize = maxQueueSize
            ?? (Number.isFinite(envMax) && envMax > 0 ? envMax : Number.POSITIVE_INFINITY);
    }

    add(job: T) {
        if (this.queue.length >= this.maxQueueSize) {
            this.rejected++;
            throw new QueueFullError(this.queue.length, this.maxQueueSize);
        }
        this.queue.push(job);
        this.runNext();
    }

    getStatus() {
        return {
            queued: this.queue.length,
            running: this.running,
            completed: this.completed,
            failed: this.failed,
            rejected: this.rejected,
            maxQueueSize: this.maxQueueSize,
            isIdle: this.queue.length === 0 && this.running === 0,
        };
    }

    reset() {
        this.completed = 0;
        this.failed = 0;
    }

    private async runNext() {
        if (this.running >= this.concurrency) return;
        const job = this.queue.shift();
        if (!job) return;

        this.running++;
        try {
            await this.handler(job);
            this.completed++;
        } catch (err) {
            console.error("Queue job failed:", err);
            this.failed++;
        } finally {
            this.running--;
            this.runNext();
        }
    }
}
