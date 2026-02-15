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

function buildInviteEmail({
    inviterName,
    inviterEmail,
    teamName,
    acceptUrl,
    expiresAt,
    isReinvite,
}: {
    inviterName: string;
    inviterEmail: string;
    teamName: string;
    acceptUrl: string;
    expiresAt: Date;
    isReinvite?: boolean;
}) {
    const safeInviterName = inviterName || inviterEmail;
    const expiryText = expiresAt.toLocaleString("en-US", { 
        dateStyle: "full", 
        timeStyle: "short" 
    });
    const headline = isReinvite
        ? "Your team invite has been re-sent"
        : "You're invited to join a team";
    const intro = isReinvite
        ? "Your previous invite has been replaced with this new one."
        : "Click the button below to accept your invitation and join the team.";

    const text = `${headline}\n\n` +
        `${intro}\n\n` +
        `Invited by: ${safeInviterName} (${inviterEmail})\n` +
        `Team: ${teamName}\n` +
        `Valid until: ${expiryText}\n\n` +
        `Accept invite: ${acceptUrl}`;

    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
        </head>
        <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 40px 20px;">
                <tr>
                    <td align="center">
                        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
                            <tr>
                                <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 32px 24px; text-align: center;">
                                    <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">${headline}</h1>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding: 32px 24px;">
                                    <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.5; color: #334155;">${intro}</p>
                                    
                                    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; margin: 24px 0;">
                                        <tr>
                                            <td style="padding: 20px;">
                                                <p style="margin: 0 0 12px 0; font-size: 14px; color: #475569;"><strong style="color: #0f172a;">Invited by:</strong> ${safeInviterName}</p>
                                                <p style="margin: 0 0 12px 0; font-size: 14px; color: #475569;"><strong style="color: #0f172a;">Email:</strong> ${inviterEmail}</p>
                                                <p style="margin: 0 0 12px 0; font-size: 14px; color: #475569;"><strong style="color: #0f172a;">Team:</strong> ${teamName}</p>
                                                <p style="margin: 0; font-size: 14px; color: #475569;"><strong style="color: #0f172a;">Valid until:</strong> ${expiryText}</p>
                                            </td>
                                        </tr>
                                    </table>
                                    
                                    <table width="100%" cellpadding="0" cellspacing="0">
                                        <tr>
                                            <td align="center" style="padding: 24px 0;">
                                                <a href="${acceptUrl}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: 600; box-shadow: 0 4px 6px rgba(102, 126, 234, 0.3);">Accept Invitation</a>
                                            </td>
                                        </tr>
                                    </table>
                                    
                                    <p style="margin: 24px 0 0 0; font-size: 13px; line-height: 1.6; color: #64748b; text-align: center;">If the button doesn't work, copy and paste this URL into your browser:<br><a href="${acceptUrl}" style="color: #667eea; word-break: break-all;">${acceptUrl}</a></p>
                                </td>
                            </tr>
                            <tr>
                                <td style="background-color: #f8fafc; padding: 20px 24px; text-align: center; border-top: 1px solid #e2e8f0;">
                                    <p style="margin: 0; font-size: 12px; color: #94a3b8;">This invitation will expire in 24 hours. If you didn't expect this invitation, you can safely ignore this email.</p>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </body>
        </html>
    `;

    return { text, html };
}

async function getTeamAccess({
    teamId,
    userId,
}: {
    teamId: string;
    userId: string;
}) {
    const team = await prisma.teams.findUnique({ where: { id: teamId } });
    if (!team) {
        throw new Error("Team doesnot exists");
    }

    if (team.owner_id === userId) {
        return { team, roleName: "TEAM_OWNER" };
    }

    const membership = await prisma.team_membership.findUnique({
        where: { team_id_user_id: { team_id: teamId, user_id: userId } },
        include: { role: true },
    });

    if (!membership) {
        throw new Error("You are not a member of this team");
    }

    return { team, roleName: membership.role.name };
}

function resolveInviteRoleName(roleName?: string) {
    const normalized = roleName?.trim().toUpperCase();
    const allowedRoles = ["TEAM_MEMBER", "TEAM_AGENT", "TEAM_PHOTOGRAPHER", "TEAM_ADMIN"];

    if (!normalized) {
        return "TEAM_MEMBER";
    }

    if (!allowedRoles.includes(normalized)) {
        throw new Error("Invalid team role for invite");
    }

    return normalized;
}

function canInviteRole(inviterRole: string, requestedRole: string) {
    if (inviterRole === "TEAM_OWNER" || inviterRole === "TEAM_ADMIN") {
        return requestedRole !== "TEAM_OWNER";
    }

    if (inviterRole === "TEAM_AGENT") {
        return requestedRole === "TEAM_PHOTOGRAPHER";
    }

    return false;
}

function normalizeAssignableRole(roleName: string) {
    const normalized = roleName.trim().toUpperCase();
    if (normalized === "TEAM_USER") {
        return "TEAM_MEMBER";
    }

    const allowedRoles = ["TEAM_ADMIN", "TEAM_AGENT", "TEAM_PHOTOGRAPHER", "TEAM_MEMBER"];
    if (!allowedRoles.includes(normalized)) {
        throw new Error("Invalid team role assignment");
    }

    return normalized;
}

function canAssignRole(assignerRole: string, requestedRole: string) {
    if (assignerRole === "TEAM_OWNER") {
        return true;
    }

    if (assignerRole === "TEAM_ADMIN") {
        return ["TEAM_PHOTOGRAPHER", "TEAM_AGENT", "TEAM_MEMBER"].includes(requestedRole);
    }

    return false;
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

export async function invitationService({ email, userId, subject, text, teamId, roleName }: { email: string, userId: string, subject: string, text: string, teamId: string, roleName?: string }) {
    const existing = await prisma.user.findUnique({ where: { id: userId } });
    if (!existing || !userId) {
        const err: any = new Error("User doesnot exists, please create a normal account first");
        err.code = "USER_NOT_FOUND";
        throw err;
    }

    const { team: team_exists, roleName: inviterRole } = await getTeamAccess({ teamId, userId });
    const inviteRoleName = resolveInviteRoleName(roleName);
    if (!canInviteRole(inviterRole, inviteRoleName)) {
        throw new Error("You are not allowed to invite this role");
    }

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

    const defaultRole = await prisma.team_roles.findFirst({
        where: { name: inviteRoleName },
    }) || await prisma.team_roles.findFirst({ where: { name: "TEAM_USER" } });
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

    // Send email asynchronously (non-blocking)
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const acceptUrl = `${frontendUrl}/accept-invite?token=${inviteToken}`;
    const emailTemplate = buildInviteEmail({
        inviterName: existing.name ?? existing.email,
        inviterEmail: existing.email,
        teamName: team_exists.name,
        acceptUrl,
        expiresAt: invite.expires_at,
    });

    // Send email in background without awaiting
    setImmediate(async () => {
        try {
            await sendEmail({
                from: existing.email,
                senderName: existing.name ?? "Elevated Spaces Team",
                replyTo: existing.email,
                to: email,
                subject: subject ?? `Join ${team_exists.name} - Team Invitation`,
                text: text ?? emailTemplate.text,
                html: emailTemplate.html,
            });

            // Update status to PENDING if email sent successfully
            await prisma.team_invites.update({
                where: { id: invite.id },
                data: { status: invite_status.PENDING },
            });

            console.log(`✅ Invitation email sent to ${email}`);
        } catch (err: any) {
            console.error("❌ Email sending failed:", {
                error: err.message,
                email: email,
                inviteId: invite.id,
            });

            // Mark as failed in database
            await prisma.team_invites.update({
                where: { id: invite.id },
                data: { status: invite_status.FAILED },
            }).catch(console.error);
        }
    });

    // Return immediately without waiting for email
    return {
        success: true,
        message: "Invitation is being sent",
        invite
    };
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
        throw new Error("This invite has been expired, please check your inbox for a newer invite");
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
    roleName,
}: {
    email: string;
    userId: string;
    subject: string;
    text: string;
    teamId: string;
    roleName?: string;
}) {
    const existing = await prisma.user.findUnique({ where: { id: userId } });
    if (!existing || !userId) {
        const err: any = new Error("User doesnot exists, please create a normal account first");
        err.code = "USER_NOT_FOUND";
        throw err;
    }

    const { team: team_exists, roleName: inviterRole } = await getTeamAccess({ teamId, userId });
    const inviteRoleName = resolveInviteRoleName(roleName);
    if (!canInviteRole(inviterRole, inviteRoleName)) {
        throw new Error("You are not allowed to invite this role");
    }

    const defaultRole = await prisma.team_roles.findFirst({
        where: { name: inviteRoleName },
    }) || await prisma.team_roles.findFirst({ where: { name: "TEAM_USER" } });
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

    // Build email template
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const acceptUrl = `${frontendUrl}/accept-invite?token=${inviteToken}`;
    const emailTemplate = buildInviteEmail({
        inviterName: existing.name ?? existing.email,
        inviterEmail: existing.email,
        teamName: team_exists.name,
        acceptUrl,
        expiresAt: invite.expires_at,
        isReinvite: true,
    });

    // Send reinvite email asynchronously (non-blocking)
    setImmediate(async () => {
        try {
            await sendEmail({
                from: existing.email,
                senderName: existing.name ?? "Elevated Spaces Team",
                replyTo: existing.email,
                to: email,
                subject: subject ?? `Reminder: Join ${team_exists.name} - Team Invitation`,
                text: text ?? emailTemplate.text,
                html: emailTemplate.html,
            });

            // Update status to PENDING if email sent successfully
            await prisma.team_invites.update({
                where: { id: invite.id },
                data: { status: invite_status.PENDING },
            });

            console.log(`✅ Reinvite email sent to ${email}`);
        } catch (err: any) {
            console.error("❌ Reinvite email failed:", {
                error: err.message,
                email: email,
                inviteId: invite.id,
            });

            // Mark as failed in database
            await prisma.team_invites.update({
                where: { id: invite.id },
                data: { status: invite_status.FAILED },
            }).catch(console.error);
        }
    });

    // Return immediately without waiting for email
    return {
        success: true,
        message: "Invitation is being re-sent",
        invite
    };
}

export async function updateTeamMemberRoleService({
    teamId,
    memberId,
    roleName,
    userId,
}: {
    teamId: string;
    memberId: string;
    roleName: string;
    userId: string;
}) {
    if (!teamId || !memberId || !roleName) {
        throw new Error("Team ID, member ID, and role are required");
    }

    const { team, roleName: assignerRole } = await getTeamAccess({ teamId, userId });
    const normalizedRole = normalizeAssignableRole(roleName);

    if (!canAssignRole(assignerRole, normalizedRole)) {
        throw new Error("You are not allowed to assign this role");
    }

    const membership = await prisma.team_membership.findUnique({
        where: { team_id_user_id: { team_id: team.id, user_id: memberId } },
    });

    if (!membership) {
        throw new Error("Member not found in this team");
    }

    const role = await prisma.team_roles.findFirst({ where: { name: normalizedRole } });
    if (!role) {
        throw new Error("Role not found");
    }

    const updated = await prisma.team_membership.update({
        where: { team_id_user_id: { team_id: team.id, user_id: memberId } },
        data: { team_role_id: role.id },
        include: { role: true, user: true, team: true },
    });

    return {
        success: true,
        message: "Member role updated successfully",
        membership: updated,
    };
}