import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { uploadChatAttachments } from "../middlewares/uploadChatFiles";
import { getConversationMessages, listConversations, sendMessage } from "../controllers/messages.controller";

const router = Router();

router.get("/conversations", requireAuth, listConversations);
router.get("/conversations/:peerUserId", requireAuth, getConversationMessages);
router.post("/send", requireAuth, uploadChatAttachments, sendMessage);

export default router;
