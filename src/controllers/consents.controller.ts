import { Request, Response } from 'express';
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
        acknowledgedAt: acknowledgedAt || new Date().toISOString(),
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