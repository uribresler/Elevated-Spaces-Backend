import prisma from "../dbConnection";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { sendEmail } from "../config/mail.config";

const JWT_SECRET = process.env.JWT_SECRET!
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const EMAIL_VERIFICATION_TTL_HOURS = 24;

function generateEmailVerificationToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function sendVerificationEmail(toEmail: string, name: string | null, token: string) {
  const verifyUrl = `${FRONTEND_URL}/auth/verify-email?token=${encodeURIComponent(token)}`;
  const displayName = name?.trim() || "there";
  await sendEmail({
    from: process.env.SENDGRID_VERIFIED_SENDER || "noreply@elevatespacesai.com",
    senderName: "Elevate Spaces AI",
    to: toEmail,
    subject: "Confirm your Elevated Spaces account",
    text: `Hi ${displayName},\n\nPlease confirm your account by opening this link:\n${verifyUrl}\n\nThis link expires in ${EMAIL_VERIFICATION_TTL_HOURS} hours. If you didn't sign up, you can ignore this email.\n\n— Elevated Spaces`,
    html: `<p>Hi ${displayName},</p><p>Please confirm your account by clicking the button below.</p><p><a href="${verifyUrl}" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none">Confirm my account</a></p><p>Or paste this link in your browser: <a href="${verifyUrl}">${verifyUrl}</a></p><p>This link expires in ${EMAIL_VERIFICATION_TTL_HOURS} hours. If you didn't sign up, you can ignore this email.</p><p>— Elevated Spaces</p>`,
  });
}

async function sendSecondaryEmailAddedNotice(primary: string, secondary: string, name: string | null) {
  const displayName = name?.trim() || "there";
  await sendEmail({
    from: process.env.SENDGRID_VERIFIED_SENDER || "noreply@elevatespacesai.com",
    senderName: "Elevate Spaces AI",
    to: primary,
    subject: "A secondary email was added to your Elevated Spaces account",
    text: `Hi ${displayName},\n\nA secondary email (${secondary}) was just confirmed and added to your account. You can now sign in with either email.\n\nIf this wasn't you, please contact support immediately and change your password.\n\n— Elevated Spaces`,
    html: `<p>Hi ${displayName},</p><p>A secondary email <strong>${secondary}</strong> was just confirmed and added to your account. You can now sign in with either email.</p><p>If this wasn't you, please contact support immediately and change your password.</p><p>— Elevated Spaces</p>`,
  });
}

async function sendSecondaryEmailVerification(toEmail: string, name: string | null, token: string) {
  const verifyUrl = `${FRONTEND_URL}/auth/verify-secondary-email?token=${encodeURIComponent(token)}`;
  const displayName = name?.trim() || "there";
  await sendEmail({
    from: process.env.SENDGRID_VERIFIED_SENDER || "noreply@elevatespacesai.com",
    senderName: "Elevate Spaces AI",
    to: toEmail,
    subject: "Confirm your secondary email for Elevated Spaces",
    text: `Hi ${displayName},\n\nPlease confirm this address as a secondary email on your Elevated Spaces account by opening this link:\n${verifyUrl}\n\nThis link expires in ${EMAIL_VERIFICATION_TTL_HOURS} hours. Until you confirm, this address can't be used to sign in. If you didn't request this, you can ignore the email.\n\n— Elevated Spaces`,
    html: `<p>Hi ${displayName},</p><p>Please confirm this address as a secondary email on your Elevated Spaces account.</p><p><a href="${verifyUrl}" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none">Confirm secondary email</a></p><p>Or paste this link in your browser: <a href="${verifyUrl}">${verifyUrl}</a></p><p>This link expires in ${EMAIL_VERIFICATION_TTL_HOURS} hours. Until you confirm, this address can't be used to sign in. If you didn't request this, you can ignore the email.</p><p>— Elevated Spaces</p>`,
  });
}

