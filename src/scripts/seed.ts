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
    where: { name: "TEAM_USER" },
    update: {
      permissions: teamOwnerPermissions, // if Json type
    },
    create: {
      name: "TEAM_USER",
      description: "limited control over the team",
      permissions: teamOwnerPermissions,
    },
  });

  console.log("TEAM_OWNER & TEAM_USER role seeded with full permissions");
}

seedRoles()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
