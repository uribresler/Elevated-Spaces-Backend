import { Request, Response } from "express";
import { constructStripeEvent, createCheckoutSession, handleCheckoutCompleted, handleInvoicePaid, getSessionDetails, processPendingPurchases, sendContactSalesInquiry, sendSupportInquiry } from "../services/payment.service";
import { resendInvoiceById } from "../services/payment.service";
import Stripe from "stripe";
import prisma from "../dbConnection";
import { loggingService } from "../services/logging.service";
import { DEMO_LIMIT, isNewMonth } from "../utils/demoTracking";

export async function createCheckoutSessionHandler(req: Request, res: Response) {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const { productKey, uiUnitAmountUsd, purchaseFor, teamId, quantity, confirmPlanChange, seatAutoRenew, autoRenewEnabled } = req.body;
        console.log("📋 Checkout session request:", {
            userId,
            productKey,
            uiUnitAmountUsd,
            purchaseFor,
            teamId,
            quantity,
            confirmPlanChange,
            seatAutoRenew,
            autoRenewEnabled,
            requestBody: req.body,
        });
        if (!productKey || !purchaseFor) {
            return res.status(400).json({ message: "Product key and purchase type are required" });
        }

        const result = await createCheckoutSession({
            userId,
            productKey,
            uiUnitAmountUsd,
            purchaseFor,
            teamId,
            quantity,
            confirmPlanChange,
            seatAutoRenew,
            autoRenewEnabled,
        });

        return res.status(200).json(result);
    } catch (error: any) {
        console.error("❌ Checkout session error:", {
            message: error?.message,
            code: error?.code,
            requestBody: req.body,
            stack: error?.stack,
        });
        if (error?.code === "PLAN_CHANGE_CONFIRMATION_REQUIRED") {
            return res.status(409).json({
                message: error.message || "Plan change confirmation required",
                code: error.code,
            });
        }
        return res.status(400).json({
            message: error.message || "Failed to create checkout session",
            ...(error?.code ? { code: error.code } : {}),
        });
    }
}

export async function getCreditsHandler(req: Request, res: Response) {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        // Get user's purchase history
        const purchases = await prisma.user_credit_purchase.findMany({
            where: { user_id: userId },
            include: { package: true },
            orderBy: { completed_at: 'desc' },
            take: 10
        });

        let creditBalance = await prisma.user_credit_balance.findUnique({
            where: { user_id: userId }
        });

        // One-time self-heal: if user already purchased credits but still has demo credits,
        // convert remaining demo credits into paid wallet credits.
        const hasCompletedPurchase = purchases.some((purchase) => purchase.status === "completed");
        if (hasCompletedPurchase) {
            const now = new Date();

            const [userTracking, guestTracking] = await Promise.all([
                prisma.user_demo_tracking.findUnique({ where: { user_id: userId } }),
                prisma.guest_tracking.findFirst({ where: { userId } }),
            ]);

            const userUsage = userTracking
                ? (isNewMonth(userTracking.last_reset_at, now) ? 0 : userTracking.uploads_count)
                : 0;
            const guestUsage = guestTracking
                ? (isNewMonth(guestTracking.last_used_at, now) ? 0 : guestTracking.uploads_count)
                : 0;

            const unifiedUsage = Math.max(userUsage, guestUsage);
            const remainingDemoCredits = Math.max(0, DEMO_LIMIT - unifiedUsage);

            if (remainingDemoCredits > 0) {
                await prisma.$transaction([
                    prisma.user_credit_balance.upsert({
                        where: { user_id: userId },
                        create: { user_id: userId, balance: remainingDemoCredits },
                        update: { balance: { increment: remainingDemoCredits } },
                    }),
                    prisma.user_demo_tracking.upsert({
                        where: { user_id: userId },
                        create: {
                            user_id: userId,
                            uploads_count: DEMO_LIMIT,
                            last_reset_at: now,
                        },
                        update: {
                            uploads_count: DEMO_LIMIT,
                            last_reset_at: now,
                        },
                    }),
                    prisma.guest_tracking.updateMany({
                        where: { userId },
                        data: {
                            uploads_count: DEMO_LIMIT,
                            last_used_at: now,
                        },
                    }),
                ]);

                creditBalance = await prisma.user_credit_balance.findUnique({
                    where: { user_id: userId }
                });
            }
        }

        return res.status(200).json({
            success: true,
            data: {
                currentBalance: creditBalance?.balance || 0,
                recentPurchases: purchases.map(p => ({
                    amount: p.amount,
                    price: p.price_usd,
                    status: p.status,
                    completedAt: p.completed_at,
                    packageName: p.package?.name
                }))
            }
        });
    } catch (error: any) {
        return res.status(400).json({ message: error.message || "Failed to retrieve credits" });
    }
}

