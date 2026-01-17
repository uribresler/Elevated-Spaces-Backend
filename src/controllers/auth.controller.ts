import { Request, Response } from "express";
import { ZodError } from "zod";
import { loginSchema, signupSchema } from "../utils/authSchemas";
import { loginService, signupService } from "../services/auth.service";
import { oauthService } from "../services/oauth.service";
import { logger } from "../utils/logger";
import { OAuthResult } from "../types/auth";
import jwt from 'jsonwebtoken'

// FRONTEND_URL - prioritize env var (REQUIRED in production), default to localhost for development
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

// Warn if FRONTEND_URL is not set in production
if (process.env.NODE_ENV === 'production' && !process.env.FRONTEND_URL) {
  console.warn('⚠️  WARNING: FRONTEND_URL environment variable is not set in production!');
}

// EMAIL/PASSWORD AUTH
export async function signup(req: Request, res: Response) {
  try {
    const data = signupSchema.parse(req.body);
    const result = await signupService(data);
    return res.status(201).json(result);
  } catch (err: unknown) {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: "Validation error", details: err.issues });
    }
    if (err && typeof err === "object" && "code" in err) {
      if ((err as any).code === "USER_EXISTS") {
        return res.status(409).json({ error: "User already exists" });
      }
    }
    return res.status(500).json({ error: "Internal server error", err });
  }
}

export async function login(req: Request, res: Response) {
  try {
    const data = loginSchema.parse(req.body);
    const result = await loginService(data);
    return res.status(200).json(result);
  } catch (err: unknown) {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: "Validation error", details: err.issues });
    }
    if (err && typeof err === "object" && "code" in err) {
      const errorCode = (err as any).code;
      if (errorCode === "INVALID_CREDENTIALS") {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      if (errorCode === "USE_OAUTH_LOGIN") {
        return res.status(400).json({
          error: "Please use social login for this account",
          code: "USE_OAUTH_LOGIN",
          provider: (err as any).provider,
        });
      }
    }
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function oauthCallback(req: Request, res: Response) {
  try {
    if (!req.user) {
      logger("OAuth callback: req.user is missing");
      return res.redirect(`${FRONTEND_URL}/auth/callback?error=auth_failed`);
    }

    const user = req.user as Express.User & { _oauth?: OAuthResult };
    const authResult = (user as any)._oauth;

    if (!authResult) {
      logger(`OAuth callback: _oauth property missing. User object: ${JSON.stringify(user)}`);
      return res.redirect(`${FRONTEND_URL}/auth/callback?error=auth_failed`);
    }

    if (!authResult.token || !authResult.user) {
      logger(`OAuth callback: Invalid auth result structure: ${JSON.stringify(authResult)}`);
      return res.redirect(`${FRONTEND_URL}/auth/callback?error=auth_failed`);
    }

    logger(`OAuth callback success: userId=${authResult.user.id}, email=${authResult.user.email}, isNewUser=${authResult.isNewUser}`);

    // Now you have everything: token, isNewUser, avatarUrl, etc.
    const params = new URLSearchParams({
      token: authResult.token,
      userId: authResult.user.id,
      email: authResult.user.email,
      name: authResult.user.name || "",
      provider: authResult.user.authProvider.toLowerCase(),
      isNewUser: authResult.isNewUser ? "true" : "false",
    });

    if (authResult.user.avatarUrl) {
      params.append("avatarUrl", authResult.user.avatarUrl);
    }

    // Redirect to frontend callback page with token and user data
    return res.redirect(`${FRONTEND_URL}/auth/google/callback?${params.toString()}`);
  } catch (error) {
    logger(`OAuth callback error: ${error instanceof Error ? error.message : String(error)}`);
    return res.redirect(`${FRONTEND_URL}/auth/callback?error=server_error`);
  }
}


export async function oauthFailure(req: Request, res: Response) {
  const provider = req.query.provider || "unknown";
  logger(`OAuth failure: provider=${provider}`);

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

export async function getAvailableProviders(req: Request, res: Response) {
  const providers = oauthService.getProvidersStatus();
  return res.json({
    success: true,
    providers,
  });
}
