import { Request, Response } from "express";
import { createTeamSchema } from "../utils/teamSchema";
import { acceptInvitationService, createTeamService, invitationService, reinviteService, removeTeamMemberService, updateTeamMemberRoleService, leaveTeamService, transferCreditsBeforeLeavingService, completeLeaveTeamService, deleteTeamService, cancelInvitationService, enforceTeamSeatCapacityForExistingMembers, getTeamEligibilityService } from "../services/teams.service";
import prisma from "../dbConnection";

export async function createTeam(req: Request, res: Response) {
    try {
        const data = createTeamSchema.parse(req.body);

        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const result = await createTeamService({
            ...data,
            userId,
            description: data.description || "",
        });

        return res.status(201).json({
            message: "Team created successfully",
            data: result,
        });

    } catch (error: any) {
        if (error.name === "ZodError") {
            return res.status(400).json({ errors: error.errors });
        }

        if (error.code === "USER_NOT_FOUND") {
            return res.status(404).json({ message: error.message });
        }

        // Surface plan/seat related errors to frontend with suitable status codes
        const isPlanRequired = error.code === "TEAM_PLAN_REQUIRED";
        const isSeatLimit = error.code === "TEAM_SEAT_LIMIT_REACHED";
        if (isPlanRequired || isSeatLimit) {
            console.warn("Team create blocked:", { code: error.code, message: error.message });
            return res.status(409).json({
                message: error.message || "Team creation not allowed",
                ...(error.code ? { code: error.code } : {}),
                ...(error.details ? { details: error.details } : {}),
            });
        }

        console.error(error);
        return res.status(500).json({ message: error.message || "Something went wrong" });
    }
}

// Update team name endpoint
export async function updateTeamName(req: Request, res: Response) {
    try {
        const { teamId, name } = req.body;
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }
        // Fetch membership to check role
        const membership = await prisma.team_membership.findFirst({
            where: {
                team_id: teamId,
                user_id: userId,
                deleted_at: null,
            },
            include: { role: true }
        });
        const team = await prisma.teams.findUnique({ where: { id: teamId } });
        if (!team) {
            return res.status(404).json({ message: "Team not found" });
        }
        const isOwner = team.owner_id === userId;
        const isAdmin = membership?.role?.name === "TEAM_ADMIN";
        if (!isOwner && !isAdmin) {
            return res.status(403).json({ message: "Only owner or admin can update team name" });
        }
        await prisma.teams.update({
            where: { id: teamId },
            data: { name },
        });
        return res.status(200).json({ message: "Team name updated successfully" });
    } catch (error: any) {
        console.error(error);
        return res.status(500).json({ message: error.message || "Failed to update team name" });
    }
}

export async function sendInvitation(req: Request, res: Response) {
    try {
        const { email, subject, text, teamId, roleName } = req.body;
        const userId = req.user?.id

        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }
        const result = await invitationService({ email, userId, subject, text, teamId, roleName })

        return res.status(201).json({
            message: "Invitation sent successfully",
            data: result,
        });

    } catch (error: any) {
        if (error.name === "ZodError") {
            return res.status(400).json({ errors: error.errors });
        }

        if (error.code === "USER_NOT_FOUND") {
            return res.status(404).json({ message: error.message });
        }

        // Log detailed error for debugging
        console.error("Invitation error:", {
            message: error.message,
            code: error.code,
            stack: error.stack,
            timestamp: new Date().toISOString(),
        });

        // Return actual error message to frontend
        const isSeatLimit = error.code === "TEAM_SEAT_LIMIT_REACHED";
        const isPlanRequired = error.code === "TEAM_PLAN_REQUIRED";
        return res.status(isSeatLimit || isPlanRequired ? 409 : 500).json({
            message: error.message || "Failed to send invitation",
            ...(error.code ? { code: error.code } : {}),
            ...(error.details ? { details: error.details } : {}),
        });
    }
}

export async function acceptInvitation(req: Request, res: Response) {
    try {
        const { token, name, password } = req.body;

        const result = await acceptInvitationService({ token, name, password });

        return res.status(200).json(result);
    } catch (error: any) {
        console.error(error);
        return res.status(400).json({ message: error.message || "Invalid invitation" });
    }
}

export async function cancelInvitation(req: Request, res: Response) {
    try {
        const inviteId = req.params.id;
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }
        const result = await cancelInvitationService({ inviteId, userId });
        return res.status(200).json({ message: result.message });
    } catch (error: any) {
        return res.status(400).json({ message: error.message });
    }
}

