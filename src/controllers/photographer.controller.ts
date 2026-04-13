import { Request, Response } from "express";
import { booking_actor, booking_status } from "@prisma/client";
import prisma from "../dbConnection";
import { logger } from "../utils/logger";

type PhotographerApplicationStatus =
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "NEEDS_MORE_INFO"
  | "INTERVIEW_SCHEDULED"
  | "APPROVED"
  | "REJECTED";

async function getRoleNamesForUser(userId: string): Promise<string[]> {
  const rows = await prisma.user_roles.findMany({
    where: { user_id: userId },
    include: { role: true },
  });
  return rows.map((row) => row.role.name.toUpperCase());
}

async function isAdminUser(userId: string): Promise<boolean> {
  const roles = await getRoleNamesForUser(userId);
  return roles.includes("ADMIN");
}

async function ensurePhotographerRole(userId: string): Promise<void> {
  let role = await prisma.roles.findUnique({ where: { name: "PHOTOGRAPHER" } });

  if (!role) {
    role = await prisma.roles.create({
      data: {
        name: "PHOTOGRAPHER",
        description: "Marketplace photographer role",
      },
    });
  }

  const existing = await prisma.user_roles.findFirst({
    where: {
      user_id: userId,
      role_id: role.id,
    },
  });

  if (!existing) {
    await prisma.user_roles.create({
      data: {
        user_id: userId,
        role_id: role.id,
      },
    });
  }
}

function normalizeApplicationStatus(status: unknown): PhotographerApplicationStatus {
  const value = String(status || "").trim().toUpperCase();
  if (value === "UNDER_REVIEW") return "UNDER_REVIEW";
  if (value === "NEEDS_MORE_INFO") return "NEEDS_MORE_INFO";
  if (value === "INTERVIEW_SCHEDULED") return "INTERVIEW_SCHEDULED";
  if (value === "APPROVED") return "APPROVED";
  if (value === "REJECTED") return "REJECTED";
  return "SUBMITTED";
}

function getHostUrl(req: Request): string {
  const host = req.get("host") || "localhost:3003";
  return `${req.protocol}://${host}`;
}

function normalizeAttachments(rawAttachments: unknown): Array<{ name: string; type: string; dataUrl: string }> {
  const parsedAttachments = Array.isArray(rawAttachments)
    ? rawAttachments
    : typeof rawAttachments === "string"
      ? JSON.parse(rawAttachments)
      : [];

  return Array.isArray(parsedAttachments)
    ? parsedAttachments.map((attachment) => ({
        name: typeof attachment?.name === "string" ? attachment.name : "attachment",
        type: typeof attachment?.type === "string" ? attachment.type : "unknown",
        dataUrl: typeof attachment?.dataUrl === "string" ? attachment.dataUrl : "",
      }))
    : [];
}

