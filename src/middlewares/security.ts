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
    // Per-IP cap. Bumped from 300 → 1200/min so an admin loading the
    // analytics dashboard (10+ parallel queries) or a multi-image staging
    // session can't trip the limit. Authenticated users behind shared NAT
    // (offices, mobile carriers) still need headroom. Override via
    // RATE_LIMIT_MAX if a specific deployment is more constrained.
    limit: Number(process.env.RATE_LIMIT_MAX) || 1200,
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
    // 20 was too aggressive for genuine users (e.g. typing the password wrong
    // twice on mobile then refreshing the page eats most of the budget). 60
    // attempts per 15 min still throttles credential stuffing while letting
    // a real person recover from a few typos.
    limit: Number(process.env.AUTH_RATE_LIMIT_MAX) || 60,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts, please try again later' },
});
