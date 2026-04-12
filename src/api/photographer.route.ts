import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { uploadPhotographerDocument } from "../middlewares/uploadPhotographerDocuments";
import {
  createBookingRequestPlaceholder,
  getMyPhotographerProfile,
  listApprovedPhotographers,
  listBookingsForPhotographer,
  listMyBookingRequests,
  listPendingPhotographerApplications,
  reviewPhotographerApplication,
  setMyAvailabilityPlaceholder,
  submitPhotographerApplication,
  updateBookingStatusPlaceholder,
  updateMyPhotographerProfile,
  uploadPhotographerVerificationDocument,
} from "../controllers/photographer.controller";

const router = Router();

// Public marketplace listing (approved profiles only)
router.get("/directory", listApprovedPhotographers);

// Photographer onboarding and profile
router.post("/onboarding/apply", requireAuth, uploadPhotographerDocument, submitPhotographerApplication);
router.post("/onboarding/document", requireAuth, uploadPhotographerDocument, uploadPhotographerVerificationDocument);
router.get("/me", requireAuth, getMyPhotographerProfile);
router.patch("/me", requireAuth, updateMyPhotographerProfile);
router.patch("/me/availability", requireAuth, setMyAvailabilityPlaceholder);

// Admin approval flow
router.get("/admin/applications", requireAuth, listPendingPhotographerApplications);
router.patch("/admin/applications/:profileId/review", requireAuth, reviewPhotographerApplication);

// Booking placeholders
router.post("/bookings/request", requireAuth, createBookingRequestPlaceholder);
router.get("/bookings/mine", requireAuth, listMyBookingRequests);
router.get("/bookings/received", requireAuth, listBookingsForPhotographer);
router.patch("/bookings/:bookingId/status", requireAuth, updateBookingStatusPlaceholder);

export default router;
