import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

// CORS rejections are produced by the cors() middleware as plain Errors. We
// surface them as 403 instead of an opaque 500. Response shape is unchanged
// for genuine server errors.
function isCorsError(err: any): boolean {
  return typeof err?.message === 'string' && err.message === 'Not allowed by CORS';
}

// Payload-too-large from express.json/urlencoded
function isPayloadTooLarge(err: any): boolean {
  return err?.type === 'entity.too.large' || err?.status === 413;
}

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  // If headers already flushed (e.g. SSE), delegate to default handler so the
  // socket gets torn down cleanly.
  if (res.headersSent) return next(err);

  const errorId = crypto.randomBytes(6).toString('hex');
  console.error(
    `[ERR] id=${errorId} method=${req.method} path=${req.originalUrl}`,
    err
  );

  if (isCorsError(err)) {
    return res.status(403).json({ error: 'Origin not allowed', errorId });
  }
  if (isPayloadTooLarge(err)) {
    return res.status(413).json({ error: 'Payload too large', errorId });
  }

  res.status(500).json({ error: 'Internal Server Error', errorId });
}
