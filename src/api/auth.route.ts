import { Router } from "express";
import passport from "../config/passport";
import {
  login,
  signup,
  oauthCallback,
  oauthFailure,
  getAvailableProviders,
} from "../controllers/auth.controller";

const router = Router();

router.post("/signup", signup);
router.post("/login", login);

// Get available OAuth providers
router.get("/providers", getAvailableProviders);

// Google OAuth
router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));
router.get(
  "/google/callback",
  passport.authenticate("google", { session: false, failureRedirect: "/api/auth/failure?provider=google" }),
  oauthCallback
);

// Facebook OAuth
router.get("/facebook", passport.authenticate("facebook", { scope: ["email", "public_profile"] }));
router.get(
  "/facebook/callback",
  passport.authenticate("facebook", { session: false, failureRedirect: "/api/auth/failure?provider=facebook" }),
  oauthCallback
);

// Apple OAuth
router.post("/apple", passport.authenticate("apple", { scope: ["name", "email"] }));
router.post(
  "/apple/callback",
  passport.authenticate("apple", { session: false, failureRedirect: "/api/auth/failure?provider=apple" }),
  oauthCallback
);

// Unified OAuth failure handler
router.get("/failure", oauthFailure);

export default router;
