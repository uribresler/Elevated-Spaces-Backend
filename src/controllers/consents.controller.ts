import { Request, Response } from 'express';
import prisma from '../dbConnection';
import { loggingService } from '../services/logging.service';

export async function recordAiGenerationConsentHandler(req: Request, res: Response) {
  try {
    const user = (req as any).user;
    const {
      name,
      email,
      deviceId,
      timezone,
      language,
      acknowledgedAt,
    } = req.body || {};

    const acknowledgedDate = acknowledgedAt ? new Date(acknowledgedAt) : new Date();
    const safeAcknowledgedDate = Number.isNaN(acknowledgedDate.getTime()) ? new Date() : acknowledgedDate;

    const userRecord = user?.id
      ? await prisma.user.findUnique({
          where: { id: user.id },
          select: {
            id: true,
            ai_generation_consent_first_at: true,
          },
        })
      : email
        ? await prisma.user.findUnique({
            where: { email },
            select: {
              id: true,
              ai_generation_consent_first_at: true,
            },
          })
        : null;

    if (userRecord) {
      await prisma.user.update({
        where: { id: userRecord.id },
        data: {
          ai_generation_consent_first_at: userRecord.ai_generation_consent_first_at || safeAcknowledgedDate,
          ai_generation_consent_last_at: safeAcknowledgedDate,
        },
      });
    }

    await loggingService.logRequest({
      method: 'CONSENT',
      path: '/api/consents/ai-generation',
      statusCode: 200,
      userId: user?.id || undefined,
      userEmail: user?.email || email || undefined,
      userRole: user?.role?.[0] || user?.role || undefined,
      ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'],
      requestBody: {
        name,
        email,
        deviceId,
        timezone,
        language,
        acknowledgedAt,
      },
      metadata: {
        consentType: 'ai_generated_staging',
        acknowledgedAt: safeAcknowledgedDate.toISOString(),
        source: 'generate_modal',
      },
    });

    return res.status(200).json({
      success: true,
      message: 'AI staging consent recorded',
    });
  } catch (error) {
    console.error('[CONSENTS] Failed to record AI generation consent:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to record AI generation consent',
    });
  }
}