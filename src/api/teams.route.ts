import { Router } from "express";
import { acceptInvitation, createTeam, getMyTeams, getMyTeamsWithCredits, getTeamsByUserId, reinviteInvitation, removeMemberById, sendInvitation, updateTeamMemberRole } from "../controllers/team.controller";
import { optionalAuth, requireAuth } from "../middlewares/auth";

const router = Router();

router.post('/create', requireAuth, createTeam)
router.post('/invite', requireAuth, sendInvitation)
router.post('/reinvite', requireAuth, reinviteInvitation)
router.post('/accept-invite', acceptInvitation)
router.get('/my-teams', requireAuth, getMyTeams)
router.get('/my-credits', requireAuth, getMyTeamsWithCredits)
router.delete('/remove-member/:id', requireAuth, removeMemberById)
router.patch('/member-role', requireAuth, updateTeamMemberRole)
router.get('/my/:id', requireAuth, getTeamsByUserId)

export default router;