export async function getWebhookLogsHandler(req: Request, res: Response) {
    try {
        const { limit = 20 } = req.query;
        const maxLimit = Math.min(Number(limit), 100);

        // Get recent webhook events
        const events = await prisma.webhook_event.findMany({
            orderBy: { created_at: 'desc' },
            take: maxLimit
        });

        return res.status(200).json({
            success: true,
            data: {
                totalEvents: events.length,
                events: events.map((e: any) => ({
                    eventId: e.event_id,
                    eventType: e.event_type,
                    processed: e.processed,
                    errorMessage: e.error_message,
                    createdAt: e.created_at,
                    data: e.data ? JSON.parse(e.data) : null
                }))
            }
        });
    } catch (error: any) {
        return res.status(400).json({ message: error.message || "Failed to retrieve webhook logs" });
    }
}

export async function getSessionDetailsHandler(req: Request, res: Response) {
    try {
        const { sessionId } = req.params;
        if (!sessionId) {
            return res.status(400).json({ message: "Session ID is required" });
        }

        // Note: We don't strictly require authentication here because:
        // 1. Stripe session IDs are difficult to guess (they're cryptographically secure)
        // 2. The payment has already been processed and validated by Stripe
        // 3. The session ID is passed via URL after redirect from Stripe
        // 4. Users need to access this even if their token expired
        
        const sessionDetails = await getSessionDetails(sessionId);

        return res.status(200).json(sessionDetails);
    } catch (error: any) {
        return res.status(400).json({ message: error.message || "Failed to retrieve session details" });
    }
}

