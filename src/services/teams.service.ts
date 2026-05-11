import { sendEmail } from "../config/mail.config";
import prisma from "../dbConnection"
import jwt from 'jsonwebtoken'
import crypto from "crypto";
import { invite_status } from "@prisma/client";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
import Stripe from "stripe";
dotenv.config();

// const INVITE_EXPIRY_MS = 24 * 60 * 60 * 1000;
const INVITE_EXPIRY_MS = 24 * 60 * 60 * 1000;
const STRIPE_API_VERSION = "2025-12-15.clover";
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION }) : null;

const ACTIVE_SUBSCRIPTION_STATUSES = new Set([
    "active",
    "trialing",
    "past_due",
    "unpaid",
]);

function getSubscriptionStatusPriority(status: string): number {
    switch (status) {
        case "active":
            return 4;
        case "trialing":
            return 3;
        case "past_due":
            return 2;
        case "unpaid":
            return 1;
        default:
            return 0;
    }
}
const EXTRA_SEAT_BILLING_DAYS = 30;
const EXTRA_SEAT_NON_RENEW_RETENTION_DAYS = 30;

type TeamSeatPolicy = {
    planKey: string;
    planLabel: string;
    freeAdditionalUsers: number;
    extraSeatPriceUsdMonthly: number | null;
    extraSeatProductKey: "pro_extra_user_seat" | "team_extra_user_seat" | null;
    unlimited: boolean;
};

function getTeamSeatPolicyForProductKey(productKey?: string | null): TeamSeatPolicy | null {
    switch (productKey) {
        case "starter":
        case "starter_annual":
            return {
                planKey: productKey,
                planLabel: "Starter",
                freeAdditionalUsers: 0,
                extraSeatPriceUsdMonthly: null,
                extraSeatProductKey: null,
                unlimited: false,
            };
        case "pro":
        case "pro_annual":
            return {
                planKey: productKey,
                planLabel: "Pro",
                freeAdditionalUsers: 2,
                extraSeatPriceUsdMonthly: 20,
                extraSeatProductKey: "pro_extra_user_seat",
                unlimited: false,
            };
        case "team":
        case "team_annual":
            return {
                planKey: productKey,
                planLabel: "Team",
                freeAdditionalUsers: 5,
                extraSeatPriceUsdMonthly: 15,
                extraSeatProductKey: "team_extra_user_seat",
                unlimited: false,
            };
        case "enterprise":
        case "enterprise_annual":
            return {
                planKey: productKey,
                planLabel: "Enterprise",
                freeAdditionalUsers: Number.MAX_SAFE_INTEGER,
                extraSeatPriceUsdMonthly: null,
                extraSeatProductKey: null,
                unlimited: true,
            };
        default:
            if (typeof productKey === "string" && productKey.toLowerCase().includes("enterprise")) {
                return {
                    planKey: productKey,
                    planLabel: "Enterprise",
                    freeAdditionalUsers: Number.MAX_SAFE_INTEGER,
                    extraSeatPriceUsdMonthly: null,
                    extraSeatProductKey: null,
                    unlimited: true,
                };
            }
            return null;
    }
}

function buildTeamSeatLimitError(params: {
    policy: TeamSeatPolicy;
    activeMembers: number;
    pendingInvites: number;
    purchasedExtraSeats: number;
}) {
    const { policy, activeMembers, pendingInvites, purchasedExtraSeats } = params;
    const included = policy.freeAdditionalUsers;
    const allowed = included + purchasedExtraSeats;
    const message = policy.extraSeatPriceUsdMonthly && policy.extraSeatProductKey
        ? `Team member limit reached for ${policy.planLabel}. Included users: ${included}. Extra users cost $${policy.extraSeatPriceUsdMonthly}/month each.`
        : `Team member limit reached for ${policy.planLabel}. Additional users are not available on this plan.`;

    const error: any = new Error(message);
    error.code = "TEAM_SEAT_LIMIT_REACHED";
    error.details = {
        planKey: policy.planKey,
        planLabel: policy.planLabel,
        freeIncludedUsers: included,
        activeMembers,
        pendingInvites,
        purchasedExtraSeats,
        allowedMembers: allowed,
        allowPurchaseExtraSeats: Boolean(policy.extraSeatProductKey),
        extraSeatProductKey: policy.extraSeatProductKey,
        extraSeatPriceUsdMonthly: policy.extraSeatPriceUsdMonthly,
    };
    return error;
}

