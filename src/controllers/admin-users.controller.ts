import { Request, Response } from 'express';
import prisma from '../dbConnection';

export async function getAdminUsersHandler(_req: Request, res: Response) {
  try {
    const users = await prisma.user.findMany({
      where: { deleted_at: null },
      select: {
        id: true,
        name: true,
        email: true,
        avatar_url: true,
        created_at: true,
        updated_at: true,
        ai_generation_consent_first_at: true,
        ai_generation_consent_last_at: true,
        system_roles: {
          include: {
            role: true,
          },
        },
        _count: {
          select: {
            owned_teams: true,
            created_projects: true,
            team_memberships: true,
            credit_purchases: true,
          },
        },
      },
      orderBy: [
        { ai_generation_consent_last_at: 'desc' },
        { created_at: 'desc' },
      ],
    });

    const mappedUsers = users.map((user) => {
      const roleNames = user.system_roles.map((entry) => entry.role.name);
      const firstConsentAt = user.ai_generation_consent_first_at || null;
      const lastConsentAt = user.ai_generation_consent_last_at || null;

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatar_url,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
        roles: roleNames,
        aiConsentAccepted: Boolean(lastConsentAt),
        aiConsentFirstAcceptedAt: firstConsentAt,
        aiConsentRecentAcceptedAt: lastConsentAt,
        summary: {
          ownedTeams: user._count.owned_teams,
          createdProjects: user._count.created_projects,
          teamMemberships: user._count.team_memberships,
          creditPurchases: user._count.credit_purchases,
        },
      };
    });

    return res.status(200).json({
      success: true,
      data: { users: mappedUsers },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch admin users',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}