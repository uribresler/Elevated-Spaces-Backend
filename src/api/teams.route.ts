import { Router } from "express";
import { acceptInvitation, createTeam, getMyTeams, getMyTeamsWithCredits, getTeamsByUserId, reinviteInvitation, removeMemberById, sendInvitation, updateTeamMemberRole, leaveTeam, transferCreditsBeforeLeaving, completeLeaveTeam, deleteTeam, cancelInvitation, updateTeamName } from "../controllers/team.controller";
import { optionalAuth, requireAuth } from "../middlewares/auth";

const router = Router();

router.post('/create', requireAuth, createTeam)
router.patch('/update-name', requireAuth, updateTeamName)
router.post('/invite', requireAuth, sendInvitation)
router.post('/reinvite', requireAuth, reinviteInvitation)
router.post('/accept-invite', acceptInvitation)
router.get('/my-teams', requireAuth, getMyTeams)
router.get('/my-credits', requireAuth, getMyTeamsWithCredits)
router.delete('/remove-member/:id', requireAuth, removeMemberById)
router.delete('/cancel-invite/:id', requireAuth, cancelInvitation)
router.patch('/member-role', requireAuth, updateTeamMemberRole)
router.post('/leave', requireAuth, leaveTeam)
router.post('/transfer-credits-before-leave', requireAuth, transferCreditsBeforeLeaving)
router.post('/complete-leave', requireAuth, completeLeaveTeam)
router.post('/delete', requireAuth, deleteTeam)
router.get('/my/:id', requireAuth, getTeamsByUserId)

export default router;