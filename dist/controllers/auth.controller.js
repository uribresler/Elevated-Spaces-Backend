"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.signup = signup;
exports.login = login;
exports.oauthCallback = oauthCallback;
exports.oauthFailure = oauthFailure;
exports.getAvailableProviders = getAvailableProviders;
const zod_1 = require("zod");
const authSchemas_1 = require("../utils/authSchemas");
const auth_service_1 = require("../services/auth.service");
const oauth_service_1 = require("../services/oauth.service");
const logger_1 = require("../utils/logger");
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
// EMAIL/PASSWORD AUTH
async function signup(req, res) {
    try {
        const data = authSchemas_1.signupSchema.parse(req.body);
        const result = await (0, auth_service_1.signupService)(data);
        return res.status(201).json(result);
    }
    catch (err) {
        if (err instanceof zod_1.ZodError) {
            return res.status(400).json({ error: "Validation error", details: err.issues });
        }
        if (err && typeof err === "object" && "code" in err) {
            if (err.code === "USER_EXISTS") {
                return res.status(409).json({ error: "User already exists" });
            }
        }
        return res.status(500).json({ error: "Internal server error", err });
    }
}
async function login(req, res) {
    try {
        const data = authSchemas_1.loginSchema.parse(req.body);
        const result = await (0, auth_service_1.loginService)(data);
        return res.status(200).json(result);
    }
    catch (err) {
        if (err instanceof zod_1.ZodError) {
            return res.status(400).json({ error: "Validation error", details: err.issues });
        }
        if (err && typeof err === "object" && "code" in err) {
            const errorCode = err.code;
            if (errorCode === "INVALID_CREDENTIALS") {
                return res.status(401).json({ error: "Invalid credentials" });
            }
            if (errorCode === "USE_OAUTH_LOGIN") {
                return res.status(400).json({
                    error: "Please use social login for this account",
                    code: "USE_OAUTH_LOGIN",
                    provider: err.provider,
                });
            }
        }
        return res.status(500).json({ error: "Internal server error" });
    }
}
/**
 * Unified OAuth callback handler for all providers
 * Works with Google, Facebook, and Apple
 */
async function oauthCallback(req, res) {
    try {
        const authResult = req.user;
        if (!authResult || !authResult.token) {
            (0, logger_1.logger)("OAuth callback: No auth result received");
            return res.redirect(`${FRONTEND_URL}/auth/callback?error=auth_failed`);
        }
        // Build redirect URL with user data
        const params = new URLSearchParams({
            token: authResult.token,
            userId: authResult.user.id,
            email: authResult.user.email,
            name: authResult.user.name || "",
            provider: authResult.user.authProvider.toLowerCase(),
            isNewUser: authResult.isNewUser ? "true" : "false",
        });
        // Include avatar if available
        if (authResult.user.avatarUrl) {
            params.append("avatarUrl", authResult.user.avatarUrl);
        }
        (0, logger_1.logger)(`OAuth success: provider=${authResult.user.authProvider}, userId=${authResult.user.id}`);
        return res.redirect(`${FRONTEND_URL}/auth/callback?${params.toString()}`);
    }
    catch (error) {
        (0, logger_1.logger)(`OAuth callback error: ${error}`);
        return res.redirect(`${FRONTEND_URL}/auth/callback?error=server_error`);
    }
}
/**
 * Unified OAuth failure handler
 */
async function oauthFailure(req, res) {
    const provider = req.query.provider || "unknown";
    (0, logger_1.logger)(`OAuth failure: provider=${provider}`);
    // Check if this is an API request or browser redirect
    const acceptsJson = req.accepts("json");
    if (acceptsJson) {
        return res.status(401).json({
            success: false,
            error: {
                code: "OAUTH_FAILED",
                message: `${String(provider).charAt(0).toUpperCase() + String(provider).slice(1)} authentication failed. Please try again.`,
                provider,
            },
        });
    }
    return res.redirect(`${FRONTEND_URL}/auth/callback?error=auth_failed&provider=${provider}`);
}
/**
 * Get available OAuth providers
 * Frontend can use this to show/hide social login buttons
 */
async function getAvailableProviders(req, res) {
    const providers = oauth_service_1.oauthService.getProvidersStatus();
    return res.json({
        success: true,
        providers,
    });
}
