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
    teamId?: string | null;
    name: string;
    address?: string;
    description?: string;
    userId: string;
    photographerEmail?: string;
}) {
    if (!name.trim()) {
        throw new Error("Project name is required");
    }

    // Sanitize teamId - treat empty strings, "null", "undefined" as null
    const sanitizedTeamId = teamId && teamId !== 'null' && teamId !== 'undefined' && teamId.trim() !== '' 
        ? teamId.trim() 
        : null;

    let team = null;
    let roleName = null;
    let photographerId: string | undefined;

    // If teamId is provided, validate team access and permissions
    if (sanitizedTeamId) {
        const teamData = await getTeamRole({ teamId: sanitizedTeamId, userId });
        team = teamData.team;
        roleName = teamData.roleName;

        if (!["TEAM_OWNER", "TEAM_ADMIN", "TEAM_AGENT"].includes(roleName)) {
            throw new Error("You are not allowed to create projects for this team");
        }

        // Validate photographer BEFORE creating the project (team projects only)
        if (photographerEmail) {
            const photographer = await prisma.user.findUnique({ where: { email: photographerEmail } });
            if (!photographer) {
                throw new Error("Photographer not found. Invite them to the team first.");
            }

            const photographerMembership = await prisma.team_membership.findUnique({
                where: { team_id_user_id: { team_id: team.id, user_id: photographer.id } },
                include: { role: true },
            });

            if (!photographerMembership || photographerMembership.deleted_at || photographerMembership.role.name !== "TEAM_PHOTOGRAPHER") {
                throw new Error("Photographer must be a team member with photographer role");
            }

            photographerId = photographer.id;
        }
    }

    // Create project (team or personal)
    const project = await prisma.team_project.create({
        data: {
            team_id: sanitizedTeamId,
            name: name.trim(),
            address: address?.trim() || null,
            description: description?.trim() || null,
            created_by_user_id: userId,
        },
    });

    // Add photographer to project if provided (team projects only)
    if (photographerId) {
        await prisma.team_project_member.create({
            data: {
                project_id: project.id,
                user_id: photographerId,
                role: "PHOTOGRAPHER",
            },
        });
    }

    return {
        success: true,
        message: sanitizedTeamId 
            ? "Team project created successfully" 
            : "Personal project created successfully",
        data: { project },
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

    // Include personal projects (no team)
    orFilters.push({ team_id: null, created_by_user_id: userId });

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

    // orFilters will always have at least one entry (personal projects)
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

    if (!project.team_id) {
        throw new Error("Project must belong to a team to add photographers");
    }

    const { team, roleName } = await getTeamRole({ teamId: project.team_id, userId });
    if (!["TEAM_OWNER", "TEAM_ADMIN", "TEAM_AGENT"].includes(roleName)) {
        throw new Error("You are not allowed to add photographers");
    }

    const photographerMembership = await prisma.team_membership.findUnique({
        where: { team_id_user_id: { team_id: team.id, user_id: photographerId } },
        include: { role: true },
    });

    if (!photographerMembership || photographerMembership.deleted_at || photographerMembership.role.name !== "TEAM_PHOTOGRAPHER") {
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

export async function getProjectImagesService({
    projectId,
    userId,
}: {
    projectId: string;
    userId: string;
}) {
    const project = await prisma.team_project.findUnique({
        where: { id: projectId },
    });

    if (!project) {
        throw new Error("Project not found");
    }

    // Check access - user must be project creator or team member (if team project)
    if (project.created_by_user_id !== userId) {
        if (project.team_id) {
            // Verify team access
            const membership = await prisma.team_membership.findFirst({
                where: {
                    team_id: project.team_id,
                    user_id: userId,
                },
            });

            if (!membership || membership.deleted_at) {
                throw new Error("You don't have access to this project");
            }
        } else {
            throw new Error("You don't have access to this project");
        }
    }

    // Fetch all images for this project grouped by original image
    const images = await prisma.image.findMany({
        where: { project_id: projectId },
        include: { 
            user: { select: { id: true, name: true, email: true } }
        },
        orderBy: { created_at: "desc" },
    });

    // Group images by original_image_url to show all variations together
    const groupedImages: { [key: string]: any } = {};
    
    images.forEach((img) => {
        const originalUrl = img.original_image_url;
        
        if (!groupedImages[originalUrl]) {
            groupedImages[originalUrl] = {
                original: {
                    url: img.original_image_url,
                    filename: img.original_image_url.split('/').pop() || 'original',
                },
                stagedVersions: [],
                metadata: {
                    roomType: img.room_type,
                    stagingStyle: img.staging_style,
                    prompt: img.prompt,
                    createdAt: img.created_at,
                    uploadedBy: img.user,
                },
            };
        }

        // Add staged version if exists
        if (img.staged_image_url) {
            groupedImages[originalUrl].stagedVersions.push({
                id: img.id,
                url: img.staged_image_url,
                filename: img.staged_image_url.split('/').pop() || `staged-${img.id}`,
                watermarked: img.watermarked_preview_url,
                createdAt: img.updated_at,
            });
        }
    });

    // Convert to array and limit to 5 staged versions per original
    const formattedImages = Object.values(groupedImages).map((group: any) => ({
        ...group,
        stagedVersions: group.stagedVersions.slice(0, 5), // Keep only first 5 versions
    }));

    return {
        success: true,
        message: "Project images fetched successfully",
        data: {
            projectId,
            projectName: project.name,
            projectAddress: project.address,
            totalImages: images.length,
            imageGroups: formattedImages,
        },
    };
}