export async function submitPhotographerApplication(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const bio = typeof req.body.bio === "string" ? req.body.bio.trim() : "";
    const availability = typeof req.body.availability === "string" ? req.body.availability.trim() : null;
    const photographerType = typeof req.body.photographerType === "string" ? req.body.photographerType.trim() : null;
    const experienceLevel = typeof req.body.experienceLevel === "string" ? req.body.experienceLevel.trim() : null;
    const serviceArea = typeof req.body.serviceArea === "string" ? req.body.serviceArea.trim() : null;
    const portfolioUrl = typeof req.body.portfolioUrl === "string" ? req.body.portfolioUrl.trim() : null;
    const instagramUrl = typeof req.body.instagramUrl === "string" ? req.body.instagramUrl.trim() : null;
    const websiteUrl = typeof req.body.websiteUrl === "string" ? req.body.websiteUrl.trim() : null;
    const yearsExperience = typeof req.body.yearsExperience === "string" ? req.body.yearsExperience.trim() : null;
    const gearDescription = typeof req.body.gearDescription === "string" ? req.body.gearDescription.trim() : null;
    const businessName = typeof req.body.businessName === "string" ? req.body.businessName.trim() : null;
    const shortPitch = typeof req.body.shortPitch === "string" ? req.body.shortPitch.trim() : null;
    const documentUrl = req.file ? `${req.protocol}://${req.get("host") || "localhost:3003"}/uploads/documents/${req.file.filename}` : (typeof req.body.documentsUrl === "string" ? req.body.documentsUrl.trim() : null);

    if (!bio) {
      res.status(400).json({ success: false, message: "Bio is required" });
      return;
    }

    const profile = await prisma.photographer_profile.upsert({
      where: { user_id: userId },
      update: {
        bio,
        availability,
        photographer_type: photographerType,
        years_experience: yearsExperience,
        service_area: serviceArea,
        portfolio_url: portfolioUrl,
        instagram_url: instagramUrl,
        website_url: websiteUrl,
        gear_description: gearDescription,
        business_name: businessName,
        short_pitch: shortPitch,
        approved: false,
        application_status: "SUBMITTED",
        documents_url: documentUrl || undefined,
      },
      create: {
        user_id: userId,
        bio,
        availability,
        photographer_type: photographerType,
        years_experience: yearsExperience,
        service_area: serviceArea,
        portfolio_url: portfolioUrl,
        instagram_url: instagramUrl,
        website_url: websiteUrl,
        gear_description: gearDescription,
        business_name: businessName,
        short_pitch: shortPitch,
        approved: false,
        application_status: "SUBMITTED",
        documents_url: documentUrl || undefined,
      },
    });

    await ensurePhotographerRole(userId);

    res.status(200).json({
      success: true,
      message: "Photographer application submitted for admin review",
      data: {
        profileId: profile.id,
        status: (profile as any).application_status ?? (profile.approved ? "APPROVED" : "SUBMITTED"),
        approved: profile.approved,
      },
    });
  } catch (error) {
    logger(`[PHOTOGRAPHER] submit application failed: ${String(error)}`);
    res.status(500).json({ success: false, message: "Failed to submit application" });
  }
}

export async function uploadPhotographerVerificationDocument(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    if (!req.file) {
      res.status(400).json({ success: false, message: "Verification document is required" });
      return;
    }

    const url = `${getHostUrl(req)}/uploads/documents/${req.file.filename}`;

    const profile = await prisma.photographer_profile.upsert({
      where: { user_id: userId },
      update: {
        documents_url: url,
        approved: false,
        application_status: "SUBMITTED",
      },
      create: {
        user_id: userId,
        documents_url: url,
        approved: false,
        application_status: "SUBMITTED",
      },
    });

    await ensurePhotographerRole(userId);

    res.status(200).json({
      success: true,
      message: "Verification document uploaded",
      data: {
        profileId: profile.id,
        documentsUrl: profile.documents_url,
      },
    });
  } catch (error) {
    logger(`[PHOTOGRAPHER] upload document failed: ${String(error)}`);
    res.status(500).json({ success: false, message: "Failed to upload document" });
  }
}

export async function getMyPhotographerProfile(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const profile = await prisma.photographer_profile.findUnique({
      where: { user_id: userId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar_url: true,
          },
        },
      },
    });

    if (!profile) {
      res.status(404).json({ success: false, message: "Photographer profile not found" });
      return;
    }

    res.status(200).json({ success: true, data: profile });
  } catch (error) {
    logger(`[PHOTOGRAPHER] get my profile failed: ${String(error)}`);
    res.status(500).json({ success: false, message: "Failed to fetch profile" });
  }
}

export async function updateMyPhotographerProfile(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const updates: { bio?: string; availability?: string | null } = {};

    if (typeof req.body.bio === "string") {
      const bio = req.body.bio.trim();
      if (!bio) {
        res.status(400).json({ success: false, message: "Bio cannot be empty" });
        return;
      }
      updates.bio = bio;
    }

    if (typeof req.body.availability === "string") {
      updates.availability = req.body.availability.trim();
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ success: false, message: "No profile fields provided" });
      return;
    }

    const profile = await prisma.photographer_profile.findUnique({ where: { user_id: userId } });
    if (!profile) {
      res.status(404).json({ success: false, message: "Photographer profile not found" });
      return;
    }

    const updated = await prisma.photographer_profile.update({
      where: { user_id: userId },
      data: updates,
    });

    res.status(200).json({
      success: true,
      message: "Photographer profile updated",
      data: updated,
    });
  } catch (error) {
    logger(`[PHOTOGRAPHER] update my profile failed: ${String(error)}`);
    res.status(500).json({ success: false, message: "Failed to update profile" });
  }
}