export async function getMyTeams(req: Request, res: Response) {
    try {
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized",
            });
        }

        const teams = await prisma.teams.findMany({
            where: {
                owner_id: userId,
                deleted_at: null,
            },
            include: {
                owner: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        avatar_url: true,
                        created_at: true,
                    },
                },
            },
        });

        if (!teams.length) {
            return res.status(200).json({
                success: true,
                message: "Teams fetched successfully",
                teams: [],
            });
        }

        const teamIds = teams.map((t) => t.id);

        const inviteSelect = {
            id: true,
            email: true,
            team_id: true,
            team_role_id: true,
            status: true,
            invited_by_user_id: true,
            credit_limit: true,
            token: true,
            invited_at: true,
            expires_at: true,
            accepted_at: true,
            accepted_by_user_id: true,
            created_at: true,
            updated_at: true,
            role: { select: { id: true, name: true, description: true } },
        } as const;

        const [members, purchases, openInvites] = await Promise.all([
            prisma.team_membership.findMany({
                where: { team_id: { in: teamIds }, deleted_at: null },
                include: {
                    role: { select: { id: true, name: true, description: true } },
                    user: { select: { id: true, name: true, email: true, avatar_url: true, created_at: true } },
                },
            }),
            prisma.team_purchase.findMany({
                where: { team_id: { in: teamIds }, status: "completed" },
                select: {
                    id: true,
                    team_id: true,
                    amount: true,
                    price_usd: true,
                    status: true,
                    completed_at: true,
                },
            }),
            prisma.team_invites.findMany({
                where: { team_id: { in: teamIds }, status: { in: ["PENDING", "FAILED"] } },
                select: inviteSelect,
            }),
        ]);

        // Only fetch ACCEPTED invites for users that are still active members —
        // historical accepted invites for removed users are dropped at the SQL layer.
        const memberUserIds = Array.from(new Set(members.map((m) => m.user_id)));
        const acceptedInvites = memberUserIds.length
            ? await prisma.team_invites.findMany({
                  where: {
                      team_id: { in: teamIds },
                      status: "ACCEPTED",
                      accepted_by_user_id: { in: memberUserIds },
                  },
                  select: inviteSelect,
              })
            : [];

        const membersByTeam = new Map<string, typeof members>();
        for (const m of members) {
            const list = membersByTeam.get(m.team_id) ?? [];
            list.push(m);
            membersByTeam.set(m.team_id, list);
        }

        const purchasesByTeam = new Map<string, typeof purchases>();
        for (const p of purchases) {
            const list = purchasesByTeam.get(p.team_id) ?? [];
            list.push(p);
            purchasesByTeam.set(p.team_id, list);
        }

        const invitesByTeam = new Map<string, typeof openInvites>();
        for (const inv of [...openInvites, ...acceptedInvites]) {
            const list = invitesByTeam.get(inv.team_id) ?? [];
            list.push(inv);
            invitesByTeam.set(inv.team_id, list);
        }

        const filteredTeams = teams.map((team) => {
            const teamMembers = membersByTeam.get(team.id) ?? [];
            return {
                ...team,
                teamInvites: invitesByTeam.get(team.id) ?? [],
                purchases: purchasesByTeam.get(team.id) ?? [],
                members: teamMembers.map((member) => ({
                    ...member,
                    is_paid_extra_seat: Boolean((member as any).is_paid_extra_seat),
                    seat_auto_renew: Boolean((member as any).seat_auto_renew),
                    seat_last_paid_at: (member as any).seat_last_paid_at || null,
                    seat_expires_at: (member as any).seat_expires_at || null,
                    seat_payment_product_key: (member as any).seat_payment_product_key || null,
                })),
            };
        });

        res.status(200).json({
            success: true,
            message: "Teams fetched successfully",
            teams: filteredTeams
        })
    } catch (error) {

    }
}

