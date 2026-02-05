import { Router } from 'express';
import { healthCheck, testSMTP } from '../controllers/health.controller';

const router = Router();

router.get('/health', healthCheck);
router.get('/test-smtp', testSMTP);

export default router;