export async function setMyAvailabilityPlaceholder(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const availability = typeof req.body.availability === "string" ? req.body.availability.trim() : "";
    if (!availability) {
      res.status(400).json({ success: false, message: "Availability text is required" });
      return;
    }

    const profile = await prisma.photographer_profile.findUnique({ where: { user_id: userId } });
    if (!profile) {
      res.status(404).json({ success: false, message: "Photographer profile not found" });
      return;
    }

    const updated = await prisma.photographer_profile.update({
      where: { user_id: userId },
      data: { availability },
    });

    res.status(200).json({
      success: true,
      message: "Availability placeholder updated",
      data: {
        profileId: updated.id,
        availability: updated.availability,
      },
    });
  } catch (error) {
    logger(`[PHOTOGRAPHER] set availability failed: ${String(error)}`);
    res.status(500).json({ success: false, message: "Failed to update availability" });
  }
}

export async function listPendingPhotographerApplications(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const admin = await isAdminUser(userId);
    if (!admin) {
      res.status(403).json({ success: false, message: "Admin access required" });
      return;
    }

    const rawStatus = typeof req.query.status === "string" ? req.query.status.trim().toUpperCase() : "";
    const selectedStatus = rawStatus ? normalizeApplicationStatus(rawStatus) : null;

    const pending = await prisma.photographer_profile.findMany({
      where: (selectedStatus
        ? {
            application_status: selectedStatus,
          }
        : undefined) as any,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            created_at: true,
          },
        },
      },
      orderBy: { created_at: "desc" },
    });

    res.status(200).json({
      success: true,
      data: {
        total: pending.length,
        applications: pending,
      },
    });
  } catch (error) {
    logger(`[PHOTOGRAPHER] list pending applications failed: ${String(error)}`);
    res.status(500).json({ success: false, message: "Failed to list applications" });
  }
}

export async function getPhotographerApplicationById(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const admin = await isAdminUser(userId);
    if (!admin) {
      res.status(403).json({ success: false, message: "Admin access required" });
      return;
    }

    const profileId = req.params.profileId;
    const application = await prisma.photographer_profile.findUnique({
      where: { id: profileId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            created_at: true,
          },
        },
      },
    });

    if (!application) {
      res.status(404).json({ success: false, message: "Photographer application not found" });
      return;
    }

    res.status(200).json({
      success: true,
      data: application,
    });
  } catch (error) {
    logger(`[PHOTOGRAPHER] get application details failed: ${String(error)}`);
    res.status(500).json({ success: false, message: "Failed to load application" });
  }
}

export async function reviewPhotographerApplication(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const admin = await isAdminUser(userId);
    if (!admin) {
      res.status(403).json({ success: false, message: "Admin access required" });
      return;
    }

    const profileId = req.params.profileId;
    const status = normalizeApplicationStatus(req.body.status ?? req.body.decision);

    if (!status) {
      res.status(400).json({ success: false, message: "Invalid application status" });
      return;
    }

    const profile = await prisma.photographer_profile.findUnique({ where: { id: profileId } });
    if (!profile) {
      res.status(404).json({ success: false, message: "Photographer application not found" });
      return;
    }

    const approved = status === "APPROVED";

    if (status === "NEEDS_MORE_INFO") {
      const adminFeedback = typeof req.body.adminFeedback === "string" ? req.body.adminFeedback.trim() : "";
      if (!adminFeedback) {
        res.status(400).json({ success: false, message: "Admin feedback is required when status is 'Needs More Info'" });
        return;
      }
    }

    const updateData: Record<string, unknown> = {
      approved,
      application_status: status,
      has_new_photographer_response: false,
    };

    if (status === "NEEDS_MORE_INFO") {
      updateData.admin_feedback = typeof req.body.adminFeedback === "string" ? req.body.adminFeedback.trim() : "";
      updateData.feedback_provided_at = new Date();
    }

    if (status === "REJECTED") {
      updateData.submission_count = (profile.submission_count || 0) + 1;
    }

    const updated = await prisma.photographer_profile.update({
      where: { id: profileId },
      data: updateData as any,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });

    if (approved) {
      await ensurePhotographerRole(updated.user_id);
    }

    res.status(200).json({
      success: true,
      message: `Photographer application status updated to ${status}`,
      data: updated,
    });
  } catch (error) {
    logger(`[PHOTOGRAPHER] review application failed: ${String(error)}`);
    res.status(500).json({ success: false, message: "Failed to review application" });
  }
}

