import { Request, Response } from "express";
import { logger } from "../utils/logger";
import {
  getReviewEligibility,
  getReviewsForPhotographer,
  submitReview,
} from "../services/reviews.service";

export async function listPhotographerReviews(req: Request, res: Response): Promise<void> {
  try {
    const profileId = req.params.profileId;
    if (!profileId) {
      res.status(400).json({ success: false, message: "profileId is required" });
      return;
    }
    const data = await getReviewsForPhotographer(profileId);
    res.status(200).json({ success: true, data });
  } catch (error) {
    logger(`[REVIEWS] list failed: ${error instanceof Error ? error.message : String(error)}`);
    res.status(500).json({ success: false, message: "Failed to load reviews" });
  }
}

export async function getMyReviewEligibility(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }
    const profileId = req.params.profileId;
    if (!profileId) {
      res.status(400).json({ success: false, message: "profileId is required" });
      return;
    }
    const eligibility = await getReviewEligibility(userId, profileId);
    res.status(200).json({ success: true, data: eligibility });
  } catch (error) {
    logger(`[REVIEWS] eligibility failed: ${error instanceof Error ? error.message : String(error)}`);
    res.status(500).json({ success: false, message: "Failed to check eligibility" });
  }
}

export async function createPhotographerReview(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }
    const profileId = req.params.profileId;
    if (!profileId) {
      res.status(400).json({ success: false, message: "profileId is required" });
      return;
    }

    const stars = typeof req.body?.stars === "number" ? req.body.stars : undefined;
    const review = typeof req.body?.review === "string" ? req.body.review : undefined;

    const result = await submitReview({
      clientUserId: userId,
      profileId,
      stars,
      review,
    });
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to submit review";
    logger(`[REVIEWS] submit failed: ${message}`);
    res.status(400).json({ success: false, message });
  }
}
