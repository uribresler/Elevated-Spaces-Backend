import { Request, Response } from 'express';
import prisma from '../dbConnection';
import { createAdminEnterpriseCheckoutSession } from '../services/payment.service';

export async function getAdminUsersHandler(_req: Request, res: Response) {
  try {
    const users = await prisma.user.findMany({
      where: { deleted_at: null },
      select: {
        id: true,
        name: true,
        email: true,
        avatar_url: true,
        manual_avatar_url: true,
        auth_provider: true,
        demo_bonus_claimed_at: true,
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
        avatarUrl: user.manual_avatar_url ?? user.avatar_url,
        manualAvatarUrl: user.manual_avatar_url,
        googleAvatarUrl: user.avatar_url,
        authProvider: user.auth_provider, // LOCAL | GOOGLE | FACEBOOK | APPLE
        demoBonusClaimed: Boolean(user.demo_bonus_claimed_at),
        demoBonusClaimedAt: user.demo_bonus_claimed_at,
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

export async function getOwnedTeamsByEmailHandler(req: Request, res: Response) {
  try {
    const query = String(req.query.email || "").trim().toLowerCase();
    if (!query) {
      return res.status(400).json({
        success: false,
        message: 'Email is required',
      });
    }

    const owners = await prisma.user.findMany({
      where: {
        deleted_at: null,
        email: {
          contains: query,
          mode: 'insensitive',
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        owned_teams: {
          where: {
            deleted_at: null,
          },
          select: {
            id: true,
            name: true,
            description: true,
            wallet: true,
            created_at: true,
          },
          orderBy: {
            created_at: 'desc',
          },
        },
      },
      orderBy: {
        created_at: 'desc',
      },
      take: 25,
    });

    if (!owners.length) {
      return res.status(200).json({
        success: true,
        data: {
          query,
          owner: null,
          teams: [],
          ownerCandidates: [],
        },
      });
    }

    const exactOwner = owners.find((owner) => owner.email.toLowerCase() === query);
    const ownerWithTeams = exactOwner || owners.find((owner) => owner.owned_teams.length > 0) || owners[0];

    const ownerCandidates = owners.map((owner) => ({
      id: owner.id,
      name: owner.name,
      email: owner.email,
      teamsCount: owner.owned_teams.length,
    }));

    return res.status(200).json({
      success: true,
      data: {
        query,
        owner: {
          id: ownerWithTeams.id,
          name: ownerWithTeams.name,
          email: ownerWithTeams.email,
        },
        teams: ownerWithTeams.owned_teams,
        ownerCandidates,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch teams by owner email',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function createEnterprisePaymentLinkHandler(req: Request, res: Response) {
  try {
    const {
      ownerEmail,
      teamId,
      normalSeats,
      photographerSeats,
      credits,
      amountUsd,
      billingCycle,
      autoRenew,
    } = req.body || {};

    if (!ownerEmail || !teamId || !billingCycle) {
      return res.status(400).json({
        success: false,
        message: 'ownerEmail, teamId and billingCycle are required',
      });
    }

    if (billingCycle !== 'monthly' && billingCycle !== 'annual') {
      return res.status(400).json({
        success: false,
        message: 'billingCycle must be monthly or annual',
      });
    }

    const result = await createAdminEnterpriseCheckoutSession({
      ownerEmail: String(ownerEmail),
      teamId: String(teamId),
      normalSeats: Number(normalSeats || 0),
      photographerSeats: Number(photographerSeats || 0),
      credits: Number(credits || 0),
      amountUsd: Number(amountUsd || 0),
      billingCycle,
      autoRenew: Boolean(autoRenew !== false),
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to create enterprise payment link',
    });
  }
}