export async function getMyTeamsWithCredits(req: Request, res: Response) {
    try {
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "User not authenticated"
            });
        }

        const ownedTeams = await prisma.teams.findMany({
            where: {
                owner_id: userId,
                deleted_at: null
            },
            select: {
                id: true,
                name: true,
                wallet: true,
            }
        });

        // Get teams where user is a member
        const memberTeams = await prisma.team_membership.findMany({
            where: {
                user_id: userId,
                deleted_at: null,
            },
            include: {
                team: {
                    select: {
                        id: true,
                        name: true,
                        wallet: true,
                        deleted_at: true,
                    }
                },
                role: {
                    select: {
                        name: true,
                    }
                }
            }
        });

        // Format owned teams
        const ownedTeamsFormatted = ownedTeams.map(team => ({
            id: team.id,
            name: team.name,
            role: 'TEAM_OWNER',
            allocated: team.wallet, // Owner has access to full wallet
            used: 0, // Owners don't track "used" separately
            remaining: team.wallet,
        }));

        // Format member teams (exclude deleted teams)
        const memberTeamsFormatted = memberTeams
            .filter(membership => !membership.team.deleted_at)
            .map(membership => {
                const roleName = String(membership.role?.name || "").toUpperCase();
                const canUseTeamWallet = ["TEAM_OWNER", "TEAM_ADMIN", "ADMIN"].includes(roleName);
                const walletBalance = Number(membership.team?.wallet || 0);
                const allocatedBalance = canUseTeamWallet ? walletBalance : Number(membership.allocated || 0);
                const usedBalance = canUseTeamWallet ? 0 : Number(membership.used || 0);

                return {
                    id: membership.team.id,
                    name: membership.team.name,
                    role: membership.role.name,
                    allocated: allocatedBalance,
                    used: usedBalance,
                    remaining: Math.max(allocatedBalance - usedBalance, 0),
                };
            });

        // Combine and remove duplicates (user can't be both owner and member of same team)
        const allTeams = [...ownedTeamsFormatted, ...memberTeamsFormatted];

        res.status(200).json({
            success: true,
            message: "Teams with credits fetched successfully",
            data: {
                teams: allTeams,
                total: allTeams.length,
            }
        });
    } catch (error) {
        console.error("GET_TEAMS_WITH_CREDITS_ERROR:", error);
        return res.status(500).json({
            success: false,
            message: error instanceof Error ? error.message : "Failed to fetch teams with credits"
        });
    }
}

export async function removeMemberById(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const userId = req.user?.id
        const { owner_id, team_id } = req.body;

        if (!userId) {
            throw new Error("No logged-in user id found");
        }

        const result = await removeTeamMemberService({ owner_id, team_id, id, userId });

        return res.status(200).json(result);
    } catch (error: any) {
        console.error(error);
        return res.status(400).json({ message: error.message || "Failed to remove member from the team" });
    }
}

export async function reinviteInvitation(req: Request, res: Response) {
    try {
        const { email, subject, text, teamId, roleName } = req.body;
        const userId = req.user?.id

        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }
        const result = await reinviteService({ email, userId, subject, text, teamId, roleName })

        return res.status(201).json({
            message: "Invitation re-sent successfully",
            data: result,
        });

    } catch (error: any) {
        if (error.name === "ZodError") {
            return res.status(400).json({ errors: error.errors });
        }

        if (error.code === "USER_NOT_FOUND") {
            return res.status(404).json({ message: error.message });
        }

        // Log detailed error for debugging
        console.error("Reinvite error:", {
            message: error.message,
            code: error.code,
            stack: error.stack,
            timestamp: new Date().toISOString(),
        });

        // Return actual error message to frontend
        const isSeatLimit = error.code === "TEAM_SEAT_LIMIT_REACHED";
        const isPlanRequired = error.code === "TEAM_PLAN_REQUIRED";
        return res.status(isSeatLimit || isPlanRequired ? 409 : 500).json({
            message: error.message || "Failed to re-send invitation",
            ...(error.code ? { code: error.code } : {}),
            ...(error.details ? { details: error.details } : {}),
        });
    }
}