function buildTeamPlanRequiredError() {
    const error: any = new Error(
        "Team collaboration isn't available on the Starter plan. Upgrade to Pro, Team, or Enterprise to create a team & invite team members."
    );
    error.code = "TEAM_PLAN_REQUIRED";
    error.details = {
        allowPurchasePlan: true,
        message: "Upgrade your plan to enable team collaboration and inviting members.",
    };
    return error;
}

type ActiveTeamSeatContext = {
    policy: TeamSeatPolicy | null;
    purchasedExtraSeats: number;
    seatEntitlements: Array<{
        autoRenew: boolean;
        paidAt: Date;
        expiresAt: Date;
        productKey: string;
    }>;
};

function addDays(base: Date, days: number): Date {
    return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

function isFutureDate(value: Date | null | undefined, now: Date): boolean {
    return value instanceof Date && value.getTime() > now.getTime();
}

async function getActiveTeamSeatContext(teamId: string): Promise<ActiveTeamSeatContext> {
    if (!stripe) {
        return { policy: null, purchasedExtraSeats: 0, seatEntitlements: [] };
    }

    const team = await prisma.teams.findUnique({
        where: { id: teamId },
        include: { owner: true },
    });

    const customerId = team?.owner?.stripe_customer_id;
    if (!customerId) {
        return { policy: null, purchasedExtraSeats: 0, seatEntitlements: [] };
    }

    const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 100,
    });

    let policy: TeamSeatPolicy | null = null;
    let selectedPlanMeta: { includedUsers: number; statusPriority: number; sortEpoch: number } | null = null;
    let purchasedExtraSeats = 0;
    const seatEntitlements: ActiveTeamSeatContext["seatEntitlements"] = [];
    const ownerUserId = team?.owner_id;

    for (const subscription of subscriptions.data) {
        if (!ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status)) {
            continue;
        }

        const metadata = subscription.metadata || {};
        const isOwnerPlan = metadata.purchaseFor === "individual" && metadata.userId === ownerUserId;
        const isTeamPlan = metadata.purchaseFor === "team" && metadata.teamId === teamId && metadata.userId === ownerUserId;
        if (!isOwnerPlan && !isTeamPlan) {
            continue;
        }

        const subscriptionProductKey = metadata.productKey;

        const parsedQty = Number(metadata.seatUnits || metadata.quantity || "1");
        const seatUnits = Number.isFinite(parsedQty) && parsedQty > 0 ? parsedQty : 1;

        if (subscriptionProductKey === "pro_extra_user_seat" || subscriptionProductKey === "team_extra_user_seat") {
            purchasedExtraSeats += seatUnits;
            const autoRenew = String(metadata.seatAutoRenew || "true").toLowerCase() !== "false";
            const periodStartEpoch = (subscription as any)?.current_period_start;
            const currentPeriodStart = typeof periodStartEpoch === "number"
                ? new Date(periodStartEpoch * 1000)
                : new Date();
            const expiresAt = autoRenew
                ? addDays(currentPeriodStart, EXTRA_SEAT_BILLING_DAYS)
                : addDays(currentPeriodStart, EXTRA_SEAT_NON_RENEW_RETENTION_DAYS);
            for (let i = 0; i < seatUnits; i += 1) {
                seatEntitlements.push({
                    autoRenew,
                    paidAt: currentPeriodStart,
                    expiresAt,
                    productKey: subscriptionProductKey,
                });
            }
            continue;
        }

        const parsedPolicy = getTeamSeatPolicyForProductKey(subscriptionProductKey);
        if (parsedPolicy) {
            const periodStartEpoch = (subscription as any)?.current_period_start;
            const createdEpoch = typeof subscription.created === "number" ? subscription.created : 0;
            const sortEpoch = typeof periodStartEpoch === "number" ? periodStartEpoch : createdEpoch;
            const statusPriority = getSubscriptionStatusPriority(subscription.status);

            const shouldReplace = !selectedPlanMeta
                || parsedPolicy.freeAdditionalUsers > selectedPlanMeta.includedUsers
                || (parsedPolicy.freeAdditionalUsers === selectedPlanMeta.includedUsers
                    && (
                        statusPriority > selectedPlanMeta.statusPriority
                        || (statusPriority === selectedPlanMeta.statusPriority && sortEpoch > selectedPlanMeta.sortEpoch)
                    ));

            if (shouldReplace) {
                policy = parsedPolicy;
                selectedPlanMeta = {
                    includedUsers: parsedPolicy.freeAdditionalUsers,
                    statusPriority,
                    sortEpoch,
                };
            }
        }
    }

    return { policy, purchasedExtraSeats, seatEntitlements };
}

