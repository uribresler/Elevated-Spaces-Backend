import express from "express";
import * as path from "path";
import passport from "./config/passport";
import healthRoute from "./api/health.route";
import authRoute from "./api/auth.route";
import imageRoute from "./api/image.route";
import { errorHandler } from "./middlewares/errorHandler";
import { zodErrorHandler } from "./middlewares/zodErrorHandler";
import cors from "cors";

const app = express();

/* =======================
   CORS CONFIG (FIXED)
======================= */

const allowedOrigins = [
    "http://localhost:3000",
    "https://elevate-spaces.vercel.app",
];

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
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
    })
);

// 🔥 REQUIRED FOR PREFLIGHT
app.options("*", cors());

/* =======================
   MIDDLEWARES
======================= */

app.use(express.json());

// Initialize Passport
app.use(passport.initialize());

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
app.use("/api/images", imageRoute);

/* =======================
   ERROR HANDLERS
======================= */

app.use(zodErrorHandler);
app.use(errorHandler);

export default app;
