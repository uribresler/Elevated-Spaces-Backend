import type { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';

/**
 * Recursively strip keys that begin with '$' or contain '.' from a value.
 * This blocks MongoDB operator injection (e.g. { $ne: null }) and dotted-path
 * key smuggling. Only req.body is touched — Express 5's req.query is a getter
 * and read-only, so we leave it alone. Routes that legitimately accept dotted
 * keys (none in this codebase) would need to opt out.
 */
function sanitizeMongo(value: any): any {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) value[i] = sanitizeMongo(value[i]);
        return value;
    }
    for (const key of Object.keys(value)) {
        if (key.startsWith('$') || key.includes('.')) {
            delete value[key];
            continue;
        }
        value[key] = sanitizeMongo(value[key]);
    }
    return value;
}

export function noSqlInjectionGuard(req: Request, _res: Response, next: NextFunction) {
    try {
        if (req.body && typeof req.body === 'object') sanitizeMongo(req.body);
    } catch {
        // Defensive: never let the sanitizer crash a request.
    }
    next();
}

/**
 * General-purpose IP rate limiter for all API traffic. Conservative defaults
 * keep normal multi-tab usage comfortable; the limit is tunable via env.
 * Skips the Stripe webhook (Stripe retries aggressively and is authenticated
 * via signature) and SSE streaming endpoints (long-lived).
 */
export const globalRateLimiter = rateLimit({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
    limit: Number(process.env.RATE_LIMIT_MAX) || 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (req) => {
        if (req.path === '/api/payment/webhook') return true;
        // SSE endpoints — long-lived streams must not be rate-limited.
        if (req.path.includes('/stream')) return true;
        if (req.headers.accept === 'text/event-stream') return true;
        return false;
    },
    message: { error: 'Too many requests, please slow down' },
});

/**
 * Tighter rate limiter for authentication endpoints to slow down credential
 * stuffing / brute-force attacks. Mount in front of login / forgot-password
 * routes; existing handlers are untouched.
 */
export const authRateLimiter = rateLimit({
    windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    limit: Number(process.env.AUTH_RATE_LIMIT_MAX) || 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts, please try again later' },
});
