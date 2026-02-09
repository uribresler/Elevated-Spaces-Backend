import { sendEmail } from "../config/mail.config";
import prisma from "../dbConnection"
import jwt from 'jsonwebtoken'
import crypto from "crypto";
import { invite_status } from "@prisma/client";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
dotenv.config();

const INVITE_EXPIRY_MS = 24 * 60 * 60 * 1000;

function buildInviteToken({
    email,
    invitedBy,
    roleId,
}: {
    email: string;
    invitedBy: string;
    roleId: string;
}) {
    const JWT_SECRET = process.env.JWT_SECRET;
    if (!JWT_SECRET) {
        throw new Error("JWT_SECRET is not configured");
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    return jwt.sign(
        {
            email,
            invitedBy,
            roleId,
            type: "TEAM_INVITE",
            tokenId: rawToken,
        },
        JWT_SECRET,
        { expiresIn: "7d" }
    );
}

function getInviteExpiry() {
    return new Date(Date.now() + INVITE_EXPIRY_MS);
}

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

    const inviteeUser = await prisma.user.findUnique({ where: { email } });
    if (inviteeUser) {
        const existingMembership = await prisma.team_membership.findFirst({
            where: {
                team_id: team_exists.id,
                user_id: inviteeUser.id,
            },
        });

        if (existingMembership) {
            throw new Error("User is already a team member");
        }
    }

    const defaultRole = await prisma.team_roles.findFirst({ where: { name: "TEAM_USER" } })
    if (!defaultRole) throw new Error("Default role not found");

    const inviteToken = buildInviteToken({
        email,
        invitedBy: userId,
        roleId: defaultRole.id,
    });

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
            expires_at: getInviteExpiry(),
        },
        update: {
            team_role_id: defaultRole?.id,
            role_permissions_snapshot: defaultRole?.permissions?.toLocaleString(),
            invited_by_user_id: userId,
            credit_limit: 0,
            token: inviteToken,
            status: invite_status.PENDING,
            expires_at: getInviteExpiry(),
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

        // ✅ Update status to PENDING only if email sent successfully
        await prisma.team_invites.update({
            where: { id: invite.id },
            data: { status: invite_status.PENDING },
        });

        return {
            success: true,
            message: "Invitation sent successfully",
            invite
        };
    } catch (err: any) {
        // ✅ Log detailed error information for debugging
        console.error("❌ Email sending failed:", {
            error: err.message,
            code: err.code,
            command: err.command,
            response: err.response,
            responseCode: err.responseCode,
            email: email,
            smtpHost: process.env.SMTP_HOST,
            timestamp: new Date().toISOString(),
        });

        // ✅ Mark as failed in database
        await prisma.team_invites.update({
            where: { id: invite.id },
            data: {
                status: invite_status.FAILED,
            },
        });

        // ✅ Re-throw the error so frontend gets proper error message
        throw new Error(`Failed to send invitation email: ${err.message || 'Email server error'}`);
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

export async function removeTeamMemberService({
    id,
    owner_id,
    team_id,
    userId
}:
    { id: string, owner_id: string, team_id: string, userId: string }) {

    if (!id || !team_id) {
        throw new Error(
            !id && !team_id
                ? "Member ID and Team ID are required"
                : !id ? "Member ID is required" : "Team ID is required");
    }

    const invite = await prisma.team_invites.findFirst({
        where: { id, team_id },
    });

    if (!invite || !invite.accepted_by_user_id) {
        throw new Error("No such member exists in the team");
    }

    if (invite.accepted_by_user_id === userId) {
        const userCredits = await prisma.team_membership.findFirst({
            where: {
                team_id,
                user_id: userId,
            }
        });

        if (!userCredits) {
            throw new Error("No such member exists in the team");
        }

        const unusedCredits = Math.max(
            Number(userCredits.allocated) - Number(userCredits.used),
            0
        );

        if (unusedCredits > 0) {
            await prisma.teams.update({
                where: { id: team_id },
                data: {
                    wallet: { increment: unusedCredits },
                }
            });
        }

        const removedMembership = await prisma.team_membership.deleteMany({
            where: {
                team_id,
                user_id: userId,
            },
        });

        if (removedMembership.count === 0) {
            throw new Error("No such member exists in the team");
        }

        console.log("TEAM_MEMBER_REMOVED", {
            action: "SELF_REMOVE",
            team_id,
            invite_id: invite.id,
            member_user_id: userId,
            removed_by_user_id: userId,
            timestamp: new Date().toISOString(),
        });

        return {
            success: true,
            message: "You have left the team",
        };
    }

    const ownerVerify = await prisma.teams.findFirst({
        where: {
            id: team_id,
            owner_id: owner_id || userId,
        },
    });

    if (!ownerVerify) {
        throw new Error("Only the team owner can remove members");
    }

    const memberCredits = await prisma.team_membership.findFirst({
        where: {
            team_id,
            user_id: invite.accepted_by_user_id,
        }
    });

    if (!memberCredits) {
        throw new Error("No such member exists in the team");
    }

    const unusedCredits = Math.max(
        Number(memberCredits.allocated) - Number(memberCredits.used),
        0
    );

    if (unusedCredits > 0) {
        await prisma.teams.update({
            where: { id: team_id },
            data: {
                wallet: { increment: unusedCredits },
            }
        });
    }

    const removedMembership = await prisma.team_membership.deleteMany({
        where: {
            team_id,
            user_id: invite.accepted_by_user_id,
        },
    });

    if (removedMembership.count === 0) {
        throw new Error("No such member exists in the team");
    }

    console.log("TEAM_MEMBER_REMOVED", {
        action: "OWNER_REMOVE",
        team_id,
        invite_id: invite.id,
        member_user_id: invite.accepted_by_user_id,
        removed_by_user_id: ownerVerify.owner_id,
        timestamp: new Date().toISOString(),
    });

    return {
        success: true,
        message: "Member removed from the team",
    };
}

export async function reinviteService({
    email,
    userId,
    subject,
    text,
    teamId,
}: {
    email: string;
    userId: string;
    subject: string;
    text: string;
    teamId: string;
}) {
    const existing = await prisma.user.findUnique({ where: { id: userId } });
    if (!existing || !userId) {
        const err: any = new Error("User doesnot exists, please create a normal account first");
        err.code = "USER_NOT_FOUND";
        throw err;
    }

    const team_exists = await prisma.teams.findUnique({ where: { id: teamId, owner_id: userId } });
    if (!team_exists) throw new Error("Team doesnot exists or you might not be the owner of team");

    const defaultRole = await prisma.team_roles.findFirst({ where: { name: "TEAM_USER" } });
    if (!defaultRole) throw new Error("Default role not found");

    const inviteeUser = await prisma.user.findUnique({ where: { email } });
    if (inviteeUser) {
        const existingMembership = await prisma.team_membership.findFirst({
            where: {
                team_id: team_exists.id,
                user_id: inviteeUser.id,
            },
        });

        if (existingMembership) {
            throw new Error("User is already a team member");
        }
    }

    const inviteToken = buildInviteToken({
        email,
        invitedBy: userId,
        roleId: defaultRole.id,
    });

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
            expires_at: getInviteExpiry(),
        },
        update: {
            team_role_id: defaultRole?.id,
            role_permissions_snapshot: defaultRole?.permissions?.toLocaleString(),
            invited_by_user_id: userId,
            credit_limit: 0,
            token: inviteToken,
            status: invite_status.PENDING,
            expires_at: getInviteExpiry(),
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
                `Reminder: ${existing.email} invited you to join Elevate Spaces`,
            text:
                text ??
                `Reminder: you've been invited!\n\nAccept invite:\n${frontendUrl}/accept-invite?token=${inviteToken}`,
        });

        await prisma.team_invites.update({
            where: { id: invite.id },
            data: { status: invite_status.PENDING },
        });

        return {
            success: true,
            message: "Invitation re-sent successfully",
            invite
        };
    } catch (err: any) {
        console.error("❌ Reinvite email failed:", {
            error: err.message,
            code: err.code,
            command: err.command,
            response: err.response,
            responseCode: err.responseCode,
            email: email,
            smtpHost: process.env.SMTP_HOST,
            timestamp: new Date().toISOString(),
        });

        await prisma.team_invites.update({
            where: { id: invite.id },
            data: {
                status: invite_status.FAILED,
            },
        });

        throw new Error(`Failed to send reinvite email: ${err.message || 'Email server error'}`);
    }
}