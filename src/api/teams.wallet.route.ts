import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { transferPersonalCreditsToTeam } from "../controllers/team.credit.controller";

const router = Router();

// ...existing routes...

// Transfer credits from personal wallet to team wallet (owner only)
router.post('/transfer-credits-to-team', requireAuth, transferPersonalCreditsToTeam);

export default router;
