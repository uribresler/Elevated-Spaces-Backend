import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { uploadPhotographerDocument, uploadPhotographerOnboardingFiles } from "../middlewares/uploadPhotographerDocuments";
import {
  createBookingRequestPlaceholder,
  endBookingContract,
  getPhotographerApplicationById,
  getMyPhotographerProfile,
  listApprovedPhotographers,
  listBookingsForPhotographer,
  listMyBookingRequests,
  listPendingPhotographerApplications,
  reviewPhotographerApplication,
  setMyAvailabilityPlaceholder,
  submitPhotographerApplication,
  updateBookingStatusPlaceholder,
  withdrawBookingRequestByClient,
  updateMyPhotographerProfile,
  uploadPhotographerVerificationDocument,
  submitPhotographerResponse,
} from "../controllers/photographer.controller";
import {
  createPhotographerReview,
  getMyReviewEligibility,
  listPhotographerReviews,
} from "../controllers/reviews.controller";

const router = Router();

// Public marketplace listing (approved profiles only)
router.get("/directory", listApprovedPhotographers);

// Photographer onboarding and profile
router.post("/onboarding/apply", requireAuth, uploadPhotographerOnboardingFiles, submitPhotographerApplication);
router.post("/onboarding/document", requireAuth, uploadPhotographerDocument, uploadPhotographerVerificationDocument);
router.get("/me", requireAuth, getMyPhotographerProfile);
router.patch("/me", requireAuth, updateMyPhotographerProfile);
router.patch("/me/availability", requireAuth, setMyAvailabilityPlaceholder);
router.post("/me/response", requireAuth, submitPhotographerResponse);

// Admin approval flow
router.get("/admin/applications", requireAuth, listPendingPhotographerApplications);
router.get("/admin/applications/:profileId", requireAuth, getPhotographerApplicationById);
router.patch("/admin/applications/:profileId/review", requireAuth, reviewPhotographerApplication);

// Reviews — public list, auth-gated eligibility + submission
router.get("/:profileId/reviews", listPhotographerReviews);
router.get("/:profileId/reviews/eligibility", requireAuth, getMyReviewEligibility);
router.post("/:profileId/reviews", requireAuth, createPhotographerReview);

// Booking placeholders
router.post("/bookings/request", requireAuth, createBookingRequestPlaceholder);
router.get("/bookings/mine", requireAuth, listMyBookingRequests);
router.get("/bookings/received", requireAuth, listBookingsForPhotographer);
router.patch("/bookings/:bookingId/withdraw", requireAuth, withdrawBookingRequestByClient);
router.patch("/bookings/:bookingId/status", requireAuth, updateBookingStatusPlaceholder);
router.post("/bookings/:bookingId/end", requireAuth, endBookingContract);

export default router;
