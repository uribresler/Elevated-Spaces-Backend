// Transfer credits from personal wallet to team wallet (owner only)
export async function transferPersonalCreditsToTeam(req: Request, res: Response) {
    try {
        const { team_id, credits } = req.body;
        const userId = req.user?.id;

        if (!userId) {
            throw new Error("User not authenticated");
        }
        if (!team_id) {
            throw new Error("Team ID is required");
        }
        if (!Number.isFinite(credits) || credits <= 0) {
            throw new Error("Credits must be a positive number");
        }

        // Check team ownership
        const team = await prisma.teams.findFirst({ where: { id: team_id, deleted_at: null } });
        if (!team) {
            throw new Error("Team not found");
        }
        if (team.owner_id !== userId) {
            throw new Error("Only the team owner can transfer credits to the team wallet");
        }

        // Check user personal wallet
        const userWallet = await prisma.user_credit_balance.findUnique({ where: { user_id: userId } });
        if (!userWallet || Number(userWallet.balance) < credits) {
            throw new Error("Insufficient personal credits");
        }

        // Perform transfer in transaction
        await prisma.$transaction([
            prisma.user_credit_balance.update({
                where: { user_id: userId },
                data: { balance: { decrement: credits } },
            }),
            prisma.teams.update({
                where: { id: team_id },
                data: { wallet: { increment: credits } },
            }),
        ]);

        return res.status(200).json({
            success: true,
            message: `Transferred ${credits} credits to team wallet`,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to transfer credits";
        console.error("TRANSFER_CREDITS_TO_TEAM_ERROR", error);
        return res.status(400).json({
            success: false,
            message,
        });
    }
}
import { Request, Response } from "express";
import prisma from "../dbConnection";
import { allocateCreditsToUsers } from "../services/teams.credits.service";

export async function allocateCreditToMember(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const { credits, team_id } = req.body;
        const userId = req.user?.id;

        if (!userId) {
            throw new Error("Owner ID missing");
        }
        const result = await allocateCreditsToUsers({ id, credits, team_id, userId })

        return res.status(201).json({
            success: true,
            message: "Credits allocated to the selected member",
            data: result,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to allocate credits";
        console.error("ALLOCATE_CREDITS_ERROR", error);
        return res.status(400).json({
            success: false,
            message,
        });
    }
}