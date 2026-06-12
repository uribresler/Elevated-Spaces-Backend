import prisma from "../dbConnection";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET!

export async function signupService({
  email,
  password,
  name,
  fromDemoBonus = false,
  requestedRole = "USER",
  photographerProfile,
}: {
  email: string;
  password: string;
  name?: string;
  fromDemoBonus?: boolean;
  requestedRole?: string;
  photographerProfile?: {
    bio?: string;
    availability?: string;
    photographerType?: string;
    yearsExperience?: string;
    serviceArea?: string;
    portfolioUrl?: string;
    instagramUrl?: string;
    websiteUrl?: string;
    gearDescription?: string;
    businessName?: string;
    shortPitch?: string;
  };
}) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    const err: any = new Error("User already exists");
    err.code = "USER_EXISTS";
    throw err;
  }
  const hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email, password_hash: hash, name, auth_provider: "LOCAL" },
  });

  const defaultRole = await prisma.roles.upsert({
    where: { name: "USER" },
    update: {},
    create: {
      name: "USER",
      description: "Default role for all users",
    },
  });

  await prisma.user_roles.upsert({
    where: {
      user_id_role_id: {
        user_id: user.id,
        role_id: defaultRole.id,
      },
    },
    update: {},
    create: {
      user_id: user.id,
      role_id: defaultRole.id,
    },
  });

  if (requestedRole === "PHOTOGRAPHER") {
    const photographerRole = await prisma.roles.findUnique({ where: { name: "PHOTOGRAPHER" } });
    if (photographerRole) {
      await prisma.user_roles.create({
        data: {
          user_id: user.id,
          role_id: photographerRole.id,
        },
      });
      await prisma.photographer_profile.create({
        data: {
          user_id: user.id,
          bio: photographerProfile?.bio || null,
          availability: photographerProfile?.availability || null,
          photographer_type: photographerProfile?.photographerType || null,
          years_experience: photographerProfile?.yearsExperience || null,
          service_area: photographerProfile?.serviceArea || null,
          portfolio_url: photographerProfile?.portfolioUrl || null,
          instagram_url: photographerProfile?.instagramUrl || null,
          website_url: photographerProfile?.websiteUrl || null,
          gear_description: photographerProfile?.gearDescription || null,
          business_name: photographerProfile?.businessName || null,
          short_pitch: photographerProfile?.shortPitch || null,
          application_status: "SUBMITTED",
          approved: false,
          documents_url: null,
        },
      });
    }
  }

  // Add 5 bonus credits if signing up from demo bonus offer
  if (fromDemoBonus) {
    await prisma.user_credit_balance.upsert({
      where: { user_id: user.id },
      create: {
        user_id: user.id,
        balance: 5,
      },
      update: {
        balance: {
          increment: 5,
        },
      },
    });
  }

  const token = jwt.sign({ userId: user.id, role: defaultRole.name }, JWT_SECRET, { expiresIn: "7d" });
  return {
    token,
    user: { id: user.id, email: user.email, name: user.name, role: requestedRole === "PHOTOGRAPHER" ? "PHOTOGRAPHER" : defaultRole.name, created_at: user.created_at },
    success: true,
  };
}

export async function loginService({ email, password }: { email: string; password: string }) {
  const user = await prisma.user.findUnique({
    where: { email },
  });
  if (!user) {
    const err: any = new Error("Invalid credentials");
    err.code = "INVALID_CREDENTIALS";
    throw err;
  }

  // Check if user signed up with OAuth (no password set)
  if (!user.password_hash && user.auth_provider !== "LOCAL") {
    const err: any = new Error(`Please use ${user.auth_provider.toLowerCase()} login for this account`);
    err.code = "USE_OAUTH_LOGIN";
    err.provider = user.auth_provider.toLowerCase();
    throw err;
  }

  if (!user.password_hash) {
    const err: any = new Error("Invalid credentials");
    err.code = "INVALID_CREDENTIALS";
    throw err;
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    const err: any = new Error("Invalid credentials");
    err.code = "INVALID_CREDENTIALS";
    throw err;
  }

  const userRole = await prisma.user_roles.findFirst({
    where: { user_id: user.id },
    include: { role: true }
  })

  if (!userRole) {
    const err: any = new Error("Invalid Role");
    err.code = "INVALID_USER_ROLE";
    throw err;
  }
  const userWithRole = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: userRole.role.name,
    avatarUrl: user.avatar_url,
    created_at: user.created_at,
  };
  const token = jwt.sign({ userId: user.id, role: userRole.role.name }, JWT_SECRET, { expiresIn: "7d" });
  return {
    token,
    user: userWithRole,
    success: true,
  };
}

export async function updateProfileImageService({
  userId,
  avatarUrl,
}: {
  userId: string;
  avatarUrl: string;
}) {
  const existingUser = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!existingUser) {
    const err: any = new Error("User not found");
    err.code = "USER_NOT_FOUND";
    throw err;
  }

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: {
      avatar_url: avatarUrl,
    },
  });

  const userRole = await prisma.user_roles.findFirst({
    where: { user_id: userId },
    include: { role: true },
  });

  return {
    success: true,
    message: "Profile image updated successfully",
    user: {
      id: updatedUser.id,
      email: updatedUser.email,
      name: updatedUser.name,
      role: userRole?.role.name || "USER",
      avatar_url: updatedUser.avatar_url,
      created_at: updatedUser.created_at,
    },
  };
}

export async function deleteProfileImageService({ userId }: { userId: string }) {
  const existingUser = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!existingUser) {
    const err: any = new Error("User not found");
    err.code = "USER_NOT_FOUND";
    throw err;
  }

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: {
      avatar_url: null,
    },
  });

  const userRole = await prisma.user_roles.findFirst({
    where: { user_id: userId },
    include: { role: true },
  });

  return {
    success: true,
    message: "Profile image removed successfully",
    user: {
      id: updatedUser.id,
      email: updatedUser.email,
      name: updatedUser.name,
      role: userRole?.role.name || "USER",
      avatar_url: updatedUser.avatar_url,
      created_at: updatedUser.created_at,
    },
  };
}