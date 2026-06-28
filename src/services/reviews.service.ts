import prisma from "../dbConnection";

type RatingEntry = { id: string; time: string; stars: number };
type ReviewEntry = { id: string; time: string; review: string };

export type EnrichedReview = {
  id: string;
  time: string;
  stars: number | null;
  review: string | null;
  reviewer: { id: string; name: string | null; avatar_url: string | null };
};

export type ReviewEligibility = {
  canReview: boolean;
  hasReviewed: boolean;
  reason?: "no_confirmed_booking" | "already_reviewed";
};

function asRatingArray(value: unknown): RatingEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (e): e is RatingEntry =>
      e && typeof e === "object" &&
      typeof (e as any).id === "string" &&
      typeof (e as any).time === "string" &&
      typeof (e as any).stars === "number"
  );
}

function asReviewArray(value: unknown): ReviewEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (e): e is ReviewEntry =>
      e && typeof e === "object" &&
      typeof (e as any).id === "string" &&
      typeof (e as any).time === "string" &&
      typeof (e as any).review === "string"
  );
}

export async function getReviewEligibility(
  clientUserId: string,
  profileId: string
): Promise<ReviewEligibility> {
  const profile = await prisma.photographer_profile.findUnique({
    where: { id: profileId },
    select: { ratings: true, reviews: true },
  });
  if (!profile) {
    return { canReview: false, hasReviewed: false, reason: "no_confirmed_booking" };
  }

  const ratings = asRatingArray(profile.ratings);
  const reviews = asReviewArray(profile.reviews);
  const hasReviewed =
    ratings.some((r) => r.id === clientUserId) ||
    reviews.some((r) => r.id === clientUserId);

  if (hasReviewed) {
    return { canReview: false, hasReviewed: true, reason: "already_reviewed" };
  }

  const confirmedBooking = await prisma.booking.findFirst({
    where: {
      user_id: clientUserId,
      photographer_id: profileId,
      status: { in: ["CONFIRMED", "COMPLETED"] },
    },
    select: { id: true },
  });

  if (!confirmedBooking) {
    return { canReview: false, hasReviewed: false, reason: "no_confirmed_booking" };
  }

  return { canReview: true, hasReviewed: false };
}

export async function submitReview(input: {
  clientUserId: string;
  profileId: string;
  stars?: number;
  review?: string;
}): Promise<{ success: true; eligibility: ReviewEligibility }> {
  const stars = typeof input.stars === "number" ? Math.round(input.stars) : undefined;
  const review = typeof input.review === "string" ? input.review.trim() : "";

  if ((stars === undefined || isNaN(stars)) && !review) {
    throw new Error("Provide a star rating or a written review");
  }
  if (stars !== undefined && (stars < 1 || stars > 5)) {
    throw new Error("Stars must be between 1 and 5");
  }
  if (review.length > 2000) {
    throw new Error("Review is too long (max 2000 chars)");
  }

  const eligibility = await getReviewEligibility(input.clientUserId, input.profileId);
  if (!eligibility.canReview) {
    throw new Error(
      eligibility.reason === "already_reviewed"
        ? "You have already submitted a review for this photographer"
        : "You can only review photographers you have a confirmed booking with"
    );
  }

  const profile = await prisma.photographer_profile.findUnique({
    where: { id: input.profileId },
    select: { ratings: true, reviews: true, rating_count: true },
  });
  if (!profile) throw new Error("Photographer not found");

  const ratings = asRatingArray(profile.ratings);
  const reviews = asReviewArray(profile.reviews);
  const time = new Date().toISOString();

  if (stars !== undefined) {
    ratings.push({ id: input.clientUserId, time, stars });
  }
  if (review) {
    reviews.push({ id: input.clientUserId, time, review });
  }

  const totalStars = ratings.reduce((sum, r) => sum + r.stars, 0);
  const ratingAverage = ratings.length > 0 ? totalStars / ratings.length : null;

  await prisma.photographer_profile.update({
    where: { id: input.profileId },
    data: {
      ratings: ratings as any,
      reviews: reviews as any,
      rating_average: ratingAverage,
      rating_count: ratings.length,
    },
  });

  return { success: true, eligibility: { canReview: false, hasReviewed: true, reason: "already_reviewed" } };
}

export async function getReviewsForPhotographer(profileId: string): Promise<{
  ratingAverage: number | null;
  ratingCount: number;
  reviews: EnrichedReview[];
}> {
  const profile = await prisma.photographer_profile.findUnique({
    where: { id: profileId },
    select: { ratings: true, reviews: true, rating_average: true, rating_count: true },
  });
  if (!profile) {
    return { ratingAverage: null, ratingCount: 0, reviews: [] };
  }

  const ratings = asRatingArray(profile.ratings);
  const reviews = asReviewArray(profile.reviews);

  const byClient = new Map<string, EnrichedReview>();
  for (const r of ratings) {
    byClient.set(r.id, {
      id: r.id,
      time: r.time,
      stars: r.stars,
      review: null,
      reviewer: { id: r.id, name: null, avatar_url: null },
    });
  }
  for (const r of reviews) {
    const existing = byClient.get(r.id);
    if (existing) {
      existing.review = r.review;
      if (new Date(r.time) > new Date(existing.time)) existing.time = r.time;
    } else {
      byClient.set(r.id, {
        id: r.id,
        time: r.time,
        stars: null,
        review: r.review,
        reviewer: { id: r.id, name: null, avatar_url: null },
      });
    }
  }

  const clientIds = Array.from(byClient.keys());
  if (clientIds.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: clientIds } },
      select: { id: true, name: true, avatar_url: true },
    });
    for (const u of users) {
      const entry = byClient.get(u.id);
      if (entry) entry.reviewer = { id: u.id, name: u.name, avatar_url: u.avatar_url };
    }
  }

  const enriched = Array.from(byClient.values()).sort(
    (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()
  );

  return {
    ratingAverage: profile.rating_average,
    ratingCount: profile.rating_count,
    reviews: enriched,
  };
}