export async function signupService({
  email,
  password,
  name,
  fromDemoBonus = false,
  requestedRole = "USER",
  photographerProfile,
}: {
  email: string;
  password: string;
  name?: string;
  fromDemoBonus?: boolean;
  requestedRole?: string;
  photographerProfile?: {
    bio?: string;
    availability?: string;
    photographerType?: string;
    yearsExperience?: string;
    serviceArea?: string;
    portfolioUrl?: string;
    instagramUrl?: string;
    websiteUrl?: string;
    gearDescription?: string;
    businessName?: string;
    shortPitch?: string;
  };
}) {
  const normalizedEmail = email.trim().toLowerCase();
  // Email may be in use as someone's primary OR secondary.
  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        { email: normalizedEmail },
        { secondary_email: normalizedEmail },
        { secondary_email_pending: normalizedEmail },
      ],
    },
  });
  if (existing) {
    const err: any = new Error("User already exists");
    err.code = "USER_EXISTS";
    throw err;
  }
  const hash = await bcrypt.hash(password, 10);
  const verificationToken = generateEmailVerificationToken();
  const verificationExpiry = new Date(Date.now() + EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000);
  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      password_hash: hash,
      name,
      auth_provider: "LOCAL",
      email_verification_token: verificationToken,
      email_verification_expires_at: verificationExpiry,
      // email_verified_at intentionally left null — set on confirmation.
    },
  });

  const defaultRole = await prisma.roles.upsert({
    where: { name: "USER" },
    update: {},
    create: {
      name: "USER",
      description: "Default role for all users",
    },
  });

  await prisma.user_roles.upsert({
    where: {
      user_id_role_id: {
        user_id: user.id,
        role_id: defaultRole.id,
      },
    },
    update: {},
    create: {
      user_id: user.id,
      role_id: defaultRole.id,
    },
  });

  if (requestedRole === "PHOTOGRAPHER") {
    const photographerRole = await prisma.roles.findUnique({ where: { name: "PHOTOGRAPHER" } });
    if (photographerRole) {
      await prisma.user_roles.create({
        data: {
          user_id: user.id,
          role_id: photographerRole.id,
        },
      });
      await prisma.photographer_profile.create({
        data: {
          user_id: user.id,
          bio: photographerProfile?.bio || null,
          availability: photographerProfile?.availability || null,
          photographer_type: photographerProfile?.photographerType || null,
          years_experience: photographerProfile?.yearsExperience || null,
          service_area: photographerProfile?.serviceArea || null,
          portfolio_url: photographerProfile?.portfolioUrl || null,
          instagram_url: photographerProfile?.instagramUrl || null,
          website_url: photographerProfile?.websiteUrl || null,
          gear_description: photographerProfile?.gearDescription || null,
          business_name: photographerProfile?.businessName || null,
          short_pitch: photographerProfile?.shortPitch || null,
          application_status: "SUBMITTED",
          approved: false,
          documents_url: null,
        },
      });
    }
  }

  // Add 5 bonus credits if signing up from demo bonus offer
  if (fromDemoBonus) {
    await prisma.user_credit_balance.upsert({
      where: { user_id: user.id },
      create: {
        user_id: user.id,
        balance: 5,
      },
      update: {
        balance: {
          increment: 5,
        },
      },
    });
    // Stamp the user so admins can verify the bonus was actually claimed
    await prisma.user.update({
      where: { id: user.id },
      data: { demo_bonus_claimed_at: new Date() },
    });
  }

  // Send the confirmation email. Don't fail the whole signup if email fails —
  // user can use the resend endpoint.
  try {
    await sendVerificationEmail(user.email, user.name, verificationToken);
  } catch (mailErr) {
    console.error("Failed to send verification email:", mailErr);
  }

  return {
    requiresEmailVerification: true,
    user: { id: user.id, email: user.email, name: user.name, role: requestedRole === "PHOTOGRAPHER" ? "PHOTOGRAPHER" : defaultRole.name, created_at: user.created_at },
    success: true,
    message: "Account created. Please check your email to confirm your account before signing in.",
  };
}

