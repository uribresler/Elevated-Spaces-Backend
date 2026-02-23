import Stripe from "stripe";
import { Prisma } from "@prisma/client";
import prisma from "../dbConnection";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const STRIPE_API_VERSION = "2025-12-15.clover";

if (!STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
}

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION });

export type PurchaseFor = "individual" | "team";
export type ProductKey =
    | "starter"
    | "pro"
    | "team"
    | "virtual_staging"
    | "furnishing_addon"
    | "extra_credits_50"
    | "extra_credits_100"
    | "pay_per_image";

const PRODUCT_CATALOG: Record<ProductKey, {
    name: string;
    type: "subscription" | "one_time";
    unitAmountUsd: number;
    credits?: number;
    creditsPerUnit?: number;
    interval?: "month";
}> = {
    starter: { name: "Starter", type: "subscription", unitAmountUsd: 25, credits: 60, interval: "month" },
    pro: { name: "Pro", type: "subscription", unitAmountUsd: 59, credits: 160, interval: "month" },
    team: { name: "Team", type: "subscription", unitAmountUsd: 119, credits: 360, interval: "month" },
    virtual_staging: { name: "Full Home Virtual Staging", type: "one_time", unitAmountUsd: 99.99 },
    furnishing_addon: { name: "Physical Furnishing Add-On", type: "one_time", unitAmountUsd: 39.99 },
    extra_credits_50: { name: "Extra Credits (50)", type: "one_time", unitAmountUsd: 22, credits: 50 },
    extra_credits_100: { name: "Extra Credits (100)", type: "one_time", unitAmountUsd: 40, credits: 100 },
    pay_per_image: { name: "Pay Per Image", type: "one_time", unitAmountUsd: 1.5, creditsPerUnit: 1 },
};

function getProductConfig(productKey: string) {
    const config = PRODUCT_CATALOG[productKey as ProductKey];
    if (!config) {
        throw new Error("Invalid product selection");
    }
    return config;
}

function toCents(amountUsd: number) {
    return Math.round(amountUsd * 100);
}

function calcCredits(config: ReturnType<typeof getProductConfig>, quantity: number) {
    if (config.creditsPerUnit) {
        return config.creditsPerUnit * quantity;
    }
    return config.credits || 0;
}

async function ensureStripeCustomer(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
        throw new Error("User not found");
    }

    if (user.stripe_customer_id) {
        return { user, customerId: user.stripe_customer_id };
    }

    const customer = await stripe.customers.create({
        email: user.email,
        name: user.name || undefined,
        metadata: { userId: user.id },
    });

    await prisma.user.update({
        where: { id: user.id },
        data: { stripe_customer_id: customer.id },
    });

    return { user, customerId: customer.id };
}

async function assertTeamOwner(teamId: string, userId: string) {
    const team = await prisma.teams.findFirst({
        where: { id: teamId, deleted_at: null },
    });

    if (!team) {
        throw new Error("Team not found");
    }

    if (team.owner_id !== userId) {
        throw new Error("Only the team owner can purchase a team plan");
    }

    return team;
}

async function ensureCreditPackage({
    name,
    credits,
    price,
}: {
    name: string;
    credits: number;
    price: number;
}) {
    const existing = await prisma.credit_package.findFirst({ where: { name } });
    if (existing) {
        return existing;
    }

    return prisma.credit_package.create({
        data: {
            name,
            credits,
            price,
            currency: "usd",
            active: true,
        },
    });
}

export async function createCheckoutSession({
    userId,
    productKey,
    purchaseFor,
    teamId,
    quantity,
}: {
    userId: string;
    productKey: string;
    purchaseFor: PurchaseFor;
    teamId?: string;
    quantity?: number;
}) {
    const config = getProductConfig(productKey);
    if (purchaseFor !== "individual" && purchaseFor !== "team") {
        throw new Error("Invalid purchase type");
    }
    const safeQuantity = Math.max(1, Math.min(quantity || 1, 1000));

    if (config.type === "subscription" && safeQuantity !== 1) {
        throw new Error("Subscriptions must have quantity of 1");
    }

    if (purchaseFor === "team") {
        if (!teamId) {
            throw new Error("Team ID is required for team purchases");
        }
        await assertTeamOwner(teamId, userId);
    }

    const { customerId } = await ensureStripeCustomer(userId);

    const credits = calcCredits(config, safeQuantity);
    const unitAmount = toCents(config.unitAmountUsd);
    const totalAmount = unitAmount * safeQuantity;

    const metadata: Record<string, string> = {
        productKey,
        purchaseFor,
        userId,
        credits: String(credits),
        unitAmount: String(unitAmount),
        quantity: String(safeQuantity),
    };

    if (teamId) {
        metadata.teamId = teamId;
    }

    const session = await stripe.checkout.sessions.create({
        mode: config.type === "subscription" ? "subscription" : "payment",
        customer: customerId,
        line_items: [
            {
                quantity: safeQuantity,
                price_data: {
                    currency: "usd",
                    unit_amount: unitAmount,
                    product_data: {
                        name: config.name,
                    },
                    recurring: config.type === "subscription" ? { interval: config.interval || "month" } : undefined,
                },
            },
        ],
        metadata,
        subscription_data: config.type === "subscription" ? { metadata } : undefined,
        success_url: `${FRONTEND_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${FRONTEND_URL}/payment/error?type=cancelled`,
    });

    if (purchaseFor === "team" && teamId) {
        await prisma.team_purchase.create({
            data: {
                team_id: teamId,
                amount: credits,
                price_usd: totalAmount / 100,
                status: "pending",
                stripe_session_id: session.id,
            },
        });
    } else {
        if (credits > 0) {
            const packageRecord = await ensureCreditPackage({
                name: `plan_${productKey}`,
                credits,
                price: totalAmount / 100,
            });

            await prisma.user_credit_purchase.create({
                data: {
                    user_id: userId,
                    package_id: packageRecord.id,
                    amount: credits,
                    price_usd: totalAmount / 100,
                    status: "pending",
                    stripe_session_id: session.id,
                },
            });
        } else {
            await prisma.payment.create({
                data: {
                    user_id: userId,
                    amount: totalAmount / 100,
                    currency: "usd",
                    status: "PENDING",
                    stripe_session_id: session.id,
                },
            });
        }
    }

    return { url: session.url };
}

