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
import legalDocumentsRoute from './api/legal-documents.route'
import subscriptionRoutes from './api/subscription.route'
import paymentHistoryRoutes from './api/payment-history.route'
import debugRoutes from './api/debug.route'
import photographerRoutes from './api/photographer.route'
import messagesRoutes from './api/messages.route'
import { stripeWebhookHandler } from "./controllers/payment.controller";
import { errorHandler } from "./middlewares/errorHandler";
import { zodErrorHandler } from "./middlewares/zodErrorHandler";
import { requestLoggingMiddleware } from "./middlewares/requestLogging.middleware";
import cors from "cors";

const app = express();

/* =======================
   CORS CONFIG (FIXED)
======================= */

// CORS allowed origins - prioritize env var, include localhost for development
// CORS_ORIGINS should be a comma-separated list: "http://localhost:3000,https://your-frontend.com"
const corsOriginsEnv = process.env.CORS_ORIGINS;
const allowedOrigins = corsOriginsEnv
    ? corsOriginsEnv.split(',').map(origin => origin.trim())
    : [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3002",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "http://127.0.0.1:3002",
      ];

// Always include common localhost ports for development
["http://localhost:3000", "http://localhost:3001", "http://127.0.0.1:3000", "http://127.0.0.1:3001"].forEach(origin => {
    if (!allowedOrigins.includes(origin)) {
        allowedOrigins.push(origin);
    }
});

app.use(
    cors({
        origin: (origin, callback) => {
            // allow server-to-server & Postman
            if (!origin) return callback(null, true);

            if (allowedOrigins.includes(origin)) {
                return callback(null, true);
            }

            return callback(new Error("Not allowed by CORS"));
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

const requestBodyLimit = process.env.REQUEST_BODY_LIMIT || "15mb";

app.use(express.json({ limit: requestBodyLimit }));
app.use(express.urlencoded({ limit: requestBodyLimit, extended: true }));
app.use(cookieParser());

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
app.use('/api/legal-documents', legalDocumentsRoute)
app.use('/api/subscriptions', subscriptionRoutes)
app.use('/debug', debugRoutes)
app.use('/api/photographers', photographerRoutes)
app.use('/api/messages', messagesRoutes)

/* =======================
   ERROR HANDLERS
======================= */

app.use(zodErrorHandler);
app.use(errorHandler);

export default app;
