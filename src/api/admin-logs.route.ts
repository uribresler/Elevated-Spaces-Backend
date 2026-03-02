import { Router } from 'express';
import passport from 'passport';
import { 
  getRequestLogsHandler, 
  getPaymentLogsHandler, 
  getMultiImageLogsHandler,
  getAvailableMonthsHandler,
  getLogStatsHandler 
} from '../controllers/admin-logs.controller';
import { requireAdmin } from '../middlewares/requireAdmin';

const router = Router();

// Protect all admin log routes
router.use(passport.authenticate('jwt', { session: false }));
router.use(requireAdmin);

// Get available months for logs
router.get('/months', getAvailableMonthsHandler);

// Get log statistics
router.get('/stats', getLogStatsHandler);

// Get request logs
router.get('/requests', getRequestLogsHandler);

// Get payment logs
router.get('/payments', getPaymentLogsHandler);

// Get multi-image logs
router.get('/multi-image', getMultiImageLogsHandler);

export default router;
