import { Router } from "express";
import { optionalAuth, requireAuth } from "../middlewares/auth";
import { getAdminOverview, trackPageview } from "../controllers/analytics.controller";

const router = Router();

router.post("/pageview", optionalAuth, trackPageview);
router.get("/admin/overview", requireAuth, getAdminOverview);

export default router;
