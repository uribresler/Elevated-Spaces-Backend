import { success } from "zod";
import { sendEmail } from "../config/mail.config";
import prisma from "../dbConnection"
import { Request } from "express"
import jwt from 'jsonwebtoken'
import crypto from "crypto";
import { invite_status } from "@prisma/client";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
dotenv.config();

export async function createTeamService(
    { name,
        description,
        userId,
    }: {
        name: string,
        description: string,
        userId: string;
    }) {
    const existing = await prisma.user.findUnique({ where: { id: userId } });
    if (!existing || !userId) {
        const err: any = new Error("User doesnot exists, please create a normal account first");
        err.code = "USER_NOT_FOUND";
        throw err;
    }
    const team = await prisma.teams.create({
        data: {
            name,
            description,
            owner_id: userId,
        }
    })

    return {
        success: true,
        message: "Team created successfully",
        team
    }
}

export async function invitationService({ email, userId, subject, text, teamId }: { email: string, userId: string, subject: string, text: string, teamId: string }) {
    const existing = await prisma.user.findUnique({ where: { id: userId } });
    if (!existing || !userId) {
        const err: any = new Error("User doesnot exists, please create a normal account first");
        err.code = "USER_NOT_FOUND";
        throw err;
    }

    const team_exists = await prisma.teams.findUnique({ where: { id: teamId, owner_id: userId } })
    if (!team_exists) throw new Error("Team doesnot exists or you might not be the owner of team")

    const defaultRole = await prisma.team_roles.findFirst({ where: { name: "TEAM_USER" } })
    if (!defaultRole) throw new Error("Default role not found");

    const rawToken = crypto.randomBytes(32).toString("hex");
    const JWT_SECRET = process.env.JWT_SECRET;

    const inviteToken = jwt.sign(
        {
            email,
            invitedBy: userId,
            roleId: defaultRole.id,
            type: "TEAM_INVITE",
            tokenId: rawToken, // helps revocation
        },
        JWT_SECRET!,
        { expiresIn: "7d" }
    );

    const invite = await prisma.team_invites.upsert({
        where: {
            team_id_email: {
                team_id: team_exists?.id,
                email,
            },
        },
        create: {
            email,
            team_id: team_exists?.id,
            team_role_id: defaultRole?.id,
            role_permissions_snapshot: defaultRole?.permissions?.toLocaleString(),
            invited_by_user_id: userId,
            credit_limit: 0,
            token: inviteToken,
            status: invite_status.PENDING,
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
        update: {
            team_role_id: defaultRole?.id,
            role_permissions_snapshot: defaultRole?.permissions?.toLocaleString(),
            invited_by_user_id: userId,
            credit_limit: 0,
            token: inviteToken,
            status: invite_status.PENDING,
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
            accepted_at: null,
            accepted_by_user_id: null,
        },
    })

    try {
        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
        await sendEmail({
            from: existing.email,
            senderName: existing.name ?? existing.email,
            replyTo: existing.email,
            to: email,
            subject:
                subject ??
                `${existing.email} invited you to join Elevate Spaces`,
            text:
                text ??
                `You’ve been invited!

Accept invite:
${frontendUrl}/accept-invite?token=${inviteToken}`,
            // category: "Team Invitation",
        });
    } catch (err) {
        await prisma.team_invites.update({
            where: { id: invite.id },
            data: { status: invite_status.FAILED },
        });
    }

    return {
        success: true,
        message: "Invitation sent successfully",
        invite
    }
}

export async function acceptInvitationService({
    token,
    name,
    password,
}: {
    token: string;
    name?: string;
    password?: string;
}) {
    if (!token) {
        throw new Error("Invite token is required");
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET!) as {
        email: string;
        roleId: string;
        type: string;
    };

    if (payload.type !== "TEAM_INVITE") {
        throw new Error("Invalid invite token");
    }

    const invite = await prisma.team_invites.findUnique({ where: { token } });
    if (!invite) {
        throw new Error("Invite not found");
    }

    if (invite.status === invite_status.ACCEPTED) {
        return {
            success: true,
            message: "Invitation already accepted",
            accepted: true,
        };
    }

    if (invite.expires_at.getTime() < Date.now()) {
        await prisma.team_invites.update({
            where: { id: invite.id },
            data: { status: invite_status.FAILED },
        });
        throw new Error("Invite has expired");
    }

    let user = await prisma.user.findUnique({ where: { email: payload.email } });

    if (!user) {
        if (!password || !name) {
            return {
                success: true,
                accepted: false,
                requiresSignup: true,
                email: payload.email,
            };
        }

        const hash = await bcrypt.hash(password, 10);
        user = await prisma.user.create({
            data: {
                email: payload.email,
                password_hash: hash,
                name,
                auth_provider: "LOCAL",
            },
        });

        const defaultRole = await prisma.roles.findUnique({ where: { name: "USER" } });
        if (!defaultRole) {
            throw new Error("Default role 'USER' not found");
        }

        await prisma.user_roles.create({
            data: {
                user_id: user.id,
                role_id: defaultRole.id,
            },
        });
    }

    await prisma.team_membership.upsert({
        where: {
            team_id_user_id: {
                team_id: invite.team_id,
                user_id: user.id,
            },
        },
        create: {
            team_id: invite.team_id,
            user_id: user.id,
            team_role_id: invite.team_role_id,
        },
        update: {
            team_role_id: invite.team_role_id,
        },
    });

    await prisma.team_invites.update({
        where: { id: invite.id },
        data: {
            status: invite_status.ACCEPTED,
            accepted_at: new Date(),
            accepted_by_user_id: user.id,
        },
    });

    return {
        success: true,
        message: "Invitation accepted",
        accepted: true,
        teamId: invite.team_id,
        userId: user.id,
    };
}