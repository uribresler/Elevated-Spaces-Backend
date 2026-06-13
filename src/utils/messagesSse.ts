import { Response } from "express";

type SseClient = {
  id: number;
  res: Response;
};

const clientsByUserId = new Map<string, Set<SseClient>>();
let nextClientId = 1;

export function registerSseClient(userId: string, res: Response): () => void {
  const client: SseClient = { id: nextClientId++, res };
  const existing = clientsByUserId.get(userId) || new Set<SseClient>();
  existing.add(client);
  clientsByUserId.set(userId, existing);

  return () => {
    const set = clientsByUserId.get(userId);
    if (!set) return;
    set.delete(client);
    if (set.size === 0) clientsByUserId.delete(userId);
  };
}

export function pushSseEvent(userId: string, event: string, data: unknown): void {
  const set = clientsByUserId.get(userId);
  if (!set || set.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of set) {
    try {
      client.res.write(payload);
    } catch {
      // ignore broken pipe — cleanup happens via close handler
    }
  }
}
