import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import {
  listPendingDeletions,
  requestAccountDeletion,
  revertAccountDeletion,
  verifyAccountDeletion,
} from "../controllers/accountDeletion.controller";

const router = Router();

router.post("/deletion/request", requireAuth, requestAccountDeletion);
router.post("/deletion/verify", requireAuth, verifyAccountDeletion);
router.get("/deletion/admin/pending", requireAuth, listPendingDeletions);
router.post("/deletion/admin/:userId/revert", requireAuth, revertAccountDeletion);

export default router;
