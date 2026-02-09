import { Request, Response } from "express";
import { createTeamSchema } from "../utils/teamSchema";
import { acceptInvitationService, createTeamService, invitationService, reinviteService, removeTeamMemberService } from "../services/teams.service";
import prisma from "../dbConnection";
import { success } from "zod";

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

        console.error(error);
        return res.status(500).json({ message: "Something went wrong" });
    }
}

export async function sendInvitation(req: Request, res: Response) {
    try {
        const { email, subject, text, teamId } = req.body;
        const userId = req.user?.id

        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }
        const result = await invitationService({ email, userId, subject, text, teamId })

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
        return res.status(500).json({
            message: error.message || "Failed to send invitation"
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

export async function getMyTeams(req: Request, res: Response) {
    try {
        const userId = req.user?.id;

        const teams = await prisma.teams.findMany({
            where: { owner_id: userId },
            include: {
                teamInvites: true, owner: true, members: true, purchases: true, usage_log: true
            }
        })
        if (!teams) {
            return res.status(301).json({
                message: "No teams created yet!"
            })
        }
        const filteredTeams = teams.map((team) => {
            const activeMemberIds = new Set(team.members.map((m) => m.user_id));
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
        const { email, subject, text, teamId } = req.body;
        const userId = req.user?.id

        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }
        const result = await reinviteService({ email, userId, subject, text, teamId })

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
        return res.status(500).json({
            message: error.message || "Failed to re-send invitation"
        });
    }
}