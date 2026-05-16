import prisma from "../dbConnection";

declare const process: {
  exit: (code?: number) => never;
};

const rolesArray = [
  { name: "USER", description: "Default app user" },
  { name: "ADMIN", description: "Main system admin" },
  { name: "OWNER", description: "Owns a team" },
  { name: "PHOTOGRAPHER", description: "Photographer service role" },
];

const packages = [
  { name: "Starter", credits: 60, price: 29 },
  { name: "Starter Annual", credits: 720, price: 300 },
  { name: "Pro", credits: 160, price: 69 },
  { name: "Pro Annual", credits: 1920, price: 744 },
  { name: "Team", credits: 360, price: 139 },
  { name: "Team Annual", credits: 4320, price: 1500 },
  { name: "Enterprise", credits: 999999, price: 0 },
  { name: "Pay Per Image", credits: 1, price: 0.5 },
];

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

async function seedSystemRoles() {
  await prisma.roles.createMany({
    data: rolesArray,
    skipDuplicates: true,
  });

  console.log("System roles seeded");
}

async function seedTeamRoles() {
  await prisma.team_roles.upsert({
    where: { name: "TEAM_OWNER" },
    update: { permissions: teamOwnerPermissions },
    create: {
      name: "TEAM_OWNER",
      description: "Full control over the team",
      permissions: teamOwnerPermissions,
    },
  });

  await prisma.team_roles.upsert({
    where: { name: "TEAM_ADMIN" },
    update: { permissions: teamAdminPermissions },
    create: {
      name: "TEAM_ADMIN",
      description: "Admin control over the team",
      permissions: teamAdminPermissions,
    },
  });

  await prisma.team_roles.upsert({
    where: { name: "TEAM_MEMBER" },
    update: { permissions: teamAgentPermissions },
    create: {
      name: "TEAM_MEMBER",
      description: "Member role with project creation and invite permissions",
      permissions: teamAgentPermissions,
    },
  });

  await prisma.team_roles.upsert({
    where: { name: "TEAM_PHOTOGRAPHER" },
    update: { permissions: teamPhotographerPermissions },
    create: {
      name: "TEAM_PHOTOGRAPHER",
      description: "Photographer role with project access",
      permissions: teamPhotographerPermissions,
    },
  });

  console.log("Team roles seeded with hierarchy permissions");
}

async function seedCreditPackages() {
  for (const pkg of packages) {
    const existingPackage = await prisma.credit_package.findFirst({
      where: { name: pkg.name },
    });

    if (existingPackage) {
      await prisma.credit_package.update({
        where: { id: existingPackage.id },
        data: { credits: pkg.credits, price: pkg.price, currency: "usd", active: true },
      });
    } else {
      await prisma.credit_package.create({
        data: { name: pkg.name, credits: pkg.credits, price: pkg.price, currency: "usd", active: true },
      });
    }

    console.log(`Upserted package ${pkg.name}`);
  }
}

export async function main() {
  await seedSystemRoles();
  await seedTeamRoles();
  await seedCreditPackages();

  console.log("Seeding complete");
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
