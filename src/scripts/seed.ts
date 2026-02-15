import prisma from "../dbConnection";

const rolesArray = [
  { name: "USER", description: "Default app user" },
  { name: "ADMIN", description: "Main system admin" },
  { name: "OWNER", description: "Owns a team" },
  { name: "PHOTOGRAPHER", description: "Photographer service role" },
];

// All team permissions enabled (for TEAM_OWNER)
const teamOwnerPermissions = {
  manage_team: true,
  invite_members: true,
  remove_members: true,
  assign_credits: true,
  use_credits: true,
  view_usage: true,
  view_reports: true,
  manage_roles: true,
  manage_projects: true,
  view_all_projects: true,
};

const teamAdminPermissions = {
  manage_team: true,
  invite_members: true,
  remove_members: true,
  assign_credits: true,
  use_credits: true,
  view_usage: true,
  view_reports: true,
  manage_roles: true,
  manage_projects: true,
  view_all_projects: true,
};

const teamAgentPermissions = {
  manage_team: false,
  invite_members: true,
  remove_members: false,
  assign_credits: true,
  use_credits: true,
  view_usage: true,
  view_reports: false,
  manage_roles: false,
  manage_projects: true,
  view_all_projects: false,
};

const teamPhotographerPermissions = {
  manage_team: false,
  invite_members: false,
  remove_members: false,
  assign_credits: false,
  use_credits: true,
  view_usage: false,
  view_reports: false,
  manage_roles: false,
  manage_projects: false,
  view_all_projects: false,
};

const teamMemberPermissions = {
  manage_team: false,
  invite_members: false,
  remove_members: false,
  assign_credits: false,
  use_credits: true,
  view_usage: false,
  view_reports: false,
  manage_roles: false,
  manage_projects: false,
  view_all_projects: true,
};

async function seedRoles() {
  // Seed system roles
  await prisma.roles.createMany({
    data: rolesArray,
    skipDuplicates: true,
  });
  console.log("System roles seeded");

  // Upsert TEAM_OWNER role with full permissions
  await prisma.team_roles.upsert({
    where: { name: "TEAM_OWNER" },
    update: {
      permissions: teamOwnerPermissions, // if Json type
    },
    create: {
      name: "TEAM_OWNER",
      description: "Full control over the team",
      permissions: teamOwnerPermissions,
    },
  });

  await prisma.team_roles.upsert({
    where: { name: "TEAM_ADMIN" },
    update: {
      permissions: teamAdminPermissions,
    },
    create: {
      name: "TEAM_ADMIN",
      description: "Admin control over the team",
      permissions: teamAdminPermissions,
    },
  });

  await prisma.team_roles.upsert({
    where: { name: "TEAM_AGENT" },
    update: {
      permissions: teamAgentPermissions,
    },
    create: {
      name: "TEAM_AGENT",
      description: "Agent role with project creation and invite permissions",
      permissions: teamAgentPermissions,
    },
  });

  await prisma.team_roles.upsert({
    where: { name: "TEAM_PHOTOGRAPHER" },
    update: {
      permissions: teamPhotographerPermissions,
    },
    create: {
      name: "TEAM_PHOTOGRAPHER",
      description: "Photographer role with project access",
      permissions: teamPhotographerPermissions,
    },
  });

  await prisma.team_roles.upsert({
    where: { name: "TEAM_MEMBER" },
    update: {
      permissions: teamMemberPermissions,
    },
    create: {
      name: "TEAM_MEMBER",
      description: "Standard team member",
      permissions: teamMemberPermissions,
    },
  });

  // Backward compatibility for existing TEAM_USER references
  await prisma.team_roles.upsert({
    where: { name: "TEAM_USER" },
    update: {
      permissions: teamMemberPermissions,
    },
    create: {
      name: "TEAM_USER",
      description: "Legacy team member role",
      permissions: teamMemberPermissions,
    },
  });

  console.log("Team roles seeded with hierarchy permissions");
}

seedRoles()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
