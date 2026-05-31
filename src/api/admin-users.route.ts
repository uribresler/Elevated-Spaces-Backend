import { Router } from 'express';
import passport from 'passport';
import { requireAdmin } from '../middlewares/requireAdmin';
import { createEnterprisePaymentLinkHandler, getAdminUsersHandler, getOwnedTeamsByEmailHandler } from '../controllers/admin-users.controller';

const router = Router();

router.use(passport.authenticate('jwt', { session: false, failureMessage: true }));
router.use(requireAdmin);

router.get('/', getAdminUsersHandler);
router.get('/owned-teams', getOwnedTeamsByEmailHandler);
router.post('/enterprise-payment-link', createEnterprisePaymentLinkHandler);

export default router;