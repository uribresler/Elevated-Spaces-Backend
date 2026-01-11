"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const passport_1 = __importDefault(require("passport"));
const passport_google_oauth20_1 = require("passport-google-oauth20");
const passport_facebook_1 = require("passport-facebook");
const passport_apple_1 = __importDefault(require("passport-apple"));
const oauth_service_1 = require("../services/oauth.service");
const oauth_config_1 = require("./oauth.config");
const logger_1 = require("../utils/logger");
// GOOGLE STRATEGY
const googleConfig = (0, oauth_config_1.getOAuthConfig)("google");
if (googleConfig) {
    passport_1.default.use(new passport_google_oauth20_1.Strategy({
        clientID: googleConfig.clientID,
        clientSecret: googleConfig.clientSecret,
        callbackURL: googleConfig.callbackURL,
        scope: googleConfig.scope,
    }, async (accessToken, refreshToken, profile, done) => {
        try {
            const oauthUser = {
                providerId: profile.id,
                provider: "google",
                email: profile.emails?.[0]?.value || "",
                name: profile.displayName || profile.name?.givenName || "",
                avatarUrl: profile.photos?.[0]?.value || null,
            };
            const result = await oauth_service_1.oauthService.authenticateOAuthUser(oauthUser);
            return done(null, result);
        }
        catch (error) {
            (0, logger_1.logger)(`Google auth error: ${error}`);
            return done(error, undefined);
        }
    }));
    (0, logger_1.logger)("Google OAuth strategy configured");
}
else {
    (0, logger_1.logger)("Google OAuth not configured (missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET)");
}
// FACEBOOK STRATEGY
const facebookConfig = (0, oauth_config_1.getOAuthConfig)("facebook");
if (facebookConfig) {
    passport_1.default.use(new passport_facebook_1.Strategy({
        clientID: facebookConfig.clientID,
        clientSecret: facebookConfig.clientSecret,
        callbackURL: facebookConfig.callbackURL,
        profileFields: ["id", "emails", "name", "displayName", "photos"],
    }, async (accessToken, refreshToken, profile, done) => {
        try {
            const oauthUser = {
                providerId: profile.id,
                provider: "facebook",
                email: profile.emails?.[0]?.value || "",
                name: profile.displayName || `${profile.name?.givenName} ${profile.name?.familyName}`.trim() || "",
                avatarUrl: profile.photos?.[0]?.value || null,
            };
            if (!oauthUser.email) {
                return done(new Error("Email not provided by Facebook. Please ensure email permission is granted."), undefined);
            }
            const result = await oauth_service_1.oauthService.authenticateOAuthUser(oauthUser);
            return done(null, result);
        }
        catch (error) {
            (0, logger_1.logger)(`Facebook auth error: ${error}`);
            return done(error, undefined);
        }
    }));
    (0, logger_1.logger)("Facebook OAuth strategy configured");
}
else {
    (0, logger_1.logger)("Facebook OAuth not configured (missing FACEBOOK_APP_ID or FACEBOOK_APP_SECRET)");
}
// APPLE STRATEGY
const appleClientID = process.env.APPLE_CLIENT_ID;
const appleTeamID = process.env.APPLE_TEAM_ID;
const appleKeyID = process.env.APPLE_KEY_ID;
const applePrivateKey = process.env.APPLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
if (appleClientID && appleTeamID && appleKeyID && applePrivateKey) {
    const baseUrl = process.env.BASE_URL || "http://localhost:3003";
    passport_1.default.use(new passport_apple_1.default({
        clientID: appleClientID,
        teamID: appleTeamID,
        keyID: appleKeyID,
        privateKeyString: applePrivateKey,
        callbackURL: process.env.APPLE_CALLBACK_URL || `${baseUrl}/api/auth/apple/callback`,
        scope: ["name", "email"],
        passReqToCallback: false,
    }, async (accessToken, refreshToken, idToken, profile, done) => {
        try {
            const oauthUser = {
                providerId: idToken.sub || profile.id,
                provider: "apple",
                email: idToken.email || profile.email || "",
                name: profile.name
                    ? `${profile.name.firstName || ""} ${profile.name.lastName || ""}`.trim()
                    : "",
                avatarUrl: null,
            };
            if (!oauthUser.email) {
                return done(new Error("Email not provided by Apple"), undefined);
            }
            const result = await oauth_service_1.oauthService.authenticateOAuthUser(oauthUser);
            return done(null, result);
        }
        catch (error) {
            (0, logger_1.logger)(`Apple auth error: ${error}`);
            return done(error, undefined);
        }
    }));
    (0, logger_1.logger)("OAuth strategy configured");
}
else {
    (0, logger_1.logger)("Apple OAuth not configured (missing APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, or APPLE_PRIVATE_KEY)");
}
// SERIALIZATION (for session-less JWT auth)
passport_1.default.serializeUser((user, done) => {
    done(null, user);
});
passport_1.default.deserializeUser((user, done) => {
    done(null, user);
});
exports.default = passport_1.default;
