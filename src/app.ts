// Phase: 1 (AI Virtual Staging MVP)
// This file is part of the Phase 1 deliverables.

import express from "express";
import healthRoute from './api/health.route';
import authRoute from './api/auth.route';

import { errorHandler } from './middlewares/errorHandler';
import { zodErrorHandler } from './middlewares/zodErrorHandler';

const app = express();

app.use(express.json());

app.use('/api', healthRoute);
app.use('/api/auth', authRoute);

// Zod error handler middleware (after routes, before generic error handler)
app.use(zodErrorHandler);


// Error handler middleware (should be last)
app.use(errorHandler);

export default app;