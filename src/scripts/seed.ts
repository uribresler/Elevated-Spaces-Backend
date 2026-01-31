import prisma from "../dbConnection";

const rolesArray = [
   {
      name: 'USER',
      description: "User role - assigned default to all user"
   },
   {
      name: "ADMIN",
      description: "ADMIN role - only the main app holder to be assigned from database directly"
   },
   {
      name: "OWNER",
      description: "OWNER role - a role that manages his team"
   },
   {
      name: "PHOTOGRAPHER",
      description: "an alternate role to user for photographers services"
   }
]

async function seedRoles() {
   await prisma.roles.createMany({
      data: rolesArray,
      skipDuplicates: true
   })
   console.log("All roles created")
}

seedRoles().catch((e) => {
   console.error(e);
   process.exit(1);
})
   .finally(async () => {
      await prisma.$disconnect();
   })