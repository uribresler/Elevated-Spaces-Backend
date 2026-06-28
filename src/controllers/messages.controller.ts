import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import prisma from "../dbConnection";
import { logger } from "../utils/logger";
import { pushSseEvent, registerSseClient } from "../utils/messagesSse";
import { getOrCreateConversation, sortUsers } from "../utils/directConversation";

function attachmentPayload(req: Request) {
  const host = req.get("host") || "localhost:3003";
  const base = `${req.protocol}://${host}`;
  const files = Array.isArray(req.files) ? (req.files as Express.Multer.File[]) : [];

  return files.map((file) => ({
    name: file.originalname,
    type: file.mimetype,
    size: file.size,
    url: `${base}/uploads/messages/${file.filename}`,
  }));
}

export async function listConversations(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const conversations = await prisma.direct_conversation.findMany({
      where: {
        OR: [{ user_a_id: userId }, { user_b_id: userId }],
      },
      include: {
        user_a: { select: { id: true, name: true, email: true, avatar_url: true } },
        user_b: { select: { id: true, name: true, email: true, avatar_url: true } },
        messages: {
          orderBy: { created_at: "desc" },
          take: 1,
        },
      },
      orderBy: { updated_at: "desc" },
    });

    const mapped = conversations.map((conversation) => {
      const peer = conversation.user_a_id === userId ? conversation.user_b : conversation.user_a;
      const lastMessage = conversation.messages[0] || null;

      return {
        id: conversation.id,
        peer,
        lastMessage,
        updatedAt: conversation.updated_at,
      };
    });

    res.status(200).json({ success: true, data: mapped });
  } catch (error) {
    logger(`[MESSAGES] list conversations failed: ${String(error)}`);
    res.status(500).json({ success: false, message: "Failed to load conversations" });
  }
}

export async function getConversationMessages(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const peerUserId = typeof req.params.peerUserId === "string" ? req.params.peerUserId.trim() : "";
    if (!peerUserId) {
      res.status(400).json({ success: false, message: "peerUserId is required" });
      return;
    }

    if (peerUserId === userId) {
      res.status(400).json({ success: false, message: "Cannot open self conversation" });
      return;
    }

    const peer = await prisma.user.findUnique({
      where: { id: peerUserId },
      select: { id: true, name: true, email: true, avatar_url: true },
    });

    if (!peer) {
      res.status(404).json({ success: false, message: "Peer user not found" });
      return;
    }

    const conversation = await getOrCreateConversation(userId, peerUserId);

    const messages = await prisma.direct_message.findMany({
      where: { conversation_id: conversation.id },
      orderBy: { created_at: "asc" },
    });

    await prisma.direct_message.updateMany({
      where: {
        conversation_id: conversation.id,
        receiver_id: userId,
        read_at: null,
      },
      data: {
        read_at: new Date(),
      },
    });

    res.status(200).json({
      success: true,
      data: {
        conversationId: conversation.id,
        peer,
        messages,
      },
    });
  } catch (error) {
    logger(`[MESSAGES] get conversation failed: ${String(error)}`);
    res.status(500).json({ success: false, message: "Failed to load conversation" });
  }
}

export async function sendMessage(req: Request, res: Response): Promise<void> {
  try {
    const senderId = req.user?.id;
    if (!senderId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const peerUserId = typeof req.body.peerUserId === "string" ? req.body.peerUserId.trim() : "";
    const body = typeof req.body.body === "string" ? req.body.body.trim() : "";
    const attachments = attachmentPayload(req);

    if (!peerUserId) {
      res.status(400).json({ success: false, message: "peerUserId is required" });
      return;
    }

    if (peerUserId === senderId) {
      res.status(400).json({ success: false, message: "Cannot message yourself" });
      return;
    }

    if (!body && attachments.length === 0) {
      res.status(400).json({ success: false, message: "Message text or attachments are required" });
      return;
    }

    const peer = await prisma.user.findUnique({ where: { id: peerUserId }, select: { id: true } });
    if (!peer) {
      res.status(404).json({ success: false, message: "Recipient not found" });
      return;
    }

    const conversation = await getOrCreateConversation(senderId, peerUserId);

    const message = await prisma.direct_message.create({
      data: {
        conversation_id: conversation.id,
        sender_id: senderId,
        receiver_id: peerUserId,
        body: body || null,
        attachments: attachments.length > 0 ? attachments : undefined,
      },
    });

    await prisma.direct_conversation.update({
      where: { id: conversation.id },
      data: { updated_at: new Date() },
    });

    pushSseEvent(peerUserId, "message", message);
    pushSseEvent(senderId, "message", message);

    res.status(201).json({ success: true, data: message });
  } catch (error) {
    logger(`[MESSAGES] send message failed: ${String(error)}`);
    res.status(500).json({ success: false, message: "Failed to send message" });
  }
}

export async function streamMessages(req: Request, res: Response): Promise<void> {
  const token =
    (typeof req.query.token === "string" && req.query.token) ||
    (req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.split(" ")[1] : "");

  if (!token) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }

  let userId: string | null = null;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as any;
    userId = payload.userId || payload.id || null;
  } catch {
    res.status(401).json({ success: false, message: "Invalid or expired token" });
    return;
  }

  if (!userId) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  res.write(`event: ready\ndata: {"ok":true}\n\n`);

  const unregister = registerSseClient(userId, res);

  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      // socket may already be torn down
    }
  }, 25000);

  const cleanup = () => {
    clearInterval(heartbeat);
    unregister();
    try {
      res.end();
    } catch {
      // ignore
    }
  };

  req.on("close", cleanup);
  req.on("aborted", cleanup);
}

// Returns every booking between the current user and the peer, in either
// direction (current user as client OR current user as photographer).
// Used by the chat thread to render booking-request cards inline alongside
// the message timeline.
export async function listBookingsForConversation(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const peerUserId = typeof req.params.peerUserId === "string" ? req.params.peerUserId.trim() : "";
    if (!peerUserId) {
      res.status(400).json({ success: false, message: "peerUserId is required" });
      return;
    }

    // Resolve each user's photographer profile id (if any) so we can match
    // bookings where either side is the photographer.
    const [myProfile, peerProfile] = await Promise.all([
      prisma.photographer_profile.findUnique({ where: { user_id: userId }, select: { id: true } }),
      prisma.photographer_profile.findUnique({ where: { user_id: peerUserId }, select: { id: true } }),
    ]);

    const whereOrs: any[] = [];
    if (peerProfile?.id) {
      whereOrs.push({ user_id: userId, photographer_id: peerProfile.id });
    }
    if (myProfile?.id) {
      whereOrs.push({ user_id: peerUserId, photographer_id: myProfile.id });
    }

    if (whereOrs.length === 0) {
      res.status(200).json({ success: true, data: [] });
      return;
    }

    const bookings = await prisma.booking.findMany({
      where: { OR: whereOrs },
      select: {
        id: true,
        user_id: true,
        photographer_id: true,
        date: true,
        end_date: true,
        status: true,
        client_note_html: true,
        client_note_attachments: true,
        photographer_note_html: true,
        photographer_note_attachments: true,
        cancelled_by: true,
        status_updated_at: true,
        created_at: true,
        updated_at: true,
        user: { select: { id: true, name: true, email: true } },
        photographer: {
          select: {
            id: true,
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
      orderBy: { created_at: "asc" },
    });

    res.status(200).json({ success: true, data: bookings });
  } catch (error) {
    logger(`[MESSAGES] list bookings for conversation failed: ${String(error)}`);
    res.status(500).json({ success: false, message: "Failed to fetch bookings" });
  }
}
