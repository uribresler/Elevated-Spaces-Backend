import crypto from "crypto";
import prisma from "../dbConnection";
import { invitationService } from "./teams.service";
import { sendEmail } from "../config/mail.config";

const GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

function normalizeProjectName(name: string) {
    return name.trim().replace(/\s+/g, " ");
}

async function getProjectWithAccess({ projectId, userId }: { projectId: string; userId: string }) {
    const project = await prisma.team_project.findUnique({
        where: { id: projectId },
        include: { team: true },
    });

    if (!project) {
        throw new Error("Project not found");
    }

    if (project.created_by_user_id !== userId) {
        throw new Error("You are not allowed to rename this project");
    }

    return project;
}

function isSubscriptionEffectivelyActive(purchase: { status?: string; completed_at: Date | null; cancelledAt: Date | null; autoRenewEnabled: boolean }): boolean {
  if (purchase.status && purchase.status !== "completed") {
    return false;
  }

  const now = new Date();
    if (purchase.cancelledAt && purchase.cancelledAt.getTime() > now.getTime()) {
        return true;
    }
  
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

async function sendPersonalProjectInvitationEmail({
    email,
    projectName,
    invitedByUserId,
}: {
    email: string;
    projectName: string;
    invitedByUserId: string;
}) {
    try {
        const inviter = await prisma.user.findUnique({ where: { id: invitedByUserId }, select: { name: true, email: true } });
        const inviterName = inviter?.name || inviter?.email || "Someone";
        const subject = `You've been invited to collaborate on "${projectName}"`;
        const text = `Hi,\n\n${inviterName} has invited you to collaborate on the project "${projectName}" as a Photographer on Elevated Spaces.\n\nSign up or log in to Elevated Spaces to view and manage this project.\n\nBest,\nThe Elevated Spaces Team`;
        const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);padding:32px 24px;border-radius:8px 8px 0 0">
    <h1 style="color:#fff;margin:0;font-size:24px">Project Collaboration Invite</h1>
  </div>
  <div style="background:#fff;padding:32px 24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
    <p style="color:#374151;font-size:16px">Hi,</p>
    <p style="color:#374151;font-size:16px"><strong>${inviterName}</strong> has invited you to collaborate on the project <strong>"${projectName}"</strong> as a <strong>Photographer</strong>.</p>
    <p style="color:#374151;font-size:16px">Sign up or log in to Elevated Spaces to view and manage this project.</p>
    <p style="color:#6b7280;font-size:14px;margin-top:32px">Best,<br>The Elevated Spaces Team</p>
  </div>
</div>`;

        setImmediate(() => {
            sendEmail({
                from: process.env.SENDGRID_VERIFIED_SENDER || "noreply@elevatespacesai.com",
                senderName: "Elevated Spaces",
                to: email,
                subject,
                text,
                html,
            }).catch((err) => console.error("Failed to send personal project invitation email:", err));
        });
    } catch (err) {
        console.error("Error preparing personal project invitation email:", err);
    }
}

async function sendProjectCollaborationEmail({
    photographerId,
    projectName,
    invitedByUserId,
}: {
    photographerId: string;
    projectName: string;
    invitedByUserId: string;
}) {
    try {
        const [photographer, inviter] = await Promise.all([
            prisma.user.findUnique({ where: { id: photographerId }, select: { email: true, name: true } }),
            prisma.user.findUnique({ where: { id: invitedByUserId }, select: { name: true, email: true } }),
        ]);

        if (!photographer?.email) return;

        const inviterName = inviter?.name || inviter?.email || "Someone";
        const subject = `You've been invited to collaborate on "${projectName}"`;
        const text = `Hi${photographer.name ? ` ${photographer.name}` : ""},\n\n${inviterName} has invited you to collaborate on the project "${projectName}" as a Photographer.\n\nLog in to Elevated Spaces to view and manage this project.\n\nBest,\nThe Elevated Spaces Team`;
        const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);padding:32px 24px;border-radius:8px 8px 0 0">
    <h1 style="color:#fff;margin:0;font-size:24px">Project Collaboration Invite</h1>
  </div>
  <div style="background:#fff;padding:32px 24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
    <p style="color:#374151;font-size:16px">Hi${photographer.name ? ` ${photographer.name}` : ""},</p>
    <p style="color:#374151;font-size:16px"><strong>${inviterName}</strong> has invited you to collaborate on the project <strong>"${projectName}"</strong> as a <strong>Photographer</strong>.</p>
    <p style="color:#374151;font-size:16px">Log in to Elevated Spaces to view and manage this project.</p>
    <p style="color:#6b7280;font-size:14px;margin-top:32px">Best,<br>The Elevated Spaces Team</p>
  </div>
</div>`;

        setImmediate(() => {
            sendEmail({
                from: process.env.SENDGRID_VERIFIED_SENDER || "noreply@elevatespacesai.com",
                senderName: "Elevated Spaces",
                to: photographer.email!,
                subject,
                text,
                html,
            }).catch((err) => console.error("Failed to send project collaboration email:", err));
        });
    } catch (err) {
        console.error("Error preparing project collaboration email:", err);
    }
}

async function inviteProjectPhotographer({
    projectId,
    projectName,
    teamId,
    invitedByUserId,
    photographerEmail,
}: {
    projectId: string;
    projectName: string;
    teamId: string;
    invitedByUserId: string;
    photographerEmail: string;
}) {
    const normalizedEmail = photographerEmail.trim().toLowerCase();
    if (!normalizedEmail) {
        throw new Error("Photographer email is required");
    }

    const existingUser = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true },
    });

    if (existingUser) {
        const existingMembership = await prisma.team_membership.findUnique({
            where: { team_id_user_id: { team_id: teamId, user_id: existingUser.id } },
            include: { role: true },
        });

        if (existingMembership && !existingMembership.deleted_at) {
            const roleName = String(existingMembership.role?.name || "").toUpperCase();
            if (roleName !== "TEAM_PHOTOGRAPHER" && roleName !== "PHOTOGRAPHER") {
                throw new Error("Photographer must be a team member with photographer role");
            }

            await prisma.team_project_member.upsert({
                where: { project_id_user_id: { project_id: projectId, user_id: existingUser.id } },
                create: {
                    project_id: projectId,
                    user_id: existingUser.id,
                    role: "PHOTOGRAPHER",
                },
                update: {},
            });

            return {
                projectInvite: null,
                invitationSent: false,
                accessGranted: true,
            };
        }
    }

    await invitationService({
        email: normalizedEmail,
        userId: invitedByUserId,
        subject: `Invitation to collaborate on ${projectName}`,
        text: `You have been invited to collaborate on the project \"${projectName}\". Please accept the team invitation to unlock full project access.`,
        teamId,
        roleName: "TEAM_PHOTOGRAPHER",
    });

    const projectInvite = await prisma.project_invites.upsert({
        where: {
            project_id_email: {
                project_id: projectId,
                email: normalizedEmail,
            },
        },
        create: {
            project_id: projectId,
            team_id: teamId,
            email: normalizedEmail,
            invited_by_user_id: invitedByUserId,
            token: crypto.randomUUID(),
            status: "PENDING",
        },
        update: {
            team_id: teamId,
            invited_by_user_id: invitedByUserId,
            status: "PENDING",
            accepted_at: null,
            accepted_by_user_id: null,
            token: crypto.randomUUID(),
        },
    });

    return {
        projectInvite,
        invitationSent: true,
        accessGranted: false,
    };
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
    const normalizedName = normalizeProjectName(name);

    if (!normalizedName) {
        throw new Error("Project name is required");
    }

    // Sanitize teamId - treat empty strings, "null", "undefined" as null
    const sanitizedTeamId = teamId && teamId !== 'null' && teamId !== 'undefined' && teamId.trim() !== '' 
        ? teamId.trim() 
        : null;

    let team = null;
    let roleName = null;
    let photographerId: string | undefined;
    let invitedPhotographerEmail: string | null = null;

    // If teamId is provided, validate team access and permissions
    if (sanitizedTeamId) {
        const teamData = await getTeamRole({ teamId: sanitizedTeamId, userId });
        team = teamData.team;
        roleName = teamData.roleName;

        if (!["TEAM_OWNER", "TEAM_ADMIN", "TEAM_MEMBER"].includes(roleName)) {
            throw new Error("You are not allowed to create projects for this team, Please contact Member / Admin, so they can create and add you");
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

        const existingTeamProject = await prisma.team_project.findFirst({
            where: {
                team_id: sanitizedTeamId,
                name: { equals: normalizedName, mode: "insensitive" },
            },
            select: { id: true },
        });

        if (existingTeamProject) {
            const error: any = new Error("A project with this name already exists in this team. Please choose a different name.");
            error.code = "PROJECT_NAME_TAKEN";
            throw error;
        }
    } else {
        // For personal projects, user must have their OWN active personal plan.
        // Being inside a team that has a plan does NOT entitle them to private
        // personal projects — those need a personal subscription.
        const hasActivePurchase = await hasActiveOrNotExpiredPersonalPurchase(userId);
        if (!hasActivePurchase) {
            const teamMembershipCount = await prisma.team_membership.count({
                where: { user_id: userId, deleted_at: null },
            });
            const error: any = new Error(
                teamMembershipCount > 0
                    ? "Personal projects require your own plan. You're currently part of a team subscription, which only covers team projects (visible to the team owner and admins). To create private projects that only you can access, please purchase a personal plan."
                    : "Personal projects require an active personal plan. Please subscribe to a plan to create private projects."
            );
            error.code = "PERSONAL_PLAN_REQUIRED";
            throw error;
        }
        // Ensure personal project name uniqueness per user
        const existingPersonalProject = await prisma.team_project.findFirst({
            where: {
                created_by_user_id: userId,
                team_id: null,
                name: { equals: normalizedName, mode: "insensitive" },
            },
            select: { id: true },
        });

        if (existingPersonalProject) {
            const error: any = new Error("A personal project with this name already exists. Please choose a different name.");
            error.code = "PROJECT_NAME_TAKEN";
            throw error;
        }
    }

    // Validate photographer BEFORE creating the project (team projects only)
    if (sanitizedTeamId && photographerEmail) {
        const photographer = await prisma.user.findUnique({ where: { email: photographerEmail.trim().toLowerCase() } });
        console.log('[DEBUG] Looking for photographer with email:', photographerEmail, '- Found:', !!photographer);
        if (photographer) {
            const photographerMembership = await prisma.team_membership.findUnique({
                where: { team_id_user_id: { team_id: team!.id, user_id: photographer.id } },
                include: { role: true },
            });

            console.log('[DEBUG] Photographer membership found:', !!photographerMembership);
            console.log('[DEBUG] Membership deleted_at:', photographerMembership?.deleted_at);
            console.log('[DEBUG] Membership role full object:', photographerMembership?.role);

            if (photographerMembership && !photographerMembership.deleted_at) {
                const membershipRoleName = String(photographerMembership.role?.name || "").toUpperCase();
                console.log('[DEBUG] Photographer membership role name (original):', photographerMembership.role?.name);
                console.log('[DEBUG] Photographer membership role name (uppercase):', membershipRoleName);
                console.log('[DEBUG] Checking if role is TEAM_PHOTOGRAPHER or PHOTOGRAPHER:', membershipRoleName === "TEAM_PHOTOGRAPHER" || membershipRoleName === "PHOTOGRAPHER");

                if (membershipRoleName !== "TEAM_PHOTOGRAPHER" && membershipRoleName !== "PHOTOGRAPHER") {
                    console.error('[ERROR] Invalid photographer role:', membershipRoleName);
                    throw new Error("Photographer must be a team member with photographer role");
                }

                photographerId = photographer.id;
            } else {
                invitedPhotographerEmail = photographerEmail.trim().toLowerCase();
            }
        } else {
            invitedPhotographerEmail = photographerEmail.trim().toLowerCase();
        }
    }

    // Create project (team or personal)
    const project = await prisma.team_project.create({
        data: {
            team_id: sanitizedTeamId,
            name: normalizedName,
            address: address?.trim() || null,
            description: description?.trim() || null,
            created_by_user_id: userId,
        },
    });

    // Add photographer or create a pending project invite if provided (team projects only)
    if (photographerId) {
        await prisma.team_project_member.create({
            data: {
                project_id: project.id,
                user_id: photographerId,
                role: "PHOTOGRAPHER",
            },
        });
        sendProjectCollaborationEmail({ photographerId, projectName: project.name, invitedByUserId: userId });
    } else if (invitedPhotographerEmail && team) {
        await inviteProjectPhotographer({
            projectId: project.id,
            projectName: project.name,
            teamId: team.id,
            invitedByUserId: userId,
            photographerEmail: invitedPhotographerEmail,
        });
    }

    // Personal project: invite anyone by email (no team membership required)
    let personalPhotographerInvited = false;
    if (!sanitizedTeamId && photographerEmail) {
        const normalizedEmail = photographerEmail.trim().toLowerCase();
        if (normalizedEmail) {
            const existingPhotographer = await prisma.user.findUnique({
                where: { email: normalizedEmail },
                select: { id: true },
            });

            if (existingPhotographer) {
                await prisma.team_project_member.upsert({
                    where: { project_id_user_id: { project_id: project.id, user_id: existingPhotographer.id } },
                    create: {
                        project_id: project.id,
                        user_id: existingPhotographer.id,
                        role: "PHOTOGRAPHER",
                    },
                    update: { role: "PHOTOGRAPHER" },
                });
                sendProjectCollaborationEmail({
                    photographerId: existingPhotographer.id,
                    projectName: project.name,
                    invitedByUserId: userId,
                });
            } else {
                await prisma.project_invites.upsert({
                    where: { project_id_email: { project_id: project.id, email: normalizedEmail } },
                    create: {
                        project_id: project.id,
                        team_id: null,
                        email: normalizedEmail,
                        invited_by_user_id: userId,
                        token: crypto.randomUUID(),
                        status: "PENDING",
                    },
                    update: {
                        invited_by_user_id: userId,
                        status: "PENDING",
                        accepted_at: null,
                        accepted_by_user_id: null,
                        token: crypto.randomUUID(),
                    },
                });
            }
            personalPhotographerInvited = true;
        }
    }

    return {
        success: true,
        message: sanitizedTeamId
            ? (invitedPhotographerEmail ? "Team project created successfully. Photographer invitation sent." : "Team project created successfully")
            : (personalPhotographerInvited ? "Personal project created successfully. Photographer invitation sent." : "Personal project created successfully"),
        project,
        data: { project },
    };
}

