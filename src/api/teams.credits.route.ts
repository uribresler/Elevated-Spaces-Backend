import { Router } from "express";
import { optionalAuth, requireAuth } from "../middlewares/auth";
import { allocateCreditToMember, transferPersonalCreditsToTeam } from "../controllers/team.credit.controller";

const router = Router();

// routes related team credits
router.patch('/allocate-credit/member/:id', requireAuth, allocateCreditToMember)
// Transfer credits from personal wallet to team wallet (owner only)
// (This route is also exported in teams.wallet.route.ts for modularity)
router.post('/transfer-credits-to-team', requireAuth, transferPersonalCreditsToTeam)

export default router