export async function verifyEmailService({ token }: { token: string }) {
  if (!token) {
    const err: any = new Error("Verification token is required");
    err.code = "VERIFICATION_TOKEN_MISSING";
    throw err;
  }
  const user = await prisma.user.findUnique({ where: { email_verification_token: token } });
  if (!user) {
    const err: any = new Error("This confirmation link is invalid or has already been used.");
    err.code = "VERIFICATION_TOKEN_INVALID";
    throw err;
  }
  if (user.email_verified_at) {
    return { success: true, alreadyVerified: true, message: "Your account is already confirmed. You can sign in." };
  }
  if (user.email_verification_expires_at && user.email_verification_expires_at.getTime() < Date.now()) {
    const err: any = new Error("This confirmation link has expired. Request a new one from the sign-in page.");
    err.code = "VERIFICATION_TOKEN_EXPIRED";
    throw err;
  }
  await prisma.user.update({
    where: { id: user.id },
    data: {
      email_verified_at: new Date(),
      email_verification_token: null,
      email_verification_expires_at: null,
    },
  });
  return { success: true, message: "Your account has been confirmed. You can now sign in." };
}

export async function resendVerificationEmailService({ email }: { email: string }) {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  // Don't reveal whether the email exists. Just succeed quietly when it doesn't or is already verified.
  if (!user || user.email_verified_at || user.auth_provider !== "LOCAL") {
    return { success: true, message: "If an unverified account exists for that email, a new confirmation has been sent." };
  }
  const verificationToken = generateEmailVerificationToken();
  const verificationExpiry = new Date(Date.now() + EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      email_verification_token: verificationToken,
      email_verification_expires_at: verificationExpiry,
    },
  });
  try {
    await sendVerificationEmail(user.email, user.name, verificationToken);
  } catch (mailErr) {
    console.error("Failed to resend verification email:", mailErr);
  }
  return { success: true, message: "If an unverified account exists for that email, a new confirmation has been sent." };
}

export async function addOrUpdateSecondaryEmailService({ userId, secondaryEmail }: { userId: string; secondaryEmail: string }) {
  const normalized = secondaryEmail.trim().toLowerCase();
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    const err: any = new Error("A valid email address is required");
    err.code = "INVALID_EMAIL";
    throw err;
  }
  const me = await prisma.user.findUnique({ where: { id: userId } });
  if (!me) {
    const err: any = new Error("User not found");
    err.code = "USER_NOT_FOUND";
    throw err;
  }
  if (normalized === me.email.toLowerCase()) {
    const err: any = new Error("Secondary email must be different from your primary email");
    err.code = "SECONDARY_EQUALS_PRIMARY";
    throw err;
  }
  if (me.secondary_email && normalized === me.secondary_email.toLowerCase()) {
    // No change — it's already this user's confirmed secondary.
    return {
      success: true,
      message: "Secondary email is already confirmed",
      secondaryEmail: me.secondary_email,
      pendingSecondaryEmail: null,
      requiresVerification: false,
    };
  }
  // Must not be in use as anyone else's primary, confirmed secondary, or pending secondary.
  const conflict = await prisma.user.findFirst({
    where: {
      AND: [
        { id: { not: userId } },
        {
          OR: [
            { email: normalized },
            { secondary_email: normalized },
            { secondary_email_pending: normalized },
          ],
        },
      ],
    },
    select: { id: true },
  });
  if (conflict) {
    const err: any = new Error("This email is already linked to another account.");
    err.code = "SECONDARY_EMAIL_TAKEN";
    throw err;
  }

  const verificationToken = generateEmailVerificationToken();
  const verificationExpiry = new Date(Date.now() + EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000);

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      secondary_email_pending: normalized,
      secondary_email_verification_token: verificationToken,
      secondary_email_verification_expires_at: verificationExpiry,
    },
  });

  // Send the confirmation link to the new address. The previously-confirmed
  // secondary (if any) stays active until the new one is verified — that way
  // the user doesn't lose login access if they mistype the new address.
  try {
    await sendSecondaryEmailVerification(normalized, me.name, verificationToken);
  } catch (mailErr) {
    console.error("Failed to send secondary-email verification:", mailErr);
  }

  return {
    success: true,
    message: "Confirmation email sent. Click the link in that email to activate the secondary address.",
    secondaryEmail: updated.secondary_email,
    pendingSecondaryEmail: updated.secondary_email_pending,
    requiresVerification: true,
  };
}