export async function updateProjectNameService({
    projectId,
    userId,
    name,
}: {
    projectId: string;
    userId: string;
    name: string;
}) {
    const normalizedName = normalizeProjectName(name);

    if (!normalizedName) {
        throw new Error("Project name is required");
    }

    const project = await getProjectWithAccess({ projectId, userId });

    if (project.team_id) {
        const duplicate = await prisma.team_project.findFirst({
            where: {
                id: { not: project.id },
                team_id: project.team_id,
                name: { equals: normalizedName, mode: "insensitive" },
            },
            select: { id: true },
        });

        if (duplicate) {
            const error: any = new Error("A project with this name already exists in this team. Please choose a different name.");
            error.code = "PROJECT_NAME_TAKEN";
            throw error;
        }
    } else {
        const duplicate = await prisma.team_project.findFirst({
            where: {
                id: { not: project.id },
                created_by_user_id: userId,
                team_id: null,
                name: { equals: normalizedName, mode: "insensitive" },
            },
            select: { id: true },
        });

        if (duplicate) {
            const error: any = new Error("A personal project with this name already exists. Please choose a different name.");
            error.code = "PROJECT_NAME_TAKEN";
            throw error;
        }
    }

    const updatedProject = await prisma.team_project.update({
        where: { id: project.id },
        data: { name: normalizedName },
        include: {
            team: true,
            created_by: true,
            members: { include: { user: true } },
        },
    });

    return {
        success: true,
        message: "Project renamed successfully",
        project: updatedProject,
        data: { project: updatedProject },
    };
}

