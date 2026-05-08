import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { createCheckoutSessionHandler, getSessionDetailsHandler, getCreditsHandler, getWebhookLogsHandler, simulateWebhookHandler, processPendingPurchasesHandler, testPaymentLogHandler, contactSalesHandler, resendInvoiceHandler, supportRequestHandler } from "../controllers/payment.controller";

const router = Router();

router.post("/checkout-session", requireAuth, createCheckoutSessionHandler);
router.post("/contact-sales", contactSalesHandler);
router.post("/support-request", supportRequestHandler);
router.get("/session/:sessionId", getSessionDetailsHandler);
router.get("/credits", requireAuth, getCreditsHandler);
router.get("/webhook-logs", getWebhookLogsHandler);

// Development only: Simulate webhook for testing (REMOVE IN PRODUCTION)
if (process.env.NODE_ENV !== "production") {
    router.post("/simulate-webhook", simulateWebhookHandler);
    router.post("/process-pending", processPendingPurchasesHandler);
    router.post("/test-payment-log", testPaymentLogHandler);
    router.post("/resend-invoice", resendInvoiceHandler);
}

export default router;