export async function enforceTeamSeatCapacityForExistingMembers(teamId: string): Promise<void> {
    const { policy, purchasedExtraSeats, seatEntitlements } = await getActiveTeamSeatContext(teamId);
    if (!policy || policy.unlimited) {
        return;
    }

    const now = new Date();
    await prisma.team_membership.updateMany({
        where: {
            team_id: teamId,
            deleted_at: null,
            is_paid_extra_seat: true,
            seat_auto_renew: false,
            seat_expires_at: {
                lte: now,
            },
        },
        data: {
            deleted_at: now,
            is_paid_extra_seat: false,
            seat_auto_renew: false,
            seat_last_paid_at: null,
            seat_expires_at: null,
            seat_payment_product_key: null,
        },
    });

    const activeMemberships = await prisma.team_membership.findMany({
        where: {
            team_id: teamId,
            deleted_at: null,
        },
        select: {
            id: true,
            joined_at: true,
            is_paid_extra_seat: true,
            seat_auto_renew: true,
            seat_expires_at: true,
        },
        orderBy: {
            joined_at: "asc",
        },
    });

    const reservedNonRenewSeats = activeMemberships.filter((membership) => (
        membership.is_paid_extra_seat &&
        membership.seat_auto_renew === false &&
        isFutureDate(membership.seat_expires_at, now)
    )).length;

    const includedMembers = activeMemberships.slice(0, policy.freeAdditionalUsers);
    const extraMembers = activeMemberships.slice(policy.freeAdditionalUsers);
    const paidByReservedIds = new Set(
        extraMembers
            .filter((membership) => (
                membership.is_paid_extra_seat &&
                membership.seat_auto_renew === false &&
                isFutureDate(membership.seat_expires_at, now)
            ))
            .map((membership) => membership.id)
    );

    const seatsAvailableFromPurchases = Math.max(0, purchasedExtraSeats);
    const paidCandidates = extraMembers.filter((membership) => !paidByReservedIds.has(membership.id));
    const paidByPurchase = paidCandidates.slice(0, seatsAvailableFromPurchases);
    const shouldBePaidIds = new Set<string>([
        ...Array.from(paidByReservedIds),
        ...paidByPurchase.map((membership) => membership.id),
    ]);

    const includedIds = new Set(includedMembers.map((membership) => membership.id));
    const overLimitMembers = activeMemberships.filter(
        (membership) => !includedIds.has(membership.id) && !shouldBePaidIds.has(membership.id)
    );

    if (overLimitMembers.length > 0) {
        const memberIdsToDisable = overLimitMembers.map((membership) => membership.id);
        await prisma.team_membership.updateMany({
            where: {
                id: { in: memberIdsToDisable },
                deleted_at: null,
            },
            data: {
                deleted_at: now,
                is_paid_extra_seat: false,
                seat_auto_renew: false,
                seat_last_paid_at: null,
                seat_expires_at: null,
                seat_payment_product_key: null,
            },
        });
    }

    const defaultEntitlement = seatEntitlements[0] || null;
    const purchasedPaidMemberIds = paidByPurchase.map((membership) => membership.id);
    if (purchasedPaidMemberIds.length > 0) {
        const autoRenew = defaultEntitlement?.autoRenew ?? true;
        const paidAt = defaultEntitlement?.paidAt ?? now;
        const expiresAt = defaultEntitlement?.expiresAt ?? (autoRenew
            ? addDays(paidAt, EXTRA_SEAT_BILLING_DAYS)
            : addDays(paidAt, EXTRA_SEAT_NON_RENEW_RETENTION_DAYS));
        const productKey = defaultEntitlement?.productKey ?? policy.extraSeatProductKey ?? null;

        await prisma.team_membership.updateMany({
            where: {
                id: { in: purchasedPaidMemberIds },
                deleted_at: null,
            },
            data: {
                is_paid_extra_seat: true,
                seat_auto_renew: autoRenew,
                seat_last_paid_at: paidAt,
                seat_expires_at: expiresAt,
                seat_payment_product_key: productKey,
            },
        });
    }

    await prisma.team_membership.updateMany({
        where: {
            team_id: teamId,
            deleted_at: null,
            is_paid_extra_seat: true,
            id: {
                notIn: Array.from(shouldBePaidIds),
            },
        },
        data: {
            is_paid_extra_seat: false,
            seat_auto_renew: false,
            seat_last_paid_at: null,
            seat_expires_at: null,
            seat_payment_product_key: null,
        },
    });
}