export async function verifySecondaryEmailService({ token }: { token: string }) {
  if (!token) {
    const err: any = new Error("Verification token is required");
    err.code = "VERIFICATION_TOKEN_MISSING";
    throw err;
  }
  const user = await prisma.user.findUnique({ where: { secondary_email_verification_token: token } });
  if (!user || !user.secondary_email_pending) {
    const err: any = new Error("This confirmation link is invalid or has already been used.");
    err.code = "VERIFICATION_TOKEN_INVALID";
    throw err;
  }
  if (user.secondary_email_verification_expires_at && user.secondary_email_verification_expires_at.getTime() < Date.now()) {
    const err: any = new Error("This confirmation link has expired. Open Settings and resend it.");
    err.code = "VERIFICATION_TOKEN_EXPIRED";
    throw err;
  }

  const pending = user.secondary_email_pending;

  // Race protection: someone else may have claimed this email since the link
  // was issued (as their primary or confirmed secondary).
  const conflict = await prisma.user.findFirst({
    where: {
      AND: [
        { id: { not: user.id } },
        { OR: [{ email: pending }, { secondary_email: pending }] },
      ],
    },
    select: { id: true },
  });
  if (conflict) {
    // Clear the now-unusable pending state so the slot frees up.
    await prisma.user.update({
      where: { id: user.id },
      data: {
        secondary_email_pending: null,
        secondary_email_verification_token: null,
        secondary_email_verification_expires_at: null,
      },
    });
    const err: any = new Error("This email is now linked to another account. Please choose a different address.");
    err.code = "SECONDARY_EMAIL_TAKEN";
    throw err;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      secondary_email: pending,
      secondary_email_pending: null,
      secondary_email_verification_token: null,
      secondary_email_verification_expires_at: null,
    },
  });

  // Notify the primary email now that the address is actually active.
  try {
    await sendSecondaryEmailAddedNotice(user.email, pending, user.name);
  } catch (mailErr) {
    console.error("Failed to send secondary-email confirmation notice:", mailErr);
  }

  return {
    success: true,
    message: "Your secondary email has been confirmed. You can now sign in with either email.",
    secondaryEmail: pending,
  };
}

export async function resendSecondaryEmailVerificationService({ userId }: { userId: string }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    const err: any = new Error("User not found");
    err.code = "USER_NOT_FOUND";
    throw err;
  }
  if (!user.secondary_email_pending) {
    const err: any = new Error("No secondary email is pending confirmation.");
    err.code = "NO_PENDING_SECONDARY";
    throw err;
  }
  const verificationToken = generateEmailVerificationToken();
  const verificationExpiry = new Date(Date.now() + EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      secondary_email_verification_token: verificationToken,
      secondary_email_verification_expires_at: verificationExpiry,
    },
  });
  try {
    await sendSecondaryEmailVerification(user.secondary_email_pending, user.name, verificationToken);
  } catch (mailErr) {
    console.error("Failed to resend secondary-email verification:", mailErr);
  }
  return { success: true, message: "Confirmation email resent." };
}

export async function removeSecondaryEmailService({ userId }: { userId: string }) {
  await prisma.user.update({
    where: { id: userId },
    data: {
      secondary_email: null,
      secondary_email_pending: null,
      secondary_email_verification_token: null,
      secondary_email_verification_expires_at: null,
    },
  });
  return { success: true, message: "Secondary email removed", secondaryEmail: null, pendingSecondaryEmail: null };
}

