import * as fs from "fs";
import * as path from "path";

export type SingleImageTrace = {
  traceId: string;
  filePath: string;
  append: (step: string, details?: Record<string, unknown>) => Promise<void>;
};

type TraceInit = {
  endpoint: string;
  method: string;
  userId: string | null;
  teamId: string | null;
  projectId: string | null;
  hasFile: boolean;
  fileName: string | null;
  contentType: string | null;
  fileSizeBytes: number | null;
  isDemo: boolean;
  fallbackModel: string;
  fallbackPrimaryModel: string;
  fallbackBackupModel: string;
  fallbackRateLimitPerMinute: number;
  fallbackVariantConcurrency: number;
  fallbackVariantCount: number;
};

function generateTraceId(): string {
  return `ms-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export function getRelativeTracePath(filePath: string): string {
  const relative = path.relative(process.cwd(), filePath).replace(/\\/g, "/");
  return relative || filePath;
}

export async function createSingleImageTrace(init: TraceInit): Promise<SingleImageTrace> {
  const traceId = generateTraceId();
  const logsDir = path.join(process.cwd(), "logs");
  const filePath = path.join(logsDir, `single-image-run-${traceId}.jsonl`);

  await fs.promises.mkdir(logsDir, { recursive: true });

  const writeLine = async (payload: Record<string, unknown>): Promise<void> => {
    const line = `${JSON.stringify(payload)}\n`;
    await fs.promises.appendFile(filePath, line, "utf8");
  };

  await writeLine({
    ts: new Date().toISOString(),
    step: "trace.init",
    traceId,
    request: init,
  });

  return {
    traceId,
    filePath,
    append: async (step: string, details: Record<string, unknown> = {}) => {
      await writeLine({
        ts: new Date().toISOString(),
        step,
        details,
      });
    },
  };
}
