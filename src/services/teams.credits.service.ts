import prisma from "../dbConnection";

export async function allocateCreditsToUsers({
    team_id,
    userId,
    credits,
    id,
}: { id: string, team_id: string, userId: string, credits: number }) {
    try {
        if (!team_id) {
            throw new Error("Team ID is required");
        }
        if (!id) {
            throw new Error("Member ID is required");
        }
        if (!Number.isFinite(credits) || credits <= 0) {
            throw new Error("Credits must be a positive number");
        }

        const teams = await prisma.teams.findFirst({
            where: { id: team_id, owner_id: userId }
        });
        if (!teams) {
            throw new Error("The team or owner are not co-related");
        }

        if (Number(teams.wallet) - Number(credits) < 0) {
            throw new Error("Low credits, please buy more credits");
        }

        const [member] = await prisma.$transaction([
            prisma.team_membership.update({
                where: { team_id_user_id: { team_id, user_id: id } },
                data: {
                    allocated: { increment: credits },
                }
            }),
            prisma.teams.update({
                where: { id: team_id },
                data: {
                    wallet: { decrement: credits },
                }
            }),
        ]);

        return {
            success: true,
            message: "Credits allocated to the selected member",
            member
        }
    } catch (error) {
        console.error("ALLOCATE_CREDITS_ERROR", error);
        throw error;
    }
}