export async function stripeWebhookHandler(req: Request, res: Response) {
    try {
        const signature = req.headers["stripe-signature"] as string;
        if (!signature) {
            console.error("Missing stripe-signature header");
            return res.status(400).json({ message: "Missing stripe-signature header" });
        }

        const event = constructStripeEvent(req.body as Buffer, signature);
        console.log(`[WEBHOOK] Received Stripe event: ${event.type}`, {
            eventId: event.id,
            timestamp: new Date(event.created * 1000).toISOString(),
        });

        // Store webhook event for debugging
        await prisma.webhook_event.create({
            data: {
                event_type: event.type,
                event_id: event.id,
                data: JSON.stringify(event.data),
                processed: false,
                error_message: null
            }
        }).catch((err: unknown) => console.log("Failed to store webhook event:", err));

        switch (event.type) {
            case "checkout.session.completed": {
                const session = event.data.object as Stripe.Checkout.Session;
                console.log(`[WEBHOOK] Processing checkout.session.completed:`, {
                    sessionId: session.id,
                    customerId: session.customer,
                    paymentStatus: session.payment_status,
                    metadata: session.metadata
                });
                try {
                    await handleCheckoutCompleted(session);
                    console.log(`[WEBHOOK] Successfully processed checkout.session.completed`);
                    
                    // Mark webhook as processed
                    await prisma.webhook_event.update({
                        where: { event_id: event.id },
                        data: { processed: true }
                    }).catch(() => {});
                } catch (error: unknown) {
                    const err = error as any;
                    console.error(`[WEBHOOK] Error processing checkout.session.completed:`, err);
                    await prisma.webhook_event.update({
                        where: { event_id: event.id },
                        data: { error_message: err.message }
                    }).catch(() => {});
                    throw err;
                }
                break;
            }
            case "invoice.paid": {
                const invoice = event.data.object as Stripe.Invoice;
                console.log(`[WEBHOOK] Processing invoice.paid:`, {
                    invoiceId: invoice.id,
                    customerId: invoice.customer,
                    amountPaid: invoice.amount_paid
                });
                try {
                    await handleInvoicePaid(invoice);
                    console.log(`[WEBHOOK] Successfully processed invoice.paid`);
                    
                    // Mark webhook as processed
                    await prisma.webhook_event.update({
                        where: { event_id: event.id },
                        data: { processed: true }
                    }).catch(() => {});
                } catch (error: unknown) {
                    const err = error as any;
                    console.error(`[WEBHOOK] Error processing invoice.paid:`, err);
                    await prisma.webhook_event.update({
                        where: { event_id: event.id },
                        data: { error_message: err.message }
                    }).catch(() => {});
                    throw err;
                }
                break;
            }
            default:
                console.log(`[WEBHOOK] Ignoring event type: ${event.type}`);
        }

        return res.status(200).json({ received: true });
    } catch (error: any) {
        console.error("Stripe webhook error:", error.message || error);
        return res.status(400).json({ message: "Webhook error" });
    }
}
export async function simulateWebhookHandler(req: Request, res: Response) {
    try {
        const { sessionId } = req.body;
        
        if (!sessionId) {
            return res.status(400).json({ message: "sessionId is required" });
        }

        // Fetch the actual session from Stripe
        const sessionDetails = await getSessionDetails(sessionId);
        const stripeSession = sessionDetails as unknown as Stripe.Checkout.Session;

        console.log(`[SIMULATE-WEBHOOK] Processing session:`, {
            sessionId,
            paymentStatus: stripeSession.payment_status,
            amountTotal: stripeSession.amount_total,
            metadata: stripeSession.metadata
        });

        // Call handleCheckoutCompleted directly
        if (stripeSession.payment_status === "paid") {
            await handleCheckoutCompleted(stripeSession as Stripe.Checkout.Session);
            console.log(`[SIMULATE-WEBHOOK] Successfully simulated webhook for session:`, sessionId);
            return res.status(200).json({
                success: true,
                message: "Webhook simulation processed",
                processed: true
            });
        } else {
            return res.status(400).json({
                success: false,
                message: `Session payment status is ${stripeSession.payment_status}, expected 'paid'`
            });
        }
    } catch (error: any) {
        console.error("[SIMULATE-WEBHOOK] Error:", error.message || error);
        return res.status(400).json({
            success: false,
            message: error.message || "Failed to simulate webhook"
        });
    }
}

export async function processPendingPurchasesHandler(req: Request, res: Response) {
    try {
        // This endpoint can be called manually to retry pending purchases
        // In production, this should be protected or only available internally
        await processPendingPurchases();
        
        return res.status(200).json({
            success: true,
            message: "Pending purchase processing completed"
        });
    } catch (error: any) {
        console.error("Error processing pending purchases:", error);
        return res.status(400).json({
            success: false,
            message: error.message || "Failed to process pending purchases"
        });
    }
}

export async function testPaymentLogHandler(req: Request, res: Response) {
    try {
        console.log('[TEST-PAYMENT-LOG] Testing payment logging to MongoDB...');
        
        const testPaymentData = {
            transactionId: `test_${Date.now()}`,
            userId: req.user?.id || 'test-user-123',
            userEmail: req.user?.email || 'test@example.com',
            amount: 99.99,
            currency: 'usd',
            credits: 100,
            status: 'completed' as const,
            paymentMethod: 'test',
            provider: 'stripe',
            emailSent: true,
            metadata: {
                productKey: 'test-product',
                productName: 'Test Product',
                purchaseFor: 'individual',
                test: true
            }
        };
        
        console.log('[TEST-PAYMENT-LOG] Attempting to log:', testPaymentData);
        await loggingService.logPayment(testPaymentData);
        console.log('[TEST-PAYMENT-LOG] ✅ Payment logged successfully');
        
        return res.status(200).json({
            success: true,
            message: "Test payment logged to MongoDB successfully",
            data: testPaymentData
        });
    } catch (error: any) {
        console.error('[TEST-PAYMENT-LOG] ❌ Error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || "Failed to log test payment",
            error: error.toString()
        });
    }
}

