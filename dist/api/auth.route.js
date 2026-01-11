"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const passport_1 = __importDefault(require("../config/passport"));
const auth_controller_1 = require("../controllers/auth.controller");
const router = (0, express_1.Router)();
router.post("/signup", auth_controller_1.signup);
router.post("/login", auth_controller_1.login);
// Get available OAuth providers
router.get("/providers", auth_controller_1.getAvailableProviders);
// Google OAuth
router.get("/google", passport_1.default.authenticate("google", { scope: ["profile", "email"] }));
router.get("/google/callback", passport_1.default.authenticate("google", { session: false, failureRedirect: "/api/auth/failure?provider=google" }), auth_controller_1.oauthCallback);
// Facebook OAuth
router.get("/facebook", passport_1.default.authenticate("facebook", { scope: ["email", "public_profile"] }));
router.get("/facebook/callback", passport_1.default.authenticate("facebook", { session: false, failureRedirect: "/api/auth/failure?provider=facebook" }), auth_controller_1.oauthCallback);
// Apple OAuth
router.post("/apple", passport_1.default.authenticate("apple", { scope: ["name", "email"] }));
router.post("/apple/callback", passport_1.default.authenticate("apple", { session: false, failureRedirect: "/api/auth/failure?provider=apple" }), auth_controller_1.oauthCallback);
// Unified OAuth failure handler
router.get("/failure", auth_controller_1.oauthFailure);
exports.default = router;