async function assertTeamSeatCapacityForInvite(teamId: string, inviteEmail: string): Promise<void> {
    const { policy, purchasedExtraSeats } = await getActiveTeamSeatContext(teamId);
    if (!policy) {
        throw buildTeamPlanRequiredError();
    }

    if (policy.unlimited) {
        return;
    }

    await enforceTeamSeatCapacityForExistingMembers(teamId);

    const now = new Date();
    const retainedPaidSeats = await prisma.team_membership.count({
        where: {
            team_id: teamId,
            deleted_at: null,
            is_paid_extra_seat: true,
            seat_auto_renew: false,
            seat_expires_at: {
                gt: now,
            },
        },
    });

    const [activeMembershipsCount, pendingInvitesCount] = await Promise.all([
        prisma.team_membership.count({
            where: {
                team_id: teamId,
                deleted_at: null,
            },
        }),
        prisma.team_invites.count({
            where: {
                team_id: teamId,
                status: invite_status.PENDING,
                email: { not: inviteEmail },
            },
        }),
    ]);

    const allowedMembers = policy.freeAdditionalUsers + purchasedExtraSeats + retainedPaidSeats;
    const projectedMembers = activeMembershipsCount + pendingInvitesCount + 1;

    if (projectedMembers > allowedMembers) {
        throw buildTeamSeatLimitError({
            policy,
            activeMembers: activeMembershipsCount,
            pendingInvites: pendingInvitesCount,
            purchasedExtraSeats,
        });
    }
}

async function assertTeamSeatCapacityForAcceptance(teamId: string): Promise<void> {
    const { policy, purchasedExtraSeats } = await getActiveTeamSeatContext(teamId);
    if (!policy) {
        throw buildTeamPlanRequiredError();
    }

    if (policy.unlimited) {
        return;
    }

    await enforceTeamSeatCapacityForExistingMembers(teamId);

    const now = new Date();
    const retainedPaidSeats = await prisma.team_membership.count({
        where: {
            team_id: teamId,
            deleted_at: null,
            is_paid_extra_seat: true,
            seat_auto_renew: false,
            seat_expires_at: {
                gt: now,
            },
        },
    });

    const activeMembershipsCount = await prisma.team_membership.count({
        where: {
            team_id: teamId,
            deleted_at: null,
        },
    });

    const allowedMembers = policy.freeAdditionalUsers + purchasedExtraSeats + retainedPaidSeats;
    const projectedMembers = activeMembershipsCount + 1;
    if (projectedMembers > allowedMembers) {
        throw buildTeamSeatLimitError({
            policy,
            activeMembers: activeMembershipsCount,
            pendingInvites: 0,
            purchasedExtraSeats,
        });
    }
}

const TEAM_ROLE_ALIASES: Record<string, string> = {
    TEAM_ADMIN: "ADMIN",
    TEAM_AGENT: "MEMBER",
    TEAM_PHOTOGRAPHER: "PHOTOGRAPHER",
};

function normalizeTeamRoleName(roleName: string) {
    const normalized = roleName.trim().toUpperCase();
    return TEAM_ROLE_ALIASES[normalized] || normalized;
}

const DEFAULT_TEAM_ROLE_DEFINITIONS: Record<string, { description: string; permissions: Record<string, boolean> }> = {
    TEAM_OWNER: {
        description: "Full control over the team",
        permissions: {
            manage_team: true,
            manage_roles: true,
            invite_members: true,
            remove_members: true,
            assign_credits: true,
            manage_projects: true,
            view_all_projects: true,
            manage_wallet: true,
        },
    },
    ADMIN: {
        description: "Admin control over the team",
        permissions: {
            manage_team: true,
            manage_roles: true,
            invite_members: true,
            remove_members: true,
            assign_credits: true,
            manage_projects: true,
            view_all_projects: true,
            manage_wallet: false,
        },
    },
    MEMBER: {
        description: "Member role with project creation and invite permissions",
        permissions: {
            manage_team: false,
            manage_roles: false,
            invite_members: true,
            remove_members: false,
            assign_credits: false,
            manage_projects: true,
            view_all_projects: false,
            manage_wallet: false,
        },
    },
    PHOTOGRAPHER: {
        description: "Photographer role with project access",
        permissions: {
            manage_team: false,
            manage_roles: false,
            invite_members: false,
            remove_members: false,
            assign_credits: false,
            manage_projects: false,
            view_all_projects: false,
            manage_wallet: false,
        },
    },
};

async function ensureDefaultTeamRole(roleName: string) {
    const normalized = normalizeTeamRoleName(roleName);
    const def = DEFAULT_TEAM_ROLE_DEFINITIONS[normalized];
    if (!def) {
        throw new Error("Invalid team role");
    }

    return prisma.team_roles.upsert({
        where: { name: normalized },
        update: {
            description: def.description,
            permissions: def.permissions,
        },
        create: {
            name: normalized,
            description: def.description,
            permissions: def.permissions,
        },
    });
}

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

    if (!membership || membership.deleted_at) {
        throw new Error("You are not a member of this team");
    }

    return { team, roleName: normalizeTeamRoleName(membership.role.name) };
}

async function assertEmailNotAlreadyPartOfTeam(teamId: string, email: string): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true },
    });

    if (!existingUser) {
        return;
    }

    const team = await prisma.teams.findUnique({
        where: { id: teamId },
        select: { owner_id: true },
    });

    if (!team) {
        throw new Error("Team doesnot exists");
    }

    if (team.owner_id === existingUser.id) {
        throw new Error("User is already a team member");
    }

    const activeMembership = await prisma.team_membership.findFirst({
        where: {
            team_id: teamId,
            user_id: existingUser.id,
            deleted_at: null,
        },
        select: { id: true },
    });

    if (activeMembership) {
        throw new Error("User is already a team member");
    }
}

function resolveInviteRoleName(roleName?: string) {
    const normalized = roleName ? normalizeTeamRoleName(roleName) : null;
    const allowedRoles = ["MEMBER", "PHOTOGRAPHER", "ADMIN"];

    if (!normalized) {
        return "MEMBER";
    }

    if (!allowedRoles.includes(normalized)) {
        throw new Error("Invalid team role for invite");
    }

    return normalized;
}

function canInviteRole(inviterRole: string, requestedRole: string) {
    const normalizedInviterRole = normalizeTeamRoleName(inviterRole);
    const normalizedRequestedRole = normalizeTeamRoleName(requestedRole);

    if (normalizedInviterRole === "TEAM_OWNER" || normalizedInviterRole === "ADMIN") {
        return normalizedRequestedRole !== "TEAM_OWNER";
    }

    if (normalizedInviterRole === "MEMBER") {
        return normalizedRequestedRole === "PHOTOGRAPHER";
    }

    return false;
}

function normalizeAssignableRole(roleName: string) {
    const normalized = normalizeTeamRoleName(roleName);
    const allowedRoles = ["ADMIN", "MEMBER", "PHOTOGRAPHER"];
    if (!allowedRoles.includes(normalized)) {
        throw new Error("Invalid team role assignment");
    }

    return normalized;
}

