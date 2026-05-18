import { Router } from 'express';
import passport from 'passport';
import { requireAdmin } from '../middlewares/requireAdmin';
import { getAdminUsersHandler } from '../controllers/admin-users.controller';

const router = Router();

router.use(passport.authenticate('jwt', { session: false, failureMessage: true }));
router.use(requireAdmin);

router.get('/', getAdminUsersHandler);

export default router;