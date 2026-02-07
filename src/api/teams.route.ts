import { Router } from "express";
import { acceptInvitation, createTeam, getMyTeams, removeMemberById, sendInvitation } from "../controllers/team.controller";
import { optionalAuth, requireAuth } from "../middlewares/auth";

const router = Router();

router.post('/create', requireAuth, createTeam)
router.post('/invite', requireAuth, sendInvitation)
router.post('/accept-invite', acceptInvitation)
router.get('/my-teams', requireAuth, getMyTeams)
router.delete('/remove-member/:id', requireAuth, removeMemberById)

export default router;