export async function getMyProjectsService({ userId }: { userId: string }) {
    const currentUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
    });

    const memberships = await prisma.team_membership.findMany({
        where: { user_id: userId, deleted_at: null },
        include: { role: true },
    });

    const ownedTeams = await prisma.teams.findMany({
        where: { owner_id: userId },
        select: { id: true },
    });

    const ownerTeamIds = ownedTeams.map((team) => team.id);
    const adminTeamIds = memberships.filter((m) => m.role.name === "TEAM_ADMIN").map((m) => m.team_id);
    const memberTeamIds = memberships.filter((m) => m.role.name === "TEAM_MEMBER").map((m) => m.team_id);
    const photographerTeamIds = memberships.filter((m) => m.role.name === "TEAM_PHOTOGRAPHER").map((m) => m.team_id);

    const ownerOrAdminTeamIds = Array.from(new Set([...ownerTeamIds, ...adminTeamIds]));

    const orFilters: any[] = [];

    // Include personal projects (no team) created by the user
    orFilters.push({ team_id: null, created_by_user_id: userId });

    // Include personal projects where the user was added as a member (e.g. photographer)
    orFilters.push({ team_id: null, members: { some: { user_id: userId } } });

    // Owners and admins can see all projects in their teams
    if (ownerOrAdminTeamIds.length > 0) {
        orFilters.push({ team_id: { in: ownerOrAdminTeamIds } });
    }

    // Team members can only see projects they created in those teams
    if (memberTeamIds.length > 0) {
        orFilters.push({
            team_id: { in: memberTeamIds },
            created_by_user_id: userId,
        });
    }

    // Photographers can see projects where they were explicitly added
    if (photographerTeamIds.length > 0) {
        orFilters.push({
            team_id: { in: photographerTeamIds },
            members: { some: { user_id: userId } },
        });
    }

    if (currentUser?.email) {
        orFilters.push({
            projectInvites: {
                some: {
                    email: currentUser.email,
                    status: { in: ["PENDING", "ACCEPTED"] },
                },
            },
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
    photographerEmail,
}: {
    projectId: string;
    userId: string;
    photographerId?: string;
    photographerEmail?: string;
}) {
    const project = await prisma.team_project.findUnique({
        where: { id: projectId },
    });

    if (!project) {
        throw new Error("Project not found");
    }

    // Personal project path
    if (!project.team_id) {
        if (project.created_by_user_id !== userId) {
            throw new Error("Only the project creator can add photographers to a personal project");
        }
        if (!photographerEmail) {
            throw new Error("Photographer email is required for personal projects");
        }

        const normalizedEmail = photographerEmail.trim().toLowerCase();
        const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });

        if (existingUser && existingUser.id === userId) {
            throw new Error("You cannot add yourself as a photographer on your own project");
        }

        if (existingUser) {
            const member = await prisma.team_project_member.upsert({
                where: { project_id_user_id: { project_id: project.id, user_id: existingUser.id } },
                create: { project_id: project.id, user_id: existingUser.id, role: "PHOTOGRAPHER" },
                update: {},
                include: { user: true },
            });
            sendProjectCollaborationEmail({ photographerId: existingUser.id, projectName: project.name, invitedByUserId: userId });
            return { success: true, message: "Photographer added to project", member, projectInvite: null };
        } else {
            const projectInvite = await prisma.project_invites.upsert({
                where: { project_id_email: { project_id: project.id, email: normalizedEmail } },
                create: {
                    project_id: project.id,
                    team_id: null,
                    email: normalizedEmail,
                    invited_by_user_id: userId,
                    token: crypto.randomUUID(),
                    status: "PENDING",
                },
                update: {
                    invited_by_user_id: userId,
                    status: "PENDING",
                    accepted_at: null,
                    accepted_by_user_id: null,
                    token: crypto.randomUUID(),
                },
            });
            sendPersonalProjectInvitationEmail({ email: normalizedEmail, projectName: project.name, invitedByUserId: userId });
            return { success: true, message: "Photographer invitation sent", member: null, projectInvite };
        }
    }

    const { team } = await getTeamRole({ teamId: project.team_id, userId });
    if (team.owner_id !== userId && project.created_by_user_id !== userId) {
        throw new Error("You are not allowed to add photographers");
    }

    let member: any = null;
    let projectInvite: any = null;

    if (photographerEmail) {
        const result = await inviteProjectPhotographer({
            projectId: project.id,
            projectName: project.name,
            teamId: team.id,
            invitedByUserId: userId,
            photographerEmail,
        });
        member = result.accessGranted ? await prisma.team_project_member.findFirst({
            where: { project_id: project.id },
            include: { user: true },
        }) : null;
        projectInvite = result.projectInvite;
    } else if (photographerId) {
        const photographerMembership = await prisma.team_membership.findUnique({
            where: { team_id_user_id: { team_id: team.id, user_id: photographerId } },
            include: { role: true },
        });

        if (!photographerMembership || photographerMembership.deleted_at || photographerMembership.role.name !== "TEAM_PHOTOGRAPHER") {
            throw new Error("Photographer must be a team member with photographer role");
        }

        member = await prisma.team_project_member.upsert({
            where: { project_id_user_id: { project_id: project.id, user_id: photographerId } },
            create: {
                project_id: project.id,
                user_id: photographerId,
                role: "PHOTOGRAPHER",
            },
            update: {},
        });
        sendProjectCollaborationEmail({ photographerId, projectName: project.name, invitedByUserId: userId });
    } else {
        throw new Error("Photographer is required");
    }

    return {
        success: true,
        message: projectInvite ? "Photographer invitation sent" : "Photographer added to project",
        member,
        projectInvite,
    };
}