export async function loginService({ email, password }: { email: string; password: string }) {
  const normalizedEmail = email.trim().toLowerCase();
  // Look up by primary OR secondary email.
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: normalizedEmail }, { secondary_email: normalizedEmail }] },
  });
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

  // Block LOCAL (manual) signups that haven't confirmed their email.
  if (user.auth_provider === "LOCAL" && !user.email_verified_at) {
    const err: any = new Error("Please confirm your email before signing in. We've sent a confirmation link to your inbox.");
    err.code = "EMAIL_NOT_VERIFIED";
    err.email = user.email;
    throw err;
  }

  const userRoles = await prisma.user_roles.findMany({
    where: { user_id: user.id },
    include: { role: true },
  });

  if (userRoles.length === 0) {
    const err: any = new Error("Invalid Role");
    err.code = "INVALID_USER_ROLE";
    throw err;
  }

  // Pick the highest-privilege role for the single-role contract the
  // frontend uses. Without this, a multi-role user (e.g. ADMIN who also
  // formed a team) would sometimes login as TEAM_OWNER or USER and lose
  // access to the admin nav until the next /auth/me refresh corrected it.
  const roleNames = userRoles.map((r) => r.role.name.toUpperCase());
  const primaryRoleName = roleNames.includes("ADMIN")
    ? "ADMIN"
    : roleNames.includes("PHOTOGRAPHER")
      ? "PHOTOGRAPHER"
      : "USER";
  const userRole = userRoles.find((r) => r.role.name.toUpperCase() === primaryRoleName) || userRoles[0];
  // Always return the user's PRIMARY email here, even when they logged in via
  // their secondary address. The frontend uses this value to display the
  // account identity; surfacing the secondary as the primary would be confusing
  // and could leak the wrong identity into stored auth state.
  const userWithRole = {
    id: user.id,
    email: user.email,
    secondary_email: user.secondary_email,
    name: user.name,
    role: userRole.role.name,
    avatarUrl: (user as any).manual_avatar_url ?? user.avatar_url,
    manualAvatarUrl: (user as any).manual_avatar_url ?? null,
    googleAvatarUrl: user.avatar_url,
    created_at: user.created_at,
  };
  const token = jwt.sign({ userId: user.id, role: userRole.role.name }, JWT_SECRET, { expiresIn: "7d" });
  return {
    token,
    user: userWithRole,
    success: true,
  };
}

export async function updateProfileImageService({
  userId,
  avatarUrl,
}: {
  userId: string;
  avatarUrl: string;
}) {
  const existingUser = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!existingUser) {
    const err: any = new Error("User not found");
    err.code = "USER_NOT_FOUND";
    throw err;
  }

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: {
      manual_avatar_url: avatarUrl,
    },
  });

  const userRole = await prisma.user_roles.findFirst({
    where: { user_id: userId },
    include: { role: true },
  });

  return {
    success: true,
    message: "Profile image updated successfully",
    user: {
      id: updatedUser.id,
      email: updatedUser.email,
      name: updatedUser.name,
      role: userRole?.role.name || "USER",
      avatar_url: updatedUser.manual_avatar_url ?? updatedUser.avatar_url,
      manual_avatar_url: updatedUser.manual_avatar_url,
      google_avatar_url: updatedUser.avatar_url,
      created_at: updatedUser.created_at,
    },
  };
}

export async function deleteProfileImageService({ userId }: { userId: string }) {
  const existingUser = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!existingUser) {
    const err: any = new Error("User not found");
    err.code = "USER_NOT_FOUND";
    throw err;
  }

  // Only clear the manually-uploaded avatar; preserve the Google avatar so it
  // falls back to the OAuth picture instead of disappearing entirely.
  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: {
      manual_avatar_url: null,
    },
  });

  const userRole = await prisma.user_roles.findFirst({
    where: { user_id: userId },
    include: { role: true },
  });

  return {
    success: true,
    message: "Profile image removed successfully",
    user: {
      id: updatedUser.id,
      email: updatedUser.email,
      name: updatedUser.name,
      role: userRole?.role.name || "USER",
      avatar_url: updatedUser.manual_avatar_url ?? updatedUser.avatar_url,
      manual_avatar_url: updatedUser.manual_avatar_url,
      google_avatar_url: updatedUser.avatar_url,
      created_at: updatedUser.created_at,
    },
  };
}