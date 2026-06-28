import express from "express";
import * as path from "path";
import cookieParser from "cookie-parser";
import passport from "./config/passport";
import healthRoute from "./api/health.route";
import authRoute from "./api/auth.route";
import imageRoute from "./api/image.route";
import guestRoute from "./api/guest.route";
import teamsRoute from './api/teams.route'
import teamsCreditRoute from './api/teams.credits.route'
import projectsRoute from './api/projects.route'
import paymentRoutes from './api/payment.routes'
import adminLogsRoute from './api/admin-logs.route'
import adminUsersRoute from './api/admin-users.route'
import legalDocumentsRoute from './api/legal-documents.route'
import resourceRoute from './api/resource.route'
import subscriptionRoutes from './api/subscription.route'
import paymentHistoryRoutes from './api/payment-history.route'
import debugRoutes from './api/debug.route'
import photographerRoutes from './api/photographer.route'
import messagesRoutes from './api/messages.route'
import accountDeletionRoutes from './api/accountDeletion.route'
import analyticsRoutes from './api/analytics.route'
import consentsRoute from './api/consents.route'
import matchmakerRoutes from './api/matchmaker.route'
import { stripeWebhookHandler } from "./controllers/payment.controller";
import { errorHandler } from "./middlewares/errorHandler";
import { zodErrorHandler } from "./middlewares/zodErrorHandler";
import { requestLoggingMiddleware } from "./middlewares/requestLogging.middleware";
import { noSqlInjectionGuard, globalRateLimiter } from "./middlewares/security";
import cors from "cors";
import helmet from "helmet";

const app = express();
const SUPPORT_REQUEST_JSON_LIMIT = process.env.SUPPORT_REQUEST_JSON_LIMIT || "5mb";
// Global JSON body cap. Multi-image uploads use multipart (multer), not JSON,
// so a 2mb default is safe. Override with JSON_BODY_LIMIT if needed.
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || "2mb";
const URLENCODED_BODY_LIMIT = process.env.URLENCODED_BODY_LIMIT || "2mb";

/* =======================
   CORS CONFIG (FIXED)
======================= */

// CORS allowed origins - prioritize env var, include localhost for development
// CORS_ORIGINS should be a comma-separated list of FULL origins, e.g.:
//   "http://localhost:3000,https://elevatespacesai.com,https://www.elevatespacesai.com"
// Common mistake: putting just "elevatespacesai.com" — browsers always send
// the `Origin` header as a full URL with scheme, so the bare hostname will
// never match. We normalize trailing slashes / whitespace / case here so a
// minor typo in the env doesn't break the deploy.
function normalizeOrigin(value: string): string {
    return value
        .trim()
        .replace(/\/+$/, "") // strip trailing slashes
        .toLowerCase();
}

const corsOriginsEnv = process.env.CORS_ORIGINS;
const allowedOrigins = (corsOriginsEnv ? corsOriginsEnv.split(",") : [])
    .map(normalizeOrigin)
    .filter(Boolean);

// Always include common localhost ports for development
["http://localhost:3000", "http://localhost:3001", "http://127.0.0.1:3000", "http://127.0.0.1:3001"].forEach(origin => {
    if (!allowedOrigins.includes(origin)) {
        allowedOrigins.push(origin);
    }
});

console.log("[CORS] Allowed origins:", allowedOrigins);

// Security headers. crossOriginResourcePolicy relaxed so that /uploads static
// files remain loadable cross-origin (existing behavior preserved).
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
}));

// IP-based rate limit. Skips webhook + SSE; see security.ts.
app.use(globalRateLimiter);

app.use(
    cors({
        origin: (origin, callback) => {
            // allow server-to-server & Postman (no Origin header)
            if (!origin) return callback(null, true);

            if (allowedOrigins.includes(normalizeOrigin(origin))) {
                return callback(null, true);
            }

            // Log the rejected origin so misconfigured CORS_ORIGINS shows up
            // in Render logs as the actual value the browser sent, not a
            // generic "Not allowed by CORS" with no context.
            console.warn(`[CORS] Rejected origin "${origin}". Allowed: ${allowedOrigins.join(", ")}`);
            return callback(new Error(`Origin ${origin} not allowed by CORS`));
        },
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "X-Fingerprint"],
    })
);

/* =======================
   MIDDLEWARES
======================= */

// Stripe webhook requires raw body
app.post("/api/payment/webhook", express.raw({ type: "application/json" }),
    stripeWebhookHandler);

// Support requests can include base64 screenshots, so allow a larger JSON payload on this endpoint only.
app.use("/api/payment/support-request", express.json({ limit: SUPPORT_REQUEST_JSON_LIMIT }));

app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: URLENCODED_BODY_LIMIT }));
app.use(cookieParser());

// NoSQL injection guard runs after body parsing so it sees the parsed object.
app.use(noSqlInjectionGuard);

// Initialize Passport
app.use(passport.initialize());

// Request logging (after auth)
app.use(requestLoggingMiddleware);

/* =======================
   ROUTES
======================= */

// Root health
app.get("/", (_req, res) => {
    res.status(200).json({
        success: true,
        message: "Elevated Spaces Backend is running 🚀",
        status: "healthy",
    });
});

// Static uploads
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

app.use("/api", healthRoute);
app.use("/api/auth", authRoute);
app.use("/api/guest", guestRoute);
app.use("/api/images", imageRoute);
app.use('/api/teams', teamsRoute)
app.use('/api/teams/credits', teamsCreditRoute)
app.use('/api/projects', projectsRoute)
app.use('/api/payment', paymentRoutes)
app.use('/api/payments', paymentHistoryRoutes)
app.use('/api/admin/logs', adminLogsRoute)
app.use('/api/admin/users', adminUsersRoute)
app.use('/api/consents', consentsRoute)
app.use('/api/legal-documents', legalDocumentsRoute)
app.use('/api/resources', resourceRoute)
app.use('/api/subscriptions', subscriptionRoutes)
app.use('/debug', debugRoutes)
app.use('/api/photographers', photographerRoutes)
app.use('/api/messages', messagesRoutes)
app.use('/api/account', accountDeletionRoutes)
app.use('/api/analytics', analyticsRoutes)
app.use('/api/matchmaker', matchmakerRoutes)

/* =======================
   ERROR HANDLERS
======================= */

app.use(zodErrorHandler);
app.use(errorHandler);

export default app;
