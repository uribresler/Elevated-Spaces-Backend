import { Router } from "express";
import { optionalAuth, requireAuth } from "../middlewares/auth";
import { allocateCreditToMember } from "../controllers/team.credit.controller";

const router = Router();

// routes related team credits
router.patch('/allocate-credit/member/:id', requireAuth, allocateCreditToMember)

export default router