function applyCreditsToUser(userId: string, credits: number) {
    return prisma.user_credit_balance.upsert({
        where: { user_id: userId },
        create: { user_id: userId, balance: credits },
        update: { balance: { increment: credits } },
    });
}

function applyCreditsToTeam(teamId: string, credits: number) {
    return prisma.teams.update({
        where: { id: teamId },
        data: { wallet: { increment: credits } },
    });
}

export async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    const metadata = session.metadata || {};
    const productKey = metadata.productKey;
    const purchaseFor = metadata.purchaseFor as PurchaseFor | undefined;
    const userId = metadata.userId;
    const teamId = metadata.teamId;
    const quantity = Number(metadata.quantity || 1);

    console.log(`[PAYMENT] handleCheckoutCompleted called:`, {
        sessionId: session.id,
        productKey,
        purchaseFor,
        userId,
        teamId,
        quantity,
        paymentStatus: session.payment_status,
        amountTotal: session.amount_total,
        metadata
    });

    if (!productKey || !purchaseFor || !userId) {
        console.error(`[PAYMENT] Missing required metadata:`, {
            productKey: !!productKey,
            purchaseFor: !!purchaseFor,
            userId: !!userId,
            metadata
        });
        return;
    }

    const config = getProductConfig(productKey);
    if (session.payment_status !== "paid") {
        return;
    }

    const credits = calcCredits(config, quantity);
    const expectedAmount = toCents(config.unitAmountUsd) * quantity;

    if (session.amount_total !== null && session.amount_total !== expectedAmount) {
        throw new Error("Amount mismatch for checkout session");
    }

    if (purchaseFor === "team") {
        if (!teamId) {
            throw new Error("Team ID missing in metadata");
        }

        const existing = await prisma.team_purchase.findFirst({
            where: { stripe_session_id: session.id },
        });

        if (existing?.status === "completed") {
            return;
        }

        const operations: Prisma.PrismaPromise<any>[] = [];

        if (!existing) {
            operations.push(
                prisma.team_purchase.create({
                    data: {
                        team_id: teamId,
                        amount: credits,
                        price_usd: (session.amount_total || 0) / 100,
                        status: "completed",
                        stripe_session_id: session.id,
                        completed_at: new Date(),
                    },
                })
            );
        } else {
            operations.push(
                prisma.team_purchase.update({
                    where: { id: existing.id },
                    data: { status: "completed", completed_at: new Date() },
                })
            );
        }

        if (credits > 0) {
            operations.push(applyCreditsToTeam(teamId, credits));
        }

        await prisma.$transaction(operations);
        return;
    }

    if (credits > 0) {
        const packageRecord = await ensureCreditPackage({
            name: `plan_${productKey}`,
            credits,
            price: (session.amount_total || 0) / 100,
        });

        const existing = await prisma.user_credit_purchase.findFirst({
            where: { stripe_session_id: session.id },
        });

        if (existing?.status === "completed") {
            return;
        }

        const operations: Prisma.PrismaPromise<any>[] = [];

        if (!existing) {
            operations.push(
                prisma.user_credit_purchase.create({
                    data: {
                        user_id: userId,
                        package_id: packageRecord.id,
                        amount: credits,
                        price_usd: (session.amount_total || 0) / 100,
                        status: "completed",
                        stripe_session_id: session.id,
                        completed_at: new Date(),
                    },
                })
            );
        } else {
            operations.push(
                prisma.user_credit_purchase.update({
                    where: { id: existing.id },
                    data: { status: "completed", completed_at: new Date() },
                })
            );
        }

        operations.push(applyCreditsToUser(userId, credits));
        await prisma.$transaction(operations);
        return;
    }

    const existingPayment = await prisma.payment.findFirst({
        where: { stripe_session_id: session.id },
    });

    if (existingPayment?.status === "PAID") {
        return;
    }

    if (!existingPayment) {
        await prisma.payment.create({
            data: {
                user_id: userId,
                amount: (session.amount_total || 0) / 100,
                currency: "usd",
                status: "PAID",
                stripe_session_id: session.id,
            },
        });
        return;
    }

    await prisma.payment.update({
        where: { id: existingPayment.id },
        data: { status: "PAID" },
    });
}

