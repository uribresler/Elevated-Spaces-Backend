import { Router } from 'express';
import { healthCheck } from '../controllers/health.controller';
import { authorizeRoles } from '../middlewares/rbac';

const router = Router();

router.get('/health', authorizeRoles('admin', 'user', 'photographer'), healthCheck);

export default router;
