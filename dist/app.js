"use strict";
// Phase: 1 (AI Virtual Staging MVP)
// This file is part of the Phase 1 deliverables.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const path = __importStar(require("path"));
const passport_1 = __importDefault(require("./config/passport"));
const health_route_1 = __importDefault(require("./api/health.route"));
const auth_route_1 = __importDefault(require("./api/auth.route"));
const image_route_1 = __importDefault(require("./api/image.route"));
const errorHandler_1 = require("./middlewares/errorHandler");
const zodErrorHandler_1 = require("./middlewares/zodErrorHandler");
const cors_1 = __importDefault(require("cors"));
const app = (0, express_1.default)();
app.use((0, cors_1.default)({ origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true }));
app.use(express_1.default.json());
// Initialize Passport
app.use(passport_1.default.initialize());
// Serve uploaded images as static files
app.use('/uploads', express_1.default.static(path.join(process.cwd(), 'uploads')));
app.use('/api', health_route_1.default);
app.use('/api/auth', auth_route_1.default);
app.use('/api/images', image_route_1.default);
// Zod error handler middleware (after routes, before generic error handler)
app.use(zodErrorHandler_1.zodErrorHandler);
// Error handler middleware (should be last)
app.use(errorHandler_1.errorHandler);
exports.default = app;