export async function handleInvoicePaid(invoice: Stripe.Invoice) {
    const rawSubscription = (invoice as any).subscription as string | { id: string } | null;
    const subscriptionId = typeof rawSubscription === "string" ? rawSubscription : rawSubscription?.id;
    if (!subscriptionId) {
        return;
    }

    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const metadata = subscription.metadata || {};
    const productKey = metadata.productKey;
    const purchaseFor = metadata.purchaseFor as PurchaseFor | undefined;
    const userId = metadata.userId;
    const teamId = metadata.teamId;
    const quantity = Number(metadata.quantity || 1);

    if (!productKey || !purchaseFor || !userId) {
        return;
    }

    const config = getProductConfig(productKey);
    const credits = calcCredits(config, quantity);
    const expectedAmount = toCents(config.unitAmountUsd) * quantity;

    if (invoice.amount_paid !== expectedAmount) {
        throw new Error("Amount mismatch for invoice");
    }

    if (purchaseFor === "team") {
        if (!teamId) {
            throw new Error("Team ID missing in metadata");
        }

        const existing = await prisma.team_purchase.findFirst({
            where: { stripe_invoice_id: invoice.id },
        });

        if (existing) {
            return;
        }

        const operations: Prisma.PrismaPromise<any>[] = [
            prisma.team_purchase.create({
                data: {
                    team_id: teamId,
                    amount: credits,
                    price_usd: invoice.amount_paid / 100,
                    status: "completed",
                    stripe_invoice_id: invoice.id,
                    completed_at: new Date(),
                },
            }),
        ];

        if (credits > 0) {
            operations.push(applyCreditsToTeam(teamId, credits));
        }

        await prisma.$transaction(operations);
        return;
    }

    if (credits > 0) {
        const packageRecord = await ensureCreditPackage({
            name: `plan_${productKey}`,
            credits,
            price: invoice.amount_paid / 100,
        });

        const existing = await prisma.user_credit_purchase.findFirst({
            where: { stripe_invoice_id: invoice.id },
        });

        if (existing) {
            return;
        }

        await prisma.$transaction([
            prisma.user_credit_purchase.create({
                data: {
                    user_id: userId,
                    package_id: packageRecord.id,
                    amount: credits,
                    price_usd: invoice.amount_paid / 100,
                    status: "completed",
                    stripe_invoice_id: invoice.id,
                    completed_at: new Date(),
                },
            }),
            applyCreditsToUser(userId, credits),
        ]);
        return;
    }
}

export async function getSessionDetails(sessionId: string) {
    try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        
        return {
            id: session.id,
            status: session.status,
            payment_status: session.payment_status,
            customer_email: session.customer_details?.email,
            amount_total: session.amount_total,
            currency: session.currency,
            subscription: session.subscription,
            mode: session.mode,
            metadata: session.metadata,
        };
    } catch (error: any) {
        throw new Error(`Failed to retrieve session: ${error.message}`);
    }
}

export function constructStripeEvent(rawBody: Buffer, signature: string) {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
        throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
    }

    return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

export async function processPendingPurchases() {
    console.log("[PENDING-PROCESSOR] Starting pending purchase processing");
    
    try {
        // Find all pending user credit purchases
        const pendingPurchases = await prisma.user_credit_purchase.findMany({
            where: { status: "pending" },
            take: 50
        });

        console.log(`[PENDING-PROCESSOR] Found ${pendingPurchases.length} pending purchases`);

        for (const purchase of pendingPurchases) {
            try {
                if (!purchase.stripe_session_id) {
                    console.log(`[PENDING-PROCESSOR] Skipping purchase ${purchase.id} - no session ID`);
                    continue;
                }

                // Fetch session from Stripe
                const session = await stripe.checkout.sessions.retrieve(purchase.stripe_session_id);
                
                console.log(`[PENDING-PROCESSOR] Checking session ${session.id}:`, {
                    paymentStatus: session.payment_status,
                    userId: purchase.user_id
                });

                if (session.payment_status === "paid") {
                    // Update purchase to completed
                    await prisma.user_credit_purchase.update({
                        where: { id: purchase.id },
                        data: {
                            status: "completed",
                            completed_at: new Date()
                        }
                    });

                    // Apply credits
                    await applyCreditsToUser(purchase.user_id, purchase.amount);
                    
                    console.log(`[PENDING-PROCESSOR] ✓ Processed purchase ${purchase.id}:`, {
                        userId: purchase.user_id,
                        credits: purchase.amount
                    });
                }
            } catch (error: any) {
                console.error(`[PENDING-PROCESSOR] Error processing purchase ${purchase.id}:`, error.message);
            }
        }

        console.log("[PENDING-PROCESSOR] Completed pending purchase processing");
    } catch (error: any) {
        console.error("[PENDING-PROCESSOR] Error:", error.message || error);
    }
}