export async function contactSalesHandler(req: Request, res: Response) {
    try {
        const { email, fullName, message, companyName, teamSize, billingPreference, phone, preferredContactMethod, estimatedMonthlyCreditVolume, primaryUseCase, preferredStartDate } = req.body;
        if (!email || typeof email !== "string") {
            return res.status(400).json({ message: "Email is required" });
        }

        await sendContactSalesInquiry({
            email,
            fullName: typeof fullName === "string" ? fullName : undefined,
            message: typeof message === "string" ? message : undefined,
            companyName: typeof companyName === "string" ? companyName : undefined,
            teamSize: typeof teamSize === "string" ? teamSize : undefined,
            billingPreference: typeof billingPreference === "string" ? billingPreference : undefined,
            phone: typeof phone === "string" ? phone : undefined,
            preferredContactMethod: typeof preferredContactMethod === "string" ? preferredContactMethod : undefined,
            estimatedMonthlyCreditVolume: typeof estimatedMonthlyCreditVolume === "string" ? estimatedMonthlyCreditVolume : undefined,
            primaryUseCase: typeof primaryUseCase === "string" ? primaryUseCase : undefined,
            preferredStartDate: typeof preferredStartDate === "string" ? preferredStartDate : undefined,
            userId: req.user?.id,
        });

        return res.status(200).json({
            success: true,
            message: "Your request has been sent to sales.",
        });
    } catch (error: any) {
        return res.status(400).json({
            message: error?.message || "Failed to send contact sales request",
        });
    }
}

export async function supportRequestHandler(req: Request, res: Response) {
    try {
        const { fullName, companyName, email, briefDescription, orderNumber, additionalContext, screenshots } = req.body;

        if (!email || typeof email !== "string") {
            return res.status(400).json({ message: "Email is required" });
        }

        if (!briefDescription || typeof briefDescription !== "string") {
            return res.status(400).json({ message: "Brief description is required" });
        }

        const caseNumber = `CASE-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

        await sendSupportInquiry({
            fullName: typeof fullName === "string" ? fullName : undefined,
            companyName: typeof companyName === "string" ? companyName : undefined,
            email,
            briefDescription,
            orderNumber: typeof orderNumber === "string" ? orderNumber : undefined,
            additionalContext: typeof additionalContext === "string" ? additionalContext : undefined,
            screenshots: Array.isArray(screenshots)
                ? screenshots
                    .filter((item) => item && typeof item.filename === "string" && typeof item.content === "string")
                    .map((item) => ({
                        filename: item.filename,
                        content: item.content,
                        type: typeof item.type === "string" ? item.type : undefined,
                    }))
                : undefined,
            userId: req.user?.id,
            caseNumber,
        });

        return res.status(200).json({
            success: true,
            message: "Your support request has been sent.",
            caseNumber,
        });
    } catch (error: any) {
        return res.status(400).json({
            message: error?.message || "Failed to send support request",
        });
    }
}

export async function resendInvoiceHandler(req: Request, res: Response) {
    try {
        const { invoiceId } = req.body;
        if (!invoiceId || typeof invoiceId !== 'string') {
            return res.status(400).json({ message: 'invoiceId is required' });
        }

        const result = await resendInvoiceById(invoiceId);
        if (result.success) {
            return res.status(200).json({ success: true, method: result.method });
        }

        return res.status(500).json({ success: false, error: result.error });
    } catch (error: any) {
        console.error('[CONTROLLER] resendInvoiceHandler error:', error);
        return res.status(400).json({ message: error?.message || 'Failed to resend invoice' });
    }
}