function canAssignRole(assignerRole: string, requestedRole: string) {
    const normalizedAssignerRole = normalizeTeamRoleName(assignerRole);
    const normalizedRequestedRole = normalizeTeamRoleName(requestedRole);

    if (normalizedAssignerRole === "TEAM_OWNER") {
        return true;
    }

    if (normalizedAssignerRole === "ADMIN") {
        return ["PHOTOGRAPHER", "MEMBER"].includes(normalizedRequestedRole);
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
    // Require at least one active paid subscription to create a team
    // Include the package relation so we can inspect the plan tier (Starter/Pro/Team/etc.)
    const activePurchase = await prisma.user_credit_purchase.findFirst({
        where: { user_id: userId, status: "completed", cancelledAt: null },
        include: { package: true },
        orderBy: { completed_at: "desc" },
    });

    // If no active purchase or the active package is Starter (monthly/annual), disallow team creation
    const packageName = activePurchase?.package?.name || "";
    const normalizedPackage = String(packageName).toLowerCase();
    if (!activePurchase || normalizedPackage.includes("starter")) {
        throw buildTeamPlanRequiredError();
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
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { id: userId } });
    if (!existing || !userId) {
        const err: any = new Error("User doesnot exists, please create a normal account first");
        err.code = "USER_NOT_FOUND";
        throw err;
    }

    const { team: team_exists, roleName: inviterRole } = await getTeamAccess({ teamId, userId });
    await assertEmailNotAlreadyPartOfTeam(team_exists.id, normalizedEmail);
    await assertTeamSeatCapacityForInvite(team_exists.id, normalizedEmail);
    const inviteRoleName = resolveInviteRoleName(roleName);
    if (!canInviteRole(inviterRole, inviteRoleName)) {
        throw new Error("You are not allowed to invite this role");
    }

    const inviteeUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    const defaultRole = await ensureDefaultTeamRole(inviteRoleName);
    if (inviteeUser) {
        const existingMembership = await prisma.team_membership.findFirst({
            where: {
                team_id: team_exists.id,
                user_id: inviteeUser.id,
                deleted_at: null,
            },
        });

        if (existingMembership) {
            throw new Error("User is already a team member");
        }

        // Check if there's a deleted membership record, but DO NOT reactivate it yet
        const deletedMembership = await prisma.team_membership.findFirst({
            where: {
                team_id: team_exists.id,
                user_id: inviteeUser.id,
                deleted_at: { not: null },
            },
        });
        // Do not reactivate membership here; only do so on invite acceptance
    }

    const inviteToken = buildInviteToken({
        email: normalizedEmail,
        invitedBy: userId,
        roleId: defaultRole.id,
    });

    const invite = await prisma.team_invites.upsert({
        where: {
            team_id_email: {
                team_id: team_exists?.id,
                email: normalizedEmail,
            },
        },
        create: {
            email: normalizedEmail,
            team_id: team_exists?.id,
            team_role_id: defaultRole.id,
            role_permissions_snapshot: defaultRole.permissions?.toLocaleString(),
            invited_by_user_id: userId,
            credit_limit: 0,
            token: inviteToken,
            status: invite_status.PENDING,
            expires_at: getInviteExpiry(),
        },
        update: {
            team_role_id: defaultRole.id,
            role_permissions_snapshot: defaultRole.permissions?.toLocaleString(),
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

    // Await sendEmail so serverless environments don't terminate the task
    try {
        await sendEmail({
            from: existing.email,
            senderName: existing.name ?? "Elevated Spaces Team",
            replyTo: existing.email,
            to: normalizedEmail,
            subject: subject ?? `Join ${team_exists.name} - Team Invitation`,
            text: text ?? emailTemplate.text,
            html: emailTemplate.html,
        });

        // Update status to PENDING if email sent successfully
        await prisma.team_invites.update({
            where: { id: invite.id },
            data: { status: invite_status.PENDING },
        });

        console.log(`✅ Invitation email sent to ${normalizedEmail}`);
    } catch (err: any) {
        console.error("❌ Email sending failed:", {
            error: err?.message ?? String(err),
            email: normalizedEmail,
            inviteId: invite.id,
        });

        // Mark as failed in database
        await prisma.team_invites.update({
            where: { id: invite.id },
            data: { status: invite_status.FAILED },
        }).catch(console.error);
    }

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

    await assertTeamSeatCapacityForAcceptance(invite.team_id);

    const inviteEmail = payload.email.trim().toLowerCase();
    let user = await prisma.user.findUnique({ where: { email: inviteEmail } });

    await assertEmailNotAlreadyPartOfTeam(invite.team_id, inviteEmail);

    const defaultRole = await prisma.roles.upsert({
        where: { name: "USER" },
        update: {},
        create: {
            name: "USER",
            description: "Default role for all users",
        },
    });

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

    }

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
            deleted_at: null, // Ensure any previously deleted membership is reactivated
            joined_at: new Date(), // Reset joined_at to current time for reactivated members
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

    await enforceTeamSeatCapacityForExistingMembers(invite.team_id);

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
                deleted_at: null,
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

        // Soft delete - set deleted_at instead of hard delete
        const removedMembership = await prisma.team_membership.updateMany({
            where: {
                team_id,
                user_id: userId,
                deleted_at: null,
            },
            data: {
                deleted_at: new Date(),
            }
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
            deleted_at: null,
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

    // Soft delete - set deleted_at instead of hard delete
    const removedMembership = await prisma.team_membership.updateMany({
        where: {
            team_id,
            user_id: invite.accepted_by_user_id,
            deleted_at: null,
        },
        data: {
            deleted_at: new Date(),
        }
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
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { id: userId } });
    if (!existing || !userId) {
        const err: any = new Error("User doesnot exists, please create a normal account first");
        err.code = "USER_NOT_FOUND";
        throw err;
    }

    const { team: team_exists, roleName: inviterRole } = await getTeamAccess({ teamId, userId });
    await assertEmailNotAlreadyPartOfTeam(team_exists.id, normalizedEmail);
    await assertTeamSeatCapacityForInvite(team_exists.id, normalizedEmail);
    const inviteRoleName = resolveInviteRoleName(roleName);
    if (!canInviteRole(inviterRole, inviteRoleName)) {
        throw new Error("You are not allowed to invite this role");
    }

    const defaultRole = await ensureDefaultTeamRole(inviteRoleName);

    const inviteeUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (inviteeUser) {
        const existingMembership = await prisma.team_membership.findFirst({
            where: {
                team_id: team_exists.id,
                user_id: inviteeUser.id,
                deleted_at: null,
            },
        });

        if (existingMembership) {
            throw new Error("User is already a team member");
        }

        // Check if there's a deleted membership record, but DO NOT reactivate it yet
        const deletedMembership = await prisma.team_membership.findFirst({
            where: {
                team_id: team_exists.id,
                user_id: inviteeUser.id,
                deleted_at: { not: null },
            },
        });
        // Do not reactivate membership here; only do so on invite acceptance
    }

    const inviteToken = buildInviteToken({
        email: normalizedEmail,
        invitedBy: userId,
        roleId: defaultRole.id,
    });

    const invite = await prisma.team_invites.upsert({
        where: {
            team_id_email: {
                team_id: team_exists?.id,
                email: normalizedEmail,
            },
        },
        create: {
            email: normalizedEmail,
            team_id: team_exists?.id,
            team_role_id: defaultRole.id,
            role_permissions_snapshot: defaultRole.permissions?.toLocaleString(),
            invited_by_user_id: userId,
            credit_limit: 0,
            token: inviteToken,
            status: invite_status.PENDING,
            expires_at: getInviteExpiry(),
        },
        update: {
            team_role_id: defaultRole.id,
            role_permissions_snapshot: defaultRole.permissions?.toLocaleString(),
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
                to: normalizedEmail,
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
                email: normalizedEmail,
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

export async function cancelInvitationService({ inviteId, userId }: { inviteId: string, userId: string }) {
    if (!inviteId || !userId) {
        throw new Error("Invite ID and User ID are required");
    }

    const invite = await prisma.team_invites.findUnique({ where: { id: inviteId } });
    if (!invite) {
        throw new Error("Invitation not found");
    }

    // Only allow cancel if status is PENDING
    if (invite.status !== invite_status.PENDING) {
        throw new Error("Only pending invitations can be cancelled");
    }

    // Only owner/admin can cancel
    const team = await prisma.teams.findUnique({ where: { id: invite.team_id } });
    if (!team) {
        throw new Error("Team not found");
    }

    // Check if user is team owner
    const isTeamOwner = team.owner_id === userId;

    // Or check if user is admin
    const membership = await prisma.team_membership.findFirst({
        where: {
            team_id: invite.team_id,
            user_id: userId,
            deleted_at: null,
        },
        include: { role: true }
    });

    const isTeamAdmin = normalizeTeamRoleName(membership?.role?.name || "") === "ADMIN";

    if (!isTeamOwner && !isTeamAdmin) {
        throw new Error("Only team owner or admin can cancel invitations");
    }

    await prisma.team_invites.update({
        where: { id: inviteId },
        data: { status: invite_status.FAILED, expires_at: new Date() },
    });

    return { success: true, message: "Invitation cancelled" };
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

export async function leaveTeamService({ teamId, userId }: { teamId: string, userId: string }) {
    if (!teamId || !userId) {
        throw new Error("Team ID and User ID are required");
    }

    const team = await prisma.teams.findUnique({ where: { id: teamId } });
    if (!team) {
        throw new Error("Team does not exist");
    }

    if (team.owner_id === userId) {
        throw new Error("Team owner cannot leave the team. Please transfer ownership or delete the team.");
    }

    const userMembership = await prisma.team_membership.findUnique({
        where: { team_id_user_id: { team_id: teamId, user_id: userId } },
        include: { user: true }
    });

    if (!userMembership || userMembership.deleted_at) {
        throw new Error("You are not a member of this team");
    }

    // Check available credits
    const availableCredits = Math.max(
        Number(userMembership.allocated) - Number(userMembership.used),
        0
    );

    // If user has credits, return them without leaving
    if (availableCredits > 0) {
        return {
            success: true,
            requiresCreditsTransfer: true,
            availableCredits,
            message: "Please transfer your credits before leaving the team",
            teamId,
            userId,
        };
    }

    // Soft delete the membership
    await prisma.team_membership.update({
        where: { id: userMembership.id },
        data: { deleted_at: new Date() },
    });

    console.log("TEAM_MEMBER_LEFT", {
        action: "SELF_LEAVE",
        team_id: teamId,
        user_id: userId,
        timestamp: new Date().toISOString(),
    });

    return {
        success: true,
        requiresCreditsTransfer: false,
        message: "You have left the team",
    };
}

export async function transferCreditsBeforeLeavingService({
    teamId,
    userId,
    transferToUserId,
    credits,
}: {
    teamId: string;
    userId: string;
    transferToUserId?: string;
    credits: number;
}) {
    if (!teamId || !userId || credits <= 0) {
        throw new Error("Team ID, User ID, and credits amount are required");
    }

    const team = await prisma.teams.findUnique({ where: { id: teamId } });
    if (!team) {
        throw new Error("Team does not exist");
    }

    const userMembership = await prisma.team_membership.findUnique({
        where: { team_id_user_id: { team_id: teamId, user_id: userId } },
    });

    if (!userMembership || userMembership.deleted_at) {
        throw new Error("You are not a member of this team");
    }

    const availableCredits = Math.max(
        Number(userMembership.allocated) - Number(userMembership.used),
        0
    );

    if (credits > availableCredits) {
        throw new Error(`Cannot transfer more credits than available (${availableCredits})`);
    }

    // Transfer to team wallet
    if (!transferToUserId) {
        await prisma.teams.update({
            where: { id: teamId },
            data: {
                wallet: { increment: credits },
            }
        });

        // Reduce user's allocated credits
        await prisma.team_membership.update({
            where: { id: userMembership.id },
            data: {
                allocated: { decrement: credits },
            }
        });

        return {
            success: true,
            message: `${credits} credits transferred to team wallet`,
        };
    }

    // Transfer to another team member
    const targetMembership = await prisma.team_membership.findUnique({
        where: { team_id_user_id: { team_id: teamId, user_id: transferToUserId } },
    });

    if (!targetMembership || targetMembership.deleted_at) {
        throw new Error("Target member not found or is inactive");
    }

    // Transfer credits
    await prisma.team_membership.update({
        where: { id: userMembership.id },
        data: {
            allocated: { decrement: credits },
        }
    });

    await prisma.team_membership.update({
        where: { id: targetMembership.id },
        data: {
            allocated: { increment: credits },
        }
    });

    console.log("CREDITS_TRANSFERRED_BEFORE_LEAVE", {
        from_user_id: userId,
        to_user_id: transferToUserId,
        team_id: teamId,
        credits,
        timestamp: new Date().toISOString(),
    });

    return {
        success: true,
        message: `${credits} credits transferred to team member`,
    };
}

export async function completeLeaveTeamService({ teamId, userId }: { teamId: string, userId: string }) {
    if (!teamId || !userId) {
        throw new Error("Team ID and User ID are required");
    }

    const userMembership = await prisma.team_membership.findUnique({
        where: { team_id_user_id: { team_id: teamId, user_id: userId } },
    });

    if (!userMembership || userMembership.deleted_at) {
        throw new Error("You are not a member of this team");
    }

    // Soft delete the membership
    await prisma.team_membership.update({
        where: { id: userMembership.id },
        data: { deleted_at: new Date() },
    });

    console.log("TEAM_MEMBER_LEFT", {
        action: "SELF_LEAVE_AFTER_CREDIT_TRANSFER",
        team_id: teamId,
        user_id: userId,
        timestamp: new Date().toISOString(),
    });

    return {
        success: true,
        message: "You have successfully left the team",
    };
}

export async function deleteTeamService({ teamId, userId }: { teamId: string, userId: string }) {
    if (!teamId || !userId) {
        throw new Error("Team ID and User ID are required");
    }

    const team = await prisma.teams.findUnique({ where: { id: teamId } });
    if (!team) {
        throw new Error("Team does not exist");
    }

    if (team.owner_id !== userId) {
        throw new Error("Only the team owner can delete the team");
    }

    if (team.deleted_at) {
        throw new Error("Team is already deleted");
    }

    // Soft delete the team
    await prisma.teams.update({
        where: { id: teamId },
        data: { deleted_at: new Date() },
    });

    console.log("TEAM_DELETED", {
        team_id: teamId,
        deleted_by_user_id: userId,
        timestamp: new Date().toISOString(),
    });

    return {
        success: true,
        message: "Team has been deleted successfully",
    };
}

export async function processTeamPaidExtraSeatsDaily() {
    const teams = await prisma.team_membership.findMany({
        where: {
            deleted_at: null,
            is_paid_extra_seat: true,
        },
        distinct: ["team_id"],
        select: {
            team_id: true,
        },
    });

    let processed = 0;
    let failed = 0;

    for (const team of teams) {
        try {
            await enforceTeamSeatCapacityForExistingMembers(team.team_id);
            processed += 1;
        } catch (error) {
            failed += 1;
            console.error("[TEAM_SEATS] Failed daily processing for team", {
                teamId: team.team_id,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    return {
        processed,
        failed,
    };
}