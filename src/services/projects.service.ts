import prisma from "../dbConnection";

async function getTeamRole({ teamId, userId }: { teamId: string; userId: string }) {
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

    return { team, roleName: membership.role.name };
}

export async function createProjectService({
    teamId,
    name,
    address,
    description,
    userId,
    photographerEmail,
}: {
    teamId: string;
    name: string;
    address?: string;
    description?: string;
    userId: string;
    photographerEmail?: string;
}) {
    if (!name.trim()) {
        throw new Error("Project name is required");
    }

    const { team, roleName } = await getTeamRole({ teamId, userId });
    if (!["TEAM_OWNER", "TEAM_ADMIN", "TEAM_AGENT"].includes(roleName)) {
        throw new Error("You are not allowed to create projects");
    }

    const project = await prisma.team_project.create({
        data: {
            team_id: team.id,
            name: name.trim(),
            address: address?.trim() || null,
            description: description?.trim() || null,
            created_by_user_id: userId,
        },
    });

    if (photographerEmail) {
        const photographer = await prisma.user.findUnique({ where: { email: photographerEmail } });
        if (!photographer) {
            throw new Error("Photographer not found. Invite them to the team first.");
        }

        const photographerMembership = await prisma.team_membership.findUnique({
            where: { team_id_user_id: { team_id: team.id, user_id: photographer.id } },
            include: { role: true },
        });

        if (!photographerMembership || photographerMembership.role.name !== "TEAM_PHOTOGRAPHER") {
            throw new Error("Photographer must be a team member with photographer role");
        }

        await prisma.team_project_member.upsert({
            where: { project_id_user_id: { project_id: project.id, user_id: photographer.id } },
            create: {
                project_id: project.id,
                user_id: photographer.id,
                role: "PHOTOGRAPHER",
            },
            update: {},
        });
    }

    return {
        success: true,
        message: "Project created successfully",
        project,
    };
}

export async function getMyProjectsService({ userId }: { userId: string }) {
    const memberships = await prisma.team_membership.findMany({
        where: { user_id: userId },
        include: { role: true },
    });

    const ownedTeams = await prisma.teams.findMany({
        where: { owner_id: userId },
        select: { id: true },
    });

    const ownerTeamIds = ownedTeams.map((team) => team.id);
    const adminTeamIds = memberships.filter((m) => m.role.name === "TEAM_ADMIN").map((m) => m.team_id);
    const agentTeamIds = memberships.filter((m) => m.role.name === "TEAM_AGENT").map((m) => m.team_id);
    const photographerTeamIds = memberships.filter((m) => m.role.name === "TEAM_PHOTOGRAPHER").map((m) => m.team_id);

    const fullAccessTeamIds = Array.from(new Set([...ownerTeamIds, ...adminTeamIds]));

    const orFilters: any[] = [];

    if (fullAccessTeamIds.length > 0) {
        orFilters.push({ team_id: { in: fullAccessTeamIds } });
    }

    if (agentTeamIds.length > 0) {
        orFilters.push({ team_id: { in: agentTeamIds }, created_by_user_id: userId });
        orFilters.push({
            team_id: { in: agentTeamIds },
            members: { some: { user_id: userId } },
        });
    }

    if (photographerTeamIds.length > 0) {
        orFilters.push({
            team_id: { in: photographerTeamIds },
            members: { some: { user_id: userId } },
        });
    }

    if (orFilters.length === 0) {
        return { success: true, message: "No projects found", projects: [] };
    }

    const projects = await prisma.team_project.findMany({
        where: { OR: orFilters },
        include: {
            team: true,
            created_by: true,
            members: { include: { user: true } },
        },
        orderBy: { created_at: "desc" },
    });

    return {
        success: true,
        message: "Projects fetched successfully",
        projects,
    };
}

export async function addProjectPhotographerService({
    projectId,
    userId,
    photographerId,
}: {
    projectId: string;
    userId: string;
    photographerId: string;
}) {
    const project = await prisma.team_project.findUnique({
        where: { id: projectId },
    });

    if (!project) {
        throw new Error("Project not found");
    }

    const { team, roleName } = await getTeamRole({ teamId: project.team_id, userId });
    if (!["TEAM_OWNER", "TEAM_ADMIN", "TEAM_AGENT"].includes(roleName)) {
        throw new Error("You are not allowed to add photographers");
    }

    const photographerMembership = await prisma.team_membership.findUnique({
        where: { team_id_user_id: { team_id: team.id, user_id: photographerId } },
        include: { role: true },
    });

    if (!photographerMembership || photographerMembership.role.name !== "TEAM_PHOTOGRAPHER") {
        throw new Error("Photographer must be a team member with photographer role");
    }

    const member = await prisma.team_project_member.upsert({
        where: { project_id_user_id: { project_id: project.id, user_id: photographerId } },
        create: {
            project_id: project.id,
            user_id: photographerId,
            role: "PHOTOGRAPHER",
        },
        update: {},
    });

    return {
        success: true,
        message: "Photographer added to project",
        member,
    };
}
