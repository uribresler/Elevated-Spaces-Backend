import prisma from "../dbConnection";

const GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

function isSubscriptionEffectivelyActive(purchase: { completed_at: Date | null; cancelledAt: Date | null; autoRenewEnabled: boolean }): boolean {
  const now = new Date();
  
  // If not cancelled and auto-renew enabled, it's active
  if (!purchase.cancelledAt && purchase.autoRenewEnabled) {
    return true;
  }
  
  // If cancelled or auto-renew disabled, check if within 30-day grace period from completed_at
  if (purchase.completed_at) {
    const graceExpiry = new Date(purchase.completed_at.getTime() + GRACE_PERIOD_MS);
    return now < graceExpiry;
  }
  
  return false;
}

async function hasActiveOrNotExpiredPersonalPurchase(userId: string) {
    const now = new Date();
    const purchase = await prisma.user_credit_purchase.findFirst({
        where: { user_id: userId, status: 'completed' },
        orderBy: { completed_at: 'desc' },
    });
    if (!purchase) return false;
    return isSubscriptionEffectivelyActive(purchase);
}

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

        if (!["TEAM_OWNER", "TEAM_ADMIN", "TEAM_MEMBER"].includes(roleName)) {
            throw new Error("You are not allowed to create projects for this team");
        }

        // Check if TEAM has an active subscription OR user has an active personal subscription
        const teamHasActivePurchase = await prisma.team_purchase.findFirst({
            where: { team_id: sanitizedTeamId, status: "completed" },
        });

        const userHasActivePurchase = await hasActiveOrNotExpiredPersonalPurchase(userId);

        // If team has no active purchase and current user doesn't have a personal active purchase,
        // allow creation when the team's owner has a personal active Pro/Pro+ purchase.
        let ownerHasActivePurchase = false;
        if (!teamHasActivePurchase) {
            const owner = await prisma.teams.findUnique({ where: { id: sanitizedTeamId }, select: { owner_id: true } });
            if (owner?.owner_id) {
                ownerHasActivePurchase = await hasActiveOrNotExpiredPersonalPurchase(owner.owner_id);
            }
        }

        if (!teamHasActivePurchase && !userHasActivePurchase && !ownerHasActivePurchase) {
            throw new Error("Creating projects requires either the team or your personal account (or the team owner) to have an active paid subscription. Please subscribe to a plan.");
        }
    } else {
        // For personal projects, user must have an active subscription
        const hasActivePurchase = await hasActiveOrNotExpiredPersonalPurchase(userId);
        if (!hasActivePurchase) {
            throw new Error("Creating projects requires an active paid subscription. Please subscribe to a plan.");
        }
    }

    // Validate photographer BEFORE creating the project (team projects only)
    if (sanitizedTeamId && photographerEmail) {
        const photographer = await prisma.user.findUnique({ where: { email: photographerEmail } });
        console.log('[DEBUG] Looking for photographer with email:', photographerEmail, '- Found:', !!photographer);
        if (!photographer) {
            throw new Error("Photographer not found. Invite them to the team first.");
        }

        const photographerMembership = await prisma.team_membership.findUnique({
            where: { team_id_user_id: { team_id: team!.id, user_id: photographer.id } },
            include: { role: true },
        });

        console.log('[DEBUG] Photographer membership found:', !!photographerMembership);
        console.log('[DEBUG] Membership deleted_at:', photographerMembership?.deleted_at);
        console.log('[DEBUG] Membership role full object:', photographerMembership?.role);

        if (!photographerMembership || photographerMembership.deleted_at) {
            throw new Error("Photographer must be a team member with photographer role");
        }

        const membershipRoleName = String(photographerMembership.role?.name || "").toUpperCase();
        console.log('[DEBUG] Photographer membership role name (original):', photographerMembership.role?.name);
        console.log('[DEBUG] Photographer membership role name (uppercase):', membershipRoleName);
        console.log('[DEBUG] Checking if role is TEAM_PHOTOGRAPHER or PHOTOGRAPHER:', membershipRoleName === "TEAM_PHOTOGRAPHER" || membershipRoleName === "PHOTOGRAPHER");

        if (membershipRoleName !== "TEAM_PHOTOGRAPHER" && membershipRoleName !== "PHOTOGRAPHER") {
            console.error('[ERROR] Invalid photographer role:', membershipRoleName);
            throw new Error("Photographer must be a team member with photographer role");
        }

        photographerId = photographer.id;
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
    const agentTeamIds = memberships.filter((m) => m.role.name === "TEAM_MEMBER").map((m) => m.team_id);
    const photographerTeamIds = memberships.filter((m) => m.role.name === "TEAM_PHOTOGRAPHER").map((m) => m.team_id);

    const fullAccessTeamIds = Array.from(new Set([...ownerTeamIds]));

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
    if (!["TEAM_OWNER", "TEAM_ADMIN", "TEAM_MEMBER"].includes(roleName)) {
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

    // Check access - project creator, team member, or team owner can view team projects
    if (project.created_by_user_id !== userId) {
        if (project.team_id) {
            const team = await prisma.teams.findUnique({
                where: { id: project.team_id },
                select: { owner_id: true },
            });

            if (team?.owner_id === userId) {
                // Team owner has full access to all projects created under their team
            } else {
                // Verify team membership for non-owners
                const membership = await prisma.team_membership.findFirst({
                    where: {
                        team_id: project.team_id,
                        user_id: userId,
                    },
                });

                if (!membership || membership.deleted_at) {
                    throw new Error("You don't have access to this project");
                }
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

