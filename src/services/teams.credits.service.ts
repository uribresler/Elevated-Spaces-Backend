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

        const team = await prisma.teams.findFirst({
            where: { id: team_id }
        });
        if (!team) {
            throw new Error("The team doesnot exists");
        }

        const allocatorRole = team.owner_id === userId
            ? "TEAM_OWNER"
            : await prisma.team_membership.findUnique({
                where: { team_id_user_id: { team_id, user_id: userId } },
                include: { role: true },
            });

        if (!allocatorRole || (allocatorRole !== "TEAM_OWNER" && allocatorRole.deleted_at)) {
            throw new Error("You are not allowed to allocate credits");
        }

        const allocatorRoleName =
            allocatorRole === "TEAM_OWNER" ? "TEAM_OWNER" : allocatorRole.role.name;

        const targetMembership = await prisma.team_membership.findUnique({
            where: { team_id_user_id: { team_id, user_id: id } },
            include: { role: true },
        });

        if (!targetMembership) {
            throw new Error(`Member ${id} not found in team ${team_id}`);
        }

        // If the membership is soft-deleted, reactivate it automatically
        // This handles cases where a member was removed/left and is being re-added
        let activeMembership = targetMembership;
        if (targetMembership.deleted_at) {
            activeMembership = await prisma.team_membership.update({
                where: { id: targetMembership.id },
                data: {
                    deleted_at: null,
                    joined_at: new Date(),
                    // Reset allocated but keep used history
                    allocated: 0,
                },
                include: { role: true },
            });

            console.log("AUTO_REACTIVATED_MEMBER_FOR_CREDIT_ALLOCATION", {
                team_id,
                user_id: id,
                timestamp: new Date().toISOString(),
            });
        }

        if (allocatorRoleName === "TEAM_AGENT" && activeMembership.role.name !== "TEAM_PHOTOGRAPHER") {
            throw new Error("Agents can only allocate credits to photographers");
        }

        if (allocatorRoleName === "TEAM_OWNER" || allocatorRoleName === "TEAM_ADMIN") {
            if (Number(team.wallet) - Number(credits) < 0) {
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
        }

        if (allocatorRoleName === "TEAM_AGENT") {
            const allocatorMembership = await prisma.team_membership.findUnique({
                where: { team_id_user_id: { team_id, user_id: userId } },
            });
            if (!allocatorMembership || allocatorMembership.deleted_at) {
                throw new Error("Agent membership not found");
            }

            const availableCredits = Math.max(
                Number(allocatorMembership.allocated) - Number(allocatorMembership.used),
                0
            );

            if (availableCredits - Number(credits) < 0) {
                throw new Error("Insufficient allocated credits to assign");
            }

            const [member] = await prisma.$transaction([
                prisma.team_membership.update({
                    where: { team_id_user_id: { team_id, user_id: id } },
                    data: {
                        allocated: { increment: credits },
                    }
                }),
                prisma.team_membership.update({
                    where: { team_id_user_id: { team_id, user_id: userId } },
                    data: {
                        allocated: { decrement: credits },
                    }
                }),
            ]);

            return {
                success: true,
                message: "Credits allocated to the selected member",
                member
            }
        }

        throw new Error("You are not allowed to allocate credits");

    } catch (error) {
        console.error("ALLOCATE_CREDITS_ERROR", error);
        throw error;
    }
}