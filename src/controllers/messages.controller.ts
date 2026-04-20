import { Request, Response } from "express";
import prisma from "../dbConnection";
import { logger } from "../utils/logger";

function sortUsers(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

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

async function getOrCreateConversation(currentUserId: string, peerUserId: string) {
  const [userA, userB] = sortUsers(currentUserId, peerUserId);

  const existing = await prisma.direct_conversation.findUnique({
    where: {
      user_a_id_user_b_id: {
        user_a_id: userA,
        user_b_id: userB,
      },
    },
  });

  if (existing) return existing;

  return prisma.direct_conversation.create({
    data: {
      user_a_id: userA,
      user_b_id: userB,
    },
  });
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

    res.status(201).json({ success: true, data: message });
  } catch (error) {
    logger(`[MESSAGES] send message failed: ${String(error)}`);
    res.status(500).json({ success: false, message: "Failed to send message" });
  }
}