export async function listApprovedPhotographers(req: Request, res: Response): Promise<void> {
  try {
    const photographers = await prisma.photographer_profile.findMany({
      where: { approved: true },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar_url: true,
          },
        },
      },
      orderBy: { updated_at: "desc" },
    });

    res.status(200).json({
      success: true,
      data: {
        total: photographers.length,
        photographers,
      },
    });
  } catch (error) {
    logger(`[PHOTOGRAPHER] list approved photographers failed: ${String(error)}`);
    res.status(500).json({ success: false, message: "Failed to list photographers" });
  }
}

export async function createBookingRequestPlaceholder(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const photographerId = typeof req.body.photographerId === "string" ? req.body.photographerId.trim() : "";
    const dateInput = typeof req.body.date === "string" ? req.body.date.trim() : "";
    const clientNoteHtml = typeof req.body.clientNoteHtml === "string" ? req.body.clientNoteHtml.trim() : "";
    const clientNoteAttachments = normalizeAttachments(req.body.clientNoteAttachments);

    if (!photographerId || !dateInput) {
      res.status(400).json({
        success: false,
        message: "photographerId and date are required",
      });
      return;
    }

    const date = new Date(dateInput);
    if (Number.isNaN(date.getTime())) {
      res.status(400).json({ success: false, message: "Invalid booking date" });
      return;
    }

    const photographer = await prisma.photographer_profile.findUnique({
      where: { id: photographerId },
      select: { id: true, approved: true, user_id: true },
    });

    if (!photographer || !photographer.approved) {
      res.status(404).json({ success: false, message: "Approved photographer not found" });
      return;
    }

    if (photographer.user_id === userId) {
      res.status(400).json({ success: false, message: "You cannot book yourself" });
      return;
    }

    const existingPending = await prisma.booking.findFirst({
      where: {
        user_id: userId,
        photographer_id: photographerId,
        status: booking_status.PENDING,
      },
      select: {
        id: true,
      },
    });

    if (existingPending) {
      res.status(409).json({
        success: false,
        message: "You already have a pending request with this photographer. Wait for confirm/decline before sending another.",
      });
      return;
    }

    const booking = await prisma.booking.create({
      data: {
        user_id: userId,
        photographer_id: photographerId,
        date,
        status: booking_status.PENDING,
        client_note_html: clientNoteHtml || null,
        client_note_attachments: clientNoteAttachments,
      },
      include: {
        photographer: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
      },
    });

    res.status(201).json({
      success: true,
      message: "Booking request created (placeholder flow)",
      data: booking,
    });
  } catch (error) {
    logger(`[PHOTOGRAPHER] create booking placeholder failed: ${String(error)}`);
    res.status(500).json({ success: false, message: "Failed to create booking request" });
  }
}

export async function withdrawBookingRequestByClient(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const bookingId = req.params.bookingId;
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });

    if (!booking || booking.user_id !== userId) {
      res.status(404).json({ success: false, message: "Booking not found for this client" });
      return;
    }

    if (booking.status !== booking_status.PENDING) {
      res.status(400).json({ success: false, message: "Only pending requests can be withdrawn" });
      return;
    }

    const updated = await prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: booking_status.CANCELLED,
        cancelled_by: booking_actor.CLIENT,
        status_updated_at: new Date(),
      },
    });

    res.status(200).json({
      success: true,
      message: "Booking request withdrawn",
      data: updated,
    });
  } catch (error) {
    logger(`[PHOTOGRAPHER] withdraw booking request failed: ${String(error)}`);
    res.status(500).json({ success: false, message: "Failed to withdraw booking request" });
  }
}

export async function listMyBookingRequests(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const bookings = await prisma.booking.findMany({
      where: { user_id: userId },
      include: {
        photographer: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
      },
      orderBy: { created_at: "desc" },
    });

    res.status(200).json({ success: true, data: bookings });
  } catch (error) {
    logger(`[PHOTOGRAPHER] list my bookings failed: ${String(error)}`);
    res.status(500).json({ success: false, message: "Failed to fetch bookings" });
  }
}