export async function getTeamsByUserId(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const userId = req.user?.id

        if (!userId || id !== userId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized",
            })
        }

        const memberships = await prisma.team_membership.findMany({
            where: {
                user_id: userId,
                deleted_at: null,
            },
            include: {
                team: {
                    include: {
                        teamInvites: {
                            select: {
                                id: true,
                                email: true,
                                team_id: true,
                                team_role_id: true,
                                status: true,
                                invited_by_user_id: true,
                                credit_limit: true,
                                token: true,
                                invited_at: true,
                                expires_at: true,
                                accepted_at: true,
                                accepted_by_user_id: true,
                                created_at: true,
                                updated_at: true,
                                role: {
                                    select: {
                                        id: true,
                                        name: true,
                                        description: true,
                                    },
                                },
                            },
                        },
                        owner: {
                            select: {
                                id: true,
                                name: true,
                                email: true,
                                avatar_url: true,
                                created_at: true,
                            },
                        },
                        members: {
                            where: { deleted_at: null },
                            include: {
                                role: { select: { id: true, name: true, description: true } },
                                user: { select: { id: true, name: true, email: true, avatar_url: true, created_at: true } },
                            }
                        },
                    }
                }
            }
        })

        const teams = memberships
            .map((membership) => membership.team)
            .filter((team) => team.owner_id !== userId && !team.deleted_at);

        const filteredTeams = teams.map((team) => {
            const activeMemberIds = new Set(team.members
                .filter((m) => !m.deleted_at)
                .map((m) => m.user_id));
            const filteredInvites = team.teamInvites.filter((invite) => {
                if (invite.status !== "ACCEPTED") {
                    return true;
                }
                return invite.accepted_by_user_id
                    ? activeMemberIds.has(invite.accepted_by_user_id)
                    : false;
            });

            return {
                ...team,
                teamInvites: filteredInvites,
                members: team.members.map((member) => ({
                    ...member,
                    is_paid_extra_seat: Boolean((member as any).is_paid_extra_seat),
                    seat_auto_renew: Boolean((member as any).seat_auto_renew),
                    seat_last_paid_at: (member as any).seat_last_paid_at || null,
                    seat_expires_at: (member as any).seat_expires_at || null,
                    seat_payment_product_key: (member as any).seat_payment_product_key || null,
                })),
            };
        });

        return res.status(200).json({
            success: true,
            message: "Teams fetched successfully",
            teams: filteredTeams,
        })
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Something went wrong" });
    }
}

export async function updateTeamMemberRole(req: Request, res: Response) {
    try {
        const { teamId, memberId, roleName } = req.body;
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const result = await updateTeamMemberRoleService({
            teamId,
            memberId,
            roleName,
            userId,
        });

        return res.status(200).json(result);
    } catch (error: any) {
        console.error(error);
        return res.status(400).json({ message: error.message || "Failed to update member role" });
    }
}

export async function leaveTeam(req: Request, res: Response) {
    try {
        const { teamId } = req.body;
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        if (!teamId) {
            return res.status(400).json({ message: "Team ID is required" });
        }

        const result = await leaveTeamService({ teamId, userId });

        return res.status(200).json(result);
    } catch (error: any) {
        console.error(error);
        return res.status(400).json({ message: error.message || "Failed to leave the team" });
    }
}

export async function transferCreditsBeforeLeaving(req: Request, res: Response) {
    try {
        const { teamId, transferToUserId, credits } = req.body;
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        if (!teamId || !credits || credits <= 0) {
            return res.status(400).json({ message: "Team ID and credits amount are required" });
        }

        const result = await transferCreditsBeforeLeavingService({
            teamId,
            userId,
            transferToUserId,
            credits,
        });

        return res.status(200).json(result);
    } catch (error: any) {
        console.error(error);
        return res.status(400).json({ message: error.message || "Failed to transfer credits" });
    }
}

export async function completeLeaveTeam(req: Request, res: Response) {
    try {
        const { teamId } = req.body;
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        if (!teamId) {
            return res.status(400).json({ message: "Team ID is required" });
        }

        const result = await completeLeaveTeamService({ teamId, userId });

        return res.status(200).json(result);
    } catch (error: any) {
        console.error(error);
        return res.status(400).json({ message: error.message || "Failed to complete leave" });
    }
}

export async function deleteTeam(req: Request, res: Response) {
    try {
        const { teamId } = req.body;
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        if (!teamId) {
            return res.status(400).json({ message: "Team ID is required" });
        }

        const result = await deleteTeamService({ teamId, userId });

        return res.status(200).json(result);
    } catch (error: any) {
        console.error(error);
        return res.status(400).json({ message: error.message || "Failed to delete team" });
    }
}

export async function getTeamEligibility(req: Request, res: Response) {
    try {
        const teamId = req.params.teamId;
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
        if (!teamId) return res.status(400).json({ success: false, message: 'teamId is required' });

        const result = await getTeamEligibilityService({ teamId, userId });
        return res.status(200).json(result);
    } catch (error: any) {
        console.error('GET_TEAM_ELIGIBILITY_ERROR:', error);
        if (error?.code === 'TEAM_NOT_FOUND') {
            return res.status(404).json({ success: false, code: error.code, message: error?.message || 'Team not found' });
        }
        return res.status(500).json({ success: false, message: error?.message || 'Failed to get eligibility' });
    }
}