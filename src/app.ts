// Phase: 1 (AI Virtual Staging MVP)
// This file is part of the Phase 1 deliverables.

import express from "express";
import * as path from "path";
import passport from "./config/passport";
import healthRoute from './api/health.route';
import authRoute from './api/auth.route';
import imageRoute from './api/image.route';

import { errorHandler } from './middlewares/errorHandler';
import { zodErrorHandler } from './middlewares/zodErrorHandler';
import cors from 'cors'

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true }));
app.use(express.json());

// Initialize Passport
app.use(passport.initialize());

// Root health (MUST be before api routes)
app.get("/", (_req, res) => {
    res.status(200).json({
        success: true,
        message: "Elevated Spaces Backend is running 🚀",
        status: "healthy",
    });
});

// Serve uploaded images as static files
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
app.use('/api', healthRoute);
app.use('/api/auth', authRoute);
app.use('/api/images', imageRoute);

// Zod error handler middleware (after routes, before generic error handler)
app.use(zodErrorHandler);


// Error handler middleware (should be last)
app.use(errorHandler);

export default app;