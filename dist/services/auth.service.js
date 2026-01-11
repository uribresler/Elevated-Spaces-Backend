"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signupService = signupService;
exports.loginService = loginService;
const dbConnection_1 = __importDefault(require("../dbConnection"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const JWT_SECRET = process.env.JWT_SECRET || "changeme";
/**
 * Email/Password Signup Service
 */
async function signupService({ email, password, name, }) {
    const existing = await dbConnection_1.default.user.findUnique({ where: { email } });
    if (existing) {
        const err = new Error("User already exists");
        err.code = "USER_EXISTS";
        throw err;
    }
    const hash = await bcrypt_1.default.hash(password, 10);
    const user = await dbConnection_1.default.user.create({
        data: { email, password_hash: hash, name, role: "USER", auth_provider: "LOCAL" },
    });
    const token = jsonwebtoken_1.default.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
    return {
        token,
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
        success: true,
    };
}
/**
 * Email/Password Login Service
 */
async function loginService({ email, password }) {
    const user = await dbConnection_1.default.user.findUnique({ where: { email } });
    if (!user) {
        const err = new Error("Invalid credentials");
        err.code = "INVALID_CREDENTIALS";
        throw err;
    }
    // Check if user signed up with OAuth (no password set)
    if (!user.password_hash && user.auth_provider !== "LOCAL") {
        const err = new Error(`Please use ${user.auth_provider.toLowerCase()} login for this account`);
        err.code = "USE_OAUTH_LOGIN";
        err.provider = user.auth_provider.toLowerCase();
        throw err;
    }
    if (!user.password_hash) {
        const err = new Error("Invalid credentials");
        err.code = "INVALID_CREDENTIALS";
        throw err;
    }
    const valid = await bcrypt_1.default.compare(password, user.password_hash);
    if (!valid) {
        const err = new Error("Invalid credentials");
        err.code = "INVALID_CREDENTIALS";
        throw err;
    }
    const token = jsonwebtoken_1.default.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
    return {
        token,
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
        success: true,
    };
}
// Note: OAuth authentication is now handled by oauth.service.ts
