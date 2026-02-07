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