import { Router } from 'express';
import { optionalAuth } from '../middlewares/auth';
import { recordAiGenerationConsentHandler } from '../controllers/consents.controller';

const router = Router();

router.post('/ai-generation', optionalAuth, recordAiGenerationConsentHandler);

export default router;