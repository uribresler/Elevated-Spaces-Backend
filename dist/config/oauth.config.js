"use strict";
/**
 * OAuth Configuration Types and Constants
 * Centralized configuration for all OAuth providers
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.providerEnumValues = exports.providerIdFields = void 0;
exports.getOAuthConfig = getOAuthConfig;
exports.getConfiguredProviders = getConfiguredProviders;
/**
 * Get OAuth configuration for a provider
 * Returns null if credentials are not configured
 */
function getOAuthConfig(provider) {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3003';
    const configs = {
        google: () => {
            const clientID = process.env.GOOGLE_CLIENT_ID;
            const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
            if (!clientID || !clientSecret)
                return null;
            return {
                clientID,
                clientSecret,
                callbackURL: process.env.GOOGLE_CALLBACK_URL || `${baseUrl}/api/auth/google/callback`,
                scope: ['profile', 'email'],
            };
        },
        facebook: () => {
            const clientID = process.env.FACEBOOK_APP_ID;
            const clientSecret = process.env.FACEBOOK_APP_SECRET;
            if (!clientID || !clientSecret)
                return null;
            return {
                clientID,
                clientSecret,
                callbackURL: process.env.FACEBOOK_CALLBACK_URL || `${baseUrl}/api/auth/facebook/callback`,
                scope: ['email', 'public_profile'],
            };
        },
        apple: () => {
            const clientID = process.env.APPLE_CLIENT_ID; // Service ID
            const teamID = process.env.APPLE_TEAM_ID;
            const keyID = process.env.APPLE_KEY_ID;
            const privateKey = process.env.APPLE_PRIVATE_KEY;
            if (!clientID || !teamID || !keyID || !privateKey)
                return null;
            return {
                clientID,
                clientSecret: '', // Apple uses key-based auth, handled separately
                callbackURL: process.env.APPLE_CALLBACK_URL || `${baseUrl}/api/auth/apple/callback`,
                scope: ['name', 'email'],
            };
        },
    };
    return configs[provider]();
}
/**
 * Check which OAuth providers are configured
 */
function getConfiguredProviders() {
    const providers = ['google', 'facebook', 'apple'];
    return providers.filter((p) => getOAuthConfig(p) !== null);
}
/**
 * Map provider ID field names in database
 */
exports.providerIdFields = {
    google: 'google_id',
    facebook: 'facebook_id',
    apple: 'apple_id',
};
/**
 * Map provider to auth_provider enum value
 */
exports.providerEnumValues = {
    google: 'GOOGLE',
    facebook: 'FACEBOOK',
    apple: 'APPLE',
};