export async function deleteProjectPhotographerService({
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
        include: { team: true },
    });

    if (!project) {
        throw new Error("Project not found");
    }

    // Personal project path
    if (!project.team_id) {
        if (project.created_by_user_id !== userId) {
            throw new Error("Only the project creator can remove photographers from a personal project");
        }

        const membership = await prisma.team_project_member.findUnique({
            where: { project_id_user_id: { project_id: project.id, user_id: photographerId } },
        });

        if (!membership) {
            throw new Error("Photographer is not assigned to this project");
        }

        await prisma.team_project_member.delete({ where: { id: membership.id } });

        return { success: true, message: "Photographer removed from project" };
    }

    const { team } = await getTeamRole({ teamId: project.team_id, userId });
    if (team.owner_id !== userId && project.created_by_user_id !== userId) {
        throw new Error("You are not allowed to remove photographers");
    }

    const membership = await prisma.team_project_member.findUnique({
        where: { project_id_user_id: { project_id: project.id, user_id: photographerId } },
    });

    if (!membership) {
        throw new Error("Photographer is not assigned to this project");
    }

    await prisma.team_project_member.delete({
        where: { id: membership.id },
    });

    return {
        success: true,
        message: "Photographer removed from project",
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
                    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
                    const invite = user?.email
                        ? await prisma.project_invites.findFirst({
                            where: {
                                project_id: project.id,
                                email: user.email,
                                status: { in: ["PENDING", "ACCEPTED"] },
                            },
                        })
                        : null;

                    if (!invite) {
                        throw new Error("You don't have access to this project");
                    }
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

