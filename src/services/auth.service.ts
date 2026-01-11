import prisma from "../dbConnection";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "changeme";

/**
 * Email/Password Signup Service
 */
export async function signupService({
  email,
  password,
  name,
}: {
  email: string;
  password: string;
  name?: string;
}) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    const err: any = new Error("User already exists");
    err.code = "USER_EXISTS";
    throw err;
  }
  const hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email, password_hash: hash, name, role: "USER", auth_provider: "LOCAL" },
  });
  const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
  return {
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    success: true,
  };
}

/**
 * Email/Password Login Service
 */
export async function loginService({ email, password }: { email: string; password: string }) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const err: any = new Error("Invalid credentials");
    err.code = "INVALID_CREDENTIALS";
    throw err;
  }

  // Check if user signed up with OAuth (no password set)
  if (!user.password_hash && user.auth_provider !== "LOCAL") {
    const err: any = new Error(`Please use ${user.auth_provider.toLowerCase()} login for this account`);
    err.code = "USE_OAUTH_LOGIN";
    err.provider = user.auth_provider.toLowerCase();
    throw err;
  }

  if (!user.password_hash) {
    const err: any = new Error("Invalid credentials");
    err.code = "INVALID_CREDENTIALS";
    throw err;
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    const err: any = new Error("Invalid credentials");
    err.code = "INVALID_CREDENTIALS";
    throw err;
  }

  const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
  return {
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    success: true,
  };
}

// Note: OAuth authentication is now handled by oauth.service.ts