export async function listBookingsForPhotographer(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const profile = await prisma.photographer_profile.findUnique({ where: { user_id: userId } });
    if (!profile) {
      res.status(404).json({ success: false, message: "Photographer profile not found" });
      return;
    }

    const bookings = await prisma.booking.findMany({
      where: { photographer_id: profile.id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: { created_at: "desc" },
    });

    res.status(200).json({ success: true, data: bookings });
  } catch (error) {
    logger(`[PHOTOGRAPHER] list photographer bookings failed: ${String(error)}`);
    res.status(500).json({ success: false, message: "Failed to fetch photographer bookings" });
  }
}

export async function updateBookingStatusPlaceholder(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const bookingId = req.params.bookingId;
    const statusInput = typeof req.body.status === "string" ? req.body.status.trim().toUpperCase() : "";
    const photographerNoteHtml = typeof req.body.photographerNoteHtml === "string" ? req.body.photographerNoteHtml.trim() : "";
    const photographerNoteAttachments = normalizeAttachments(req.body.photographerNoteAttachments);

    if (statusInput !== booking_status.CONFIRMED && statusInput !== booking_status.CANCELLED) {
      res.status(400).json({ success: false, message: "status must be CONFIRMED or CANCELLED" });
      return;
    }

    const profile = await prisma.photographer_profile.findUnique({ where: { user_id: userId } });
    if (!profile) {
      res.status(404).json({ success: false, message: "Photographer profile not found" });
      return;
    }

    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking || booking.photographer_id !== profile.id) {
      res.status(404).json({ success: false, message: "Booking not found for this photographer" });
      return;
    }

    const updated = await prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: statusInput as booking_status,
        photographer_note_html: photographerNoteHtml || null,
        photographer_note_attachments: photographerNoteAttachments,
        cancelled_by: statusInput === booking_status.CANCELLED ? booking_actor.PHOTOGRAPHER : null,
        status_updated_at: new Date(),
      },
    });

    res.status(200).json({
      success: true,
      message: "Booking status updated (placeholder flow)",
      data: updated,
    });
  } catch (error) {
    logger(`[PHOTOGRAPHER] update booking status failed: ${String(error)}`);
    res.status(500).json({ success: false, message: "Failed to update booking status" });
  }
}

export async function submitPhotographerResponse(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const profile = await prisma.photographer_profile.findUnique({ where: { user_id: userId } });
    if (!profile) {
      res.status(404).json({ success: false, message: "Photographer profile not found" });
      return;
    }

    // Only allow response if status is NEEDS_MORE_INFO
    if (profile.application_status !== "NEEDS_MORE_INFO") {
      res.status(400).json({ success: false, message: "Profile is not in NEEDS_MORE_INFO status" });
      return;
    }

    const responseContent = typeof req.body.responseContent === "string" ? req.body.responseContent.trim() : "";
    if (!responseContent) {
      res.status(400).json({ success: false, message: "Response content is required" });
      return;
    }

    const rawAttachments = req.body.attachments;
    const parsedAttachments = Array.isArray(rawAttachments)
      ? rawAttachments
      : typeof rawAttachments === "string"
        ? JSON.parse(rawAttachments)
        : [];

    const normalizedAttachments = Array.isArray(parsedAttachments)
      ? parsedAttachments.map((attachment) => ({
          name: typeof attachment?.name === "string" ? attachment.name : "attachment",
          type: typeof attachment?.type === "string" ? attachment.type : "unknown",
          dataUrl: typeof attachment?.dataUrl === "string" ? attachment.dataUrl : "",
        }))
      : [];

    const existingResponses = Array.isArray(profile.photographer_responses) ? profile.photographer_responses : [];
    const newResponses = [
      ...existingResponses,
      {
        contentHtml: responseContent,
        attachments: normalizedAttachments,
        submittedAt: new Date().toISOString(),
      },
    ];

    const updated = await prisma.photographer_profile.update({
      where: { user_id: userId },
      data: {
        photographer_responses: newResponses,
        has_new_photographer_response: true,
        application_status: "SUBMITTED",
      },
    });

    res.status(200).json({
      success: true,
      message: "Response submitted successfully. Admin will review your submission.",
      data: {
        profileId: updated.id,
        status: updated.application_status,
        responseCount: newResponses.length,
      },
    });
  } catch (error) {
    logger(`[PHOTOGRAPHER] submit response failed: ${String(error)}`);
    res.status(500).json({ success: false, message: "Failed to submit response" });
  }
}
