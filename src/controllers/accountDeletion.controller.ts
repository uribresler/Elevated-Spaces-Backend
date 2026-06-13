import { Request, Response } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import prisma from "../dbConnection";
import { logger } from "../utils/logger";
import { sendEmail } from "../config/mail.config";

const CODE_TTL_MINUTES = 15;
const GRACE_PERIOD_DAYS = 7;

function generateCode(): string {
  // 6-digit numeric code
  const buf = crypto.randomBytes(4).readUInt32BE(0) % 1000000;
  return buf.toString().padStart(6, "0");
}

function formatDeadline(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(date);
}

export async function requestAccountDeletion(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    if ((user as any).deletion_requested_at) {
      res.status(400).json({ success: false, message: "An account deletion request is already in progress." });
      return;
    }

    const code = generateCode();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

    await prisma.user.update({
      where: { id: userId },
      data: {
        deletion_code_hash: codeHash,
        deletion_code_expires_at: expiresAt,
      } as any,
    });

    const text = `Hi ${user.name || ""},\n\nWe received a request to delete your Elevated Spaces account.\n\nYour verification code is: ${code}\n\nThis code expires in ${CODE_TTL_MINUTES} minutes. If you did not request this, you can safely ignore this email — no changes will be made until the code is entered.`;
    const html = `<p>Hi ${user.name || ""},</p><p>We received a request to delete your Elevated Spaces account.</p><p>Your verification code is:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px">${code}</p><p>This code expires in ${CODE_TTL_MINUTES} minutes. If you did not request this, you can safely ignore this email — no changes will be made until the code is entered.</p>`;

    await sendEmail({
      from: "",
      senderName: "Elevated Spaces",
      to: user.email,
      subject: "Verify your account deletion request",
      text,
      html,
    });

    res.status(200).json({ success: true, message: "Verification code sent to your email." });
  } catch (error) {
    logger(`[ACCOUNT_DELETION] request failed: ${String(error)}`);
    res.status(500).json({ success: false, message: "Failed to start deletion request" });
  }
}

export async function verifyAccountDeletion(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const code = typeof req.body.code === "string" ? req.body.code.trim() : "";
    if (!code) {
      res.status(400).json({ success: false, message: "Verification code is required" });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    const codeHash = (user as any).deletion_code_hash as string | null;
    const codeExpiresAt = (user as any).deletion_code_expires_at as Date | null;

    if (!codeHash || !codeExpiresAt) {
      res.status(400).json({ success: false, message: "No active deletion request. Please start over." });
      return;
    }

    if (codeExpiresAt.getTime() < Date.now()) {
      res.status(400).json({ success: false, message: "Verification code expired. Please request a new one." });
      return;
    }

    const matches = await bcrypt.compare(code, codeHash);
    if (!matches) {
      res.status(400).json({ success: false, message: "Incorrect verification code." });
      return;
    }

    const now = new Date();
    const purgeAt = new Date(now.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);

    await prisma.user.update({
      where: { id: userId },
      data: {
        deletion_requested_at: now,
        deletion_purge_at: purgeAt,
        deletion_code_hash: null,
        deletion_code_expires_at: null,
      } as any,
    });

    const deadline = formatDeadline(purgeAt);
    const text = `Hi ${user.name || ""},\n\nYour Elevated Spaces account is now scheduled for permanent deletion on ${deadline}.\n\nUntil then your account is inactive and you cannot sign in. If you change your mind, contact support before ${deadline} and an admin will restore access.\n\nAfter that time, all data will be permanently removed.`;
    const html = `<p>Hi ${user.name || ""},</p><p>Your Elevated Spaces account is now scheduled for permanent deletion on <strong>${deadline}</strong>.</p><p>Until then your account is inactive and you cannot sign in. If you change your mind, contact support before that time and an admin will restore access.</p><p>After that time, all data will be permanently removed.</p>`;

    await sendEmail({
      from: "",
      senderName: "Elevated Spaces",
      to: user.email,
      subject: "Your account is scheduled for deletion",
      text,
      html,
    });

    res.status(200).json({
      success: true,
      message: "Account scheduled for deletion.",
      data: {
        purgeAt: purgeAt.toISOString(),
        deadlineHuman: deadline,
      },
    });
  } catch (error) {
    logger(`[ACCOUNT_DELETION] verify failed: ${String(error)}`);
    res.status(500).json({ success: false, message: "Failed to verify deletion request" });
  }
}

async function ensureAdmin(userId: string): Promise<boolean> {
  const role = await prisma.user_roles.findFirst({
    where: { user_id: userId },
    include: { role: true },
  });
  return role?.role?.name === "ADMIN";
}

async function purgeOverdueDeletions(): Promise<number> {
  const now = new Date();
  const overdue = await prisma.user.findMany({
    where: { deletion_purge_at: { lte: now } } as any,
    select: { id: true } as any,
  });
  for (const u of overdue) {
    try {
      await prisma.user.delete({ where: { id: (u as any).id } });
    } catch (error) {
      logger(`[ACCOUNT_DELETION] purge failed for ${(u as any).id}: ${String(error)}`);
    }
  }
  return overdue.length;
}

export async function listPendingDeletions(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId || !(await ensureAdmin(userId))) {
      res.status(403).json({ success: false, message: "Forbidden" });
      return;
    }

    await purgeOverdueDeletions();

    const users = await prisma.user.findMany({
      where: { deletion_requested_at: { not: null } } as any,
      select: {
        id: true,
        email: true,
        name: true,
        deletion_requested_at: true,
        deletion_purge_at: true,
      } as any,
      orderBy: { deletion_purge_at: "asc" } as any,
    });

    res.status(200).json({ success: true, data: users });
  } catch (error) {
    logger(`[ACCOUNT_DELETION] list failed: ${String(error)}`);
    res.status(500).json({ success: false, message: "Failed to list pending deletions" });
  }
}

export async function revertAccountDeletion(req: Request, res: Response): Promise<void> {
  try {
    const adminId = req.user?.id;
    if (!adminId || !(await ensureAdmin(adminId))) {
      res.status(403).json({ success: false, message: "Forbidden" });
      return;
    }

    const targetUserId = typeof req.params.userId === "string" ? req.params.userId : "";
    if (!targetUserId) {
      res.status(400).json({ success: false, message: "userId is required" });
      return;
    }

    const target = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    if (!(target as any).deletion_requested_at) {
      res.status(400).json({ success: false, message: "User does not have a pending deletion" });
      return;
    }

    await prisma.user.update({
      where: { id: targetUserId },
      data: {
        deletion_requested_at: null,
        deletion_purge_at: null,
        deletion_code_hash: null,
        deletion_code_expires_at: null,
      } as any,
    });

    try {
      await sendEmail({
        from: "",
        senderName: "Elevated Spaces",
        to: target.email,
        subject: "Your account has been restored",
        text: `Hi ${target.name || ""},\n\nGood news — an admin has restored access to your Elevated Spaces account. You can sign in again any time.`,
        html: `<p>Hi ${target.name || ""},</p><p>Good news — an admin has restored access to your Elevated Spaces account. You can sign in again any time.</p>`,
      });
    } catch (mailError) {
      logger(`[ACCOUNT_DELETION] revert email failed: ${String(mailError)}`);
    }

    res.status(200).json({ success: true, message: "Account deletion reverted." });
  } catch (error) {
    logger(`[ACCOUNT_DELETION] revert failed: ${String(error)}`);
    res.status(500).json({ success: false, message: "Failed to revert deletion" });
  }
}
