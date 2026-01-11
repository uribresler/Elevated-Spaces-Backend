"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.oauthService = void 0;
const dbConnection_1 = __importDefault(require("../dbConnection"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const oauth_config_1 = require("../config/oauth.config");
const logger_1 = require("../utils/logger");
const JWT_SECRET = process.env.JWT_SECRET || "changeme";
/**
 * OAuth Service - Unified handler for all OAuth providers
 * Follows DRY principle - single function handles Google, Facebook, Apple
 */
class OAuthService {
    /**
     * Authenticate or register a user via OAuth
     * Handles all providers uniformly
     */
    async authenticateOAuthUser(profile) {
        const { providerId, provider, email, name, avatarUrl } = profile;
        const providerIdField = oauth_config_1.providerIdFields[provider];
        const authProviderValue = oauth_config_1.providerEnumValues[provider];
        (0, logger_1.logger)(`OAuth login attempt: provider=${provider}, email=${email}`);
        // Step 1: Try to find user by provider ID
        let user = await this.findUserByProviderId(provider, providerId);
        let isNewUser = false;
        if (!user) {
            // Step 2: Check if user exists with this email
            user = await dbConnection_1.default.user.findUnique({ where: { email } });
            if (user) {
                // Link OAuth account to existing user
                user = await this.linkProviderToUser(user.id, provider, providerId, avatarUrl);
                (0, logger_1.logger)(`Linked ${provider} account to existing user: ${user.id}`);
            }
            else {
                // Step 3: Create new user
                user = await this.createOAuthUser(profile);
                isNewUser = true;
                (0, logger_1.logger)(`Created new user via ${provider}: ${user.id}`);
            }
        }
        else {
            // Update user info if changed
            user = await this.updateUserProfile(user.id, name, avatarUrl);
        }
        // Generate JWT token
        const token = jsonwebtoken_1.default.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
        return {
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                avatarUrl: user.avatar_url,
                authProvider: user.auth_provider,
            },
            success: true,
            isNewUser,
        };
    }
    /**
     * Find user by provider-specific ID
     */
    async findUserByProviderId(provider, providerId) {
        const whereClause = {};
        whereClause[oauth_config_1.providerIdFields[provider]] = providerId;
        return dbConnection_1.default.user.findFirst({ where: whereClause });
    }
    /**
     * Link an OAuth provider to an existing user
     */
    async linkProviderToUser(userId, provider, providerId, avatarUrl) {
        const updateData = {};
        updateData[oauth_config_1.providerIdFields[provider]] = providerId;
        // Update avatar if user doesn't have one
        const currentUser = await dbConnection_1.default.user.findUnique({ where: { id: userId } });
        if (!currentUser?.avatar_url && avatarUrl) {
            updateData.avatar_url = avatarUrl;
        }
        // Only update auth_provider if user doesn't have a password (pure OAuth user)
        if (!currentUser?.password_hash) {
            updateData.auth_provider = oauth_config_1.providerEnumValues[provider];
        }
        return dbConnection_1.default.user.update({
            where: { id: userId },
            data: updateData,
        });
    }
    /**
     * Create a new user from OAuth profile
     */
    async createOAuthUser(profile) {
        const { providerId, provider, email, name, avatarUrl } = profile;
        const createData = {
            email,
            name: name || null,
            avatar_url: avatarUrl,
            auth_provider: oauth_config_1.providerEnumValues[provider],
            role: "USER",
        };
        // Set the provider-specific ID
        createData[oauth_config_1.providerIdFields[provider]] = providerId;
        return dbConnection_1.default.user.create({ data: createData });
    }
    /**
     * Update user profile with latest info from OAuth provider
     */
    async updateUserProfile(userId, name, avatarUrl) {
        const currentUser = await dbConnection_1.default.user.findUnique({ where: { id: userId } });
        if (!currentUser)
            throw new Error("User not found");
        const updateData = {};
        // Only update if user doesn't have a name set
        if (!currentUser.name && name) {
            updateData.name = name;
        }
        // Update avatar if changed
        if (avatarUrl && avatarUrl !== currentUser.avatar_url) {
            updateData.avatar_url = avatarUrl;
        }
        if (Object.keys(updateData).length === 0) {
            return currentUser;
        }
        return dbConnection_1.default.user.update({
            where: { id: userId },
            data: updateData,
        });
    }
    /**
     * Get available OAuth providers status
     */
    getProvidersStatus() {
        return {
            google: !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET,
            facebook: !!process.env.FACEBOOK_APP_ID && !!process.env.FACEBOOK_APP_SECRET,
            apple: !!process.env.APPLE_CLIENT_ID &&
                !!process.env.APPLE_TEAM_ID &&
                !!process.env.APPLE_KEY_ID &&
                !!process.env.APPLE_PRIVATE_KEY,
        };
    }
}
// Export singleton instance
exports.oauthService = new OAuthService();
