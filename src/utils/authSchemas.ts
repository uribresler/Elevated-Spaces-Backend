import { z } from 'zod';

export const registrationAgreementsSchema = z.object({
  acceptTermsAndPrivacy: z.boolean(),
  promotionalCommunicationsOptIn: z.boolean().optional(),
  // Legacy fields — accepted but no longer required (kept for backwards compatibility)
  confirmAgeAndCapacity: z.boolean().optional(),
  confirmUploadRights: z.boolean().optional(),
  acknowledgeAiLimitations: z.boolean().optional(),
  acknowledgeCreditsPolicy: z.boolean().optional(),
  acceptArbitrationWaiver: z.boolean().optional(),
  acknowledgePhotographerDisclaimer: z.boolean().optional(),
}).superRefine((value, context) => {
  if (!value.acceptTermsAndPrivacy) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['acceptTermsAndPrivacy'],
      message: 'acceptTermsAndPrivacy must be accepted',
    });
  }
});

export const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required').optional(),
  registrationAgreements: registrationAgreementsSchema,
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});
