import { Router } from "express";
import { initGuest, getGuestStatus } from "../controllers/guest.controller";
import { optionalAuth } from "../middlewares/auth";

const router = Router();

// Initialize or hydrate demo tracking session (creates cookie, returns usage data)
// Works for both logged-in users and guests
router.post("/init", optionalAuth, initGuest);

// Get current demo tracking status (read-only)
// Works for both logged-in users and guests
router.get("/status", optionalAuth, getGuestStatus);

export default router;
