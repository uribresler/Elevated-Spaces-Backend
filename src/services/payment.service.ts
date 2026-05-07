import Stripe from "stripe";
import { Prisma } from "@prisma/client";
import prisma from "../dbConnection";
import { sendEmail } from "../config/mail.config";
import { loggingService } from "./logging.service";
import { InvoiceService } from "./invoice.service";
import { DEMO_LIMIT, isNewMonth } from "../utils/demoTracking";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const STRIPE_API_VERSION = "2025-12-15.clover";

if (!STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
}

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION });

const ACTIVE_SUBSCRIPTION_STATUSES = new Set([
    "active",
    "trialing",
    "past_due",
    "unpaid",
]);

function getSubscriptionStatusPriority(status: string): number {
    switch (status) {
        case "active":
            return 4;
        case "trialing":
            return 3;
        case "past_due":
            return 2;
        case "unpaid":
            return 1;
        default:
            return 0;
    }
}

const PLAN_PRODUCT_KEYS = new Set([
    "starter",
    "pro",
    "team",
    "starter_annual",
    "pro_annual",
    "team_annual",
]);

async function debugSendStripeInvoice(invoiceId: string, scope: string) {
    console.error(`[WEBHOOK][${scope}] Preparing to send Stripe invoice email`, {
        invoiceId,
        hasStripeInvoicesApi: !!stripe.invoices,
        hasSendInvoiceMethod: typeof (stripe.invoices as any)?.sendInvoice === 'function',
    });

    try {
        if (!stripe.invoices || typeof (stripe.invoices as any).sendInvoice !== 'function') {
            console.error(`[WEBHOOK][${scope}] stripe.invoices.sendInvoice is not available on this SDK version`);
            return { success: false, reason: 'sendInvoice not available' };
        }

        // @ts-ignore - Stripe SDK version differences may not expose a typed sendInvoice method.
        const response = await (stripe.invoices as any).sendInvoice(invoiceId);

        console.error(`[WEBHOOK][${scope}] Stripe invoice send request completed`, {
            invoiceId,
            responseType: typeof response,
            responseKeys: response && typeof response === 'object' ? Object.keys(response).slice(0, 25) : null,
            responseId: response?.id,
            responseStatus: response?.status,
            responseNumber: response?.number,
            responseHostedInvoiceUrl: response?.hosted_invoice_url,
            responseInvoicePdf: response?.invoice_pdf,
            responseCustomer: response?.customer,
        });

        return { success: true, response };
    } catch (error: any) {
        console.error(`[WEBHOOK][${scope}] Failed to send Stripe invoice email`, {
            invoiceId,
            message: error?.message,
            code: error?.code,
            statusCode: error?.statusCode,
            requestId: error?.requestId,
            rawType: error?.type,
            rawDeclineCode: error?.decline_code,
            rawParam: error?.param,
        });

        return { success: false, error };
    }
}

async function sendCustomSubscriptionInvoiceEmail(params: {
    to: string;
    userName: string;
    packageName: string;
    amount: number;
    invoiceId: string;
    renewalNumber: number;
    issueDate?: Date;
    dueDate?: Date;
    invoicePdfUrl?: string | null;
    hostedInvoiceUrl?: string | null;
}) {
    const {
        to,
        userName,
        packageName,
        amount,
        invoiceId,
        renewalNumber,
        issueDate = new Date(),
        dueDate = new Date(),
        invoicePdfUrl,
        hostedInvoiceUrl,
    } = params;

    const invoiceHTML = InvoiceService.generateInvoiceHTML({
        invoiceId,
        subscriptionId: invoiceId,
        userId: "",
        packageName,
        credits: 0,
        amount,
        currency: "usd",
        issueDate,
        dueDate,
        renewalNumber,
        userName,
        userEmail: to,
        companyName: "Elevated Spaces",
    });

    const extraLinks = [
        hostedInvoiceUrl ? `<p><strong>Stripe invoice:</strong> <a href="${hostedInvoiceUrl}">${hostedInvoiceUrl}</a></p>` : "",
        invoicePdfUrl ? `<p><strong>Stripe PDF:</strong> <a href="${invoicePdfUrl}">${invoicePdfUrl}</a></p>` : "",
    ].filter(Boolean).join("");

    await sendEmail({
        from: "noreply@elevatedspaces.com",
        senderName: "Elevated Spaces",
        to,
        subject: `Invoice #${invoiceId} - ${packageName} Subscription Renewal`,
        text: [
            `Hi ${userName},`,
            "",
            `Your ${packageName} subscription renewal invoice for $${amount.toFixed(2)} is ready.`,
            hostedInvoiceUrl ? `Stripe invoice: ${hostedInvoiceUrl}` : "",
            invoicePdfUrl ? `Stripe PDF: ${invoicePdfUrl}` : "",
            "",
            "Thank you for continuing with Elevated Spaces!",
        ].filter(Boolean).join("\n"),
        html: `${invoiceHTML}${extraLinks}`,
    });
}

function getPlanTierPriority(productKey?: string | null): number {
    switch (productKey) {
        case "starter":
        case "starter_annual":
            return 1;
        case "pro":
        case "pro_annual":
            return 2;
        case "team":
        case "team_annual":
            return 3;
        default:
            return 0;
    }
}

export type PurchaseFor = "individual" | "team";
export type ProductKey =
    | "starter"
    | "pro"
    | "team"
    | "starter_annual"
    | "pro_annual"
    | "team_annual"
    | "virtual_staging"
    | "furnishing_addon"
    | "extra_credits_50"
    | "extra_credits_100"
    | "pay_per_image"
    | "subscription_topup"
    | "pro_extra_user_seat"
    | "team_extra_user_seat";

const PRODUCT_KEY_ALIASES: Record<string, ProductKey> = {
    starterannual: "starter_annual",
    proannual: "pro_annual",
    teamannual: "team_annual",
    "starter-annual": "starter_annual",
    "pro-annual": "pro_annual",
    "team-annual": "team_annual",
};

function normalizeProductKey(productKey: string): string {
    const normalized = (productKey || "").trim().toLowerCase();
    if (PRODUCT_KEY_ALIASES[normalized]) {
        return PRODUCT_KEY_ALIASES[normalized];
    }
    return normalized;
}

const PRODUCT_CATALOG: Record<ProductKey, {
    name: string;
    type: "subscription" | "one_time";
    unitAmountUsd: number;
    credits?: number;
    creditsPerUnit?: number;
    interval?: "month" | "year";
}> = {
    starter: { name: "Starter", type: "subscription", unitAmountUsd: 29, credits: 60, interval: "month" },
    pro: { name: "Pro", type: "subscription", unitAmountUsd: 69, credits: 160, interval: "month" },
    team: { name: "Team", type: "subscription", unitAmountUsd: 139, credits: 360, interval: "month" },
    starter_annual: { name: "Starter Annual", type: "subscription", unitAmountUsd: 300, credits: 720, interval: "year" },
    pro_annual: { name: "Pro Annual", type: "subscription", unitAmountUsd: 744, credits: 1920, interval: "year" },
    team_annual: { name: "Team Annual", type: "subscription", unitAmountUsd: 1500, credits: 4320, interval: "year" },
    virtual_staging: { name: "Full Home Virtual Staging", type: "one_time", unitAmountUsd: 99.99 },
    furnishing_addon: { name: "Physical Furnishing Add-On", type: "one_time", unitAmountUsd: 39.99 },
    extra_credits_50: { name: "Extra Credits (50)", type: "one_time", unitAmountUsd: 22, credits: 50 },
    extra_credits_100: { name: "Extra Credits (100)", type: "one_time", unitAmountUsd: 40, credits: 100 },
    pay_per_image: { name: "Pay Per Image", type: "one_time", unitAmountUsd: 1.5, creditsPerUnit: 1 },
    subscription_topup: { name: "Subscription Top-Up Credits", type: "one_time", unitAmountUsd: 0, creditsPerUnit: 1 },
    pro_extra_user_seat: { name: "Pro Extra User Seat", type: "subscription", unitAmountUsd: 20, interval: "month" },
    team_extra_user_seat: { name: "Team Extra User Seat", type: "subscription", unitAmountUsd: 15, interval: "month" },
};

function getProductConfig(productKey: string) {
    const normalizedProductKey = normalizeProductKey(productKey);
    const config = PRODUCT_CATALOG[normalizedProductKey as ProductKey];
    if (!config) {
        console.error("❌ Product not found in catalog:", {
            requestedKey: productKey,
            normalizedProductKey,
            availableKeys: Object.keys(PRODUCT_CATALOG),
        });
        throw new Error(`Invalid product selection: ${productKey} not found. Available products: ${Object.keys(PRODUCT_CATALOG).join(", ")}`);
    }
    return config;
}

function toCents(amountUsd: number) {
    return Math.round(amountUsd * 100);
}

function calculateNextRenewalDate(baseDate: Date = new Date()): Date {
    const nextRenewalDate = new Date(baseDate);
    nextRenewalDate.setMonth(nextRenewalDate.getMonth() + 1);
    return nextRenewalDate;
}

function calcCredits(config: ReturnType<typeof getProductConfig>, quantity: number) {
    if (config.creditsPerUnit) {
        return config.creditsPerUnit * quantity;
    }
    return config.credits || 0;
}

function isDatabaseUnavailableError(error: any): boolean {
    if (!error) return false;

    const message = String(error?.message || "").toLowerCase();
    const code = String(error?.code || "");

    return (
        code === "P1001" ||
        message.includes("can't reach database server") ||
        message.includes("databasenotreachable")
    );
}

async function ensureStripeCustomer(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
        throw new Error("User not found");
    }

    if (user.stripe_customer_id) {
        try {
            const existingCustomer = await stripe.customers.retrieve(user.stripe_customer_id);

            if (!("deleted" in existingCustomer && existingCustomer.deleted)) {
                return { user, customerId: user.stripe_customer_id };
            }
        } catch (error: any) {
            const isMissingCustomer =
                error?.type === "StripeInvalidRequestError" &&
                error?.code === "resource_missing";

            if (!isMissingCustomer) {
                throw error;
            }
        }
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

async function listActiveSubscriptionsForScope({
    customerId,
    purchaseFor,
    teamId,
    userId,
}: {
    customerId: string;
    purchaseFor: PurchaseFor;
    teamId?: string;
    userId: string;
}) {
    const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 100,
    });

    return subscriptions.data
        .filter((subscription) => {
            if (!ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status)) {
                return false;
            }

            const metadata = subscription.metadata || {};
            if (metadata.purchaseFor !== purchaseFor || metadata.userId !== userId) {
                return false;
            }

            if (purchaseFor === "team") {
                return metadata.teamId === teamId;
            }

            return !metadata.teamId;
        })
        .sort((a, b) => {
            const priorityDiff = getSubscriptionStatusPriority(b.status) - getSubscriptionStatusPriority(a.status);
            if (priorityDiff !== 0) {
                return priorityDiff;
            }

            const aPeriodStart = typeof (a as any).current_period_start === "number" ? (a as any).current_period_start : 0;
            const bPeriodStart = typeof (b as any).current_period_start === "number" ? (b as any).current_period_start : 0;
            const periodDiff = bPeriodStart - aPeriodStart;
            if (periodDiff !== 0) {
                return periodDiff;
            }

            const aCreated = typeof a.created === "number" ? a.created : 0;
            const bCreated = typeof b.created === "number" ? b.created : 0;
            return bCreated - aCreated;
        });
}

async function listActivePlanSubscriptionsForTeamOwnership({
    customerId,
    teamId,
    userId,
}: {
    customerId: string;
    teamId: string;
    userId: string;
}) {
    const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 100,
    });

    return subscriptions.data
        .filter((subscription) => {
            if (!ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status)) {
                return false;
            }

            const metadata = subscription.metadata || {};
            if (metadata.userId !== userId) {
                return false;
            }

            if (metadata.purchaseFor === "team") {
                return metadata.teamId === teamId;
            }

            if (metadata.purchaseFor === "individual") {
                return !metadata.teamId;
            }

            return false;
        })
        .sort((a, b) => {
            const planPriorityDiff = getPlanTierPriority(b.metadata?.productKey) - getPlanTierPriority(a.metadata?.productKey);
            if (planPriorityDiff !== 0) {
                return planPriorityDiff;
            }

            const statusPriorityDiff = getSubscriptionStatusPriority(b.status) - getSubscriptionStatusPriority(a.status);
            if (statusPriorityDiff !== 0) {
                return statusPriorityDiff;
            }

            const aPeriodStart = typeof (a as any).current_period_start === "number" ? (a as any).current_period_start : 0;
            const bPeriodStart = typeof (b as any).current_period_start === "number" ? (b as any).current_period_start : 0;
            const periodDiff = bPeriodStart - aPeriodStart;
            if (periodDiff !== 0) {
                return periodDiff;
            }

            const aCreated = typeof a.created === "number" ? a.created : 0;
            const bCreated = typeof b.created === "number" ? b.created : 0;
            return bCreated - aCreated;
        });
}

async function hasAnyPlanSubscriptionHistoryForScope({
    customerId,
    purchaseFor,
    teamId,
    userId,
}: {
    customerId: string;
    purchaseFor: PurchaseFor;
    teamId?: string;
    userId: string;
}) {
    const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 100,
    });

    return subscriptions.data.some((subscription) => {
        const metadata = subscription.metadata || {};

        if (metadata.purchaseFor !== purchaseFor || metadata.userId !== userId) {
            return false;
        }

        if (purchaseFor === "team") {
            if (metadata.teamId !== teamId) {
                return false;
            }
        } else if (metadata.teamId) {
            return false;
        }

        const subscriptionProductKey = metadata.productKey;
        return typeof subscriptionProductKey === "string" && PLAN_PRODUCT_KEYS.has(subscriptionProductKey);
    });
}

async function cancelOtherActiveSubscriptions({
    customerId,
    purchaseFor,
    teamId,
    userId,
    keepSubscriptionId,
}: {
    customerId: string;
    purchaseFor: PurchaseFor;
    teamId?: string;
    userId: string;
    keepSubscriptionId: string;
}) {
    const activeSubscriptions = await listActiveSubscriptionsForScope({
        customerId,
        purchaseFor,
        teamId,
        userId,
    });

    const subscriptionsToCancel = activeSubscriptions.filter(
        (subscription) => subscription.id !== keepSubscriptionId
    );

    if (subscriptionsToCancel.length === 0) {
        return;
    }

    await Promise.all(
        subscriptionsToCancel.map(async (subscription) => {
            try {
                await stripe.subscriptions.cancel(subscription.id);
                console.log("[PAYMENT] Canceled previous subscription", {
                    subscriptionId: subscription.id,
                    purchaseFor,
                    teamId,
                    userId,
                });
            } catch (error: any) {
                console.error("[PAYMENT] Failed to cancel subscription", {
                    subscriptionId: subscription.id,
                    error: error?.message || error,
                });
            }
        })
    );
}

async function enforceSingleActiveAutoRenewalSubscription({
    userId,
    keepPurchaseId,
}: {
    userId: string;
    keepPurchaseId: string;
}) {
    await prisma.user_credit_purchase.updateMany({
        where: {
            user_id: userId,
            id: { not: keepPurchaseId },
            status: "completed",
            autoRenewEnabled: true,
            cancelledAt: null,
        },
        data: {
            autoRenewEnabled: false,
            nextRenewalDate: null,
            cancelledAt: new Date(),
            cancellationReason: "Replaced by newer subscription purchase",
        },
    });
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
    uiUnitAmountUsd,
    purchaseFor,
    teamId,
    quantity,
    confirmPlanChange,
    seatAutoRenew,
}: {
    userId: string;
    productKey: string;
    uiUnitAmountUsd?: number;
    purchaseFor: PurchaseFor;
    teamId?: string;
    quantity?: number;
    confirmPlanChange?: boolean;
    seatAutoRenew?: boolean;
}) {
    const normalizedProductKey = normalizeProductKey(productKey);
    const isSubscriptionTopUp = normalizedProductKey === "subscription_topup";
    const config = isSubscriptionTopUp ? null : getProductConfig(normalizedProductKey);
    if (purchaseFor !== "individual" && purchaseFor !== "team") {
        throw new Error("Invalid purchase type");
    }
    const safeQuantity = Math.max(1, Math.min(quantity || 1, 1000));
    const isSeatAddon = normalizedProductKey === "pro_extra_user_seat" || normalizedProductKey === "team_extra_user_seat";
    const shouldAutoRenewSeat = seatAutoRenew !== false;

    if (!isSubscriptionTopUp && config!.type === "subscription" && safeQuantity !== 1) {
        if (!isSeatAddon) {
            throw new Error("Subscriptions must have quantity of 1");
        }
    }

    if (purchaseFor === "team") {
        if (!teamId) {
            throw new Error("Team ID is required for team purchases");
        }
        await assertTeamOwner(teamId, userId);
    }

    const { customerId } = await ensureStripeCustomer(userId);

    if (isSeatAddon) {
        if (purchaseFor !== "team") {
            throw new Error("Extra user seats are only available for team plans");
        }

        if (!teamId) {
            throw new Error("Team ID is required for extra user seats");
        }

        const activePlanSubscriptions = await listActivePlanSubscriptionsForTeamOwnership({
            customerId,
            teamId,
            userId,
        });

        const activePlan = activePlanSubscriptions.find((subscription) => {
            const key = subscription.metadata?.productKey;
            return typeof key === "string" && PLAN_PRODUCT_KEYS.has(key);
        });

        if (!activePlan) {
            throw new Error("Active team plan is required before purchasing extra user seats");
        }

        const activePlanKey = activePlan.metadata?.productKey;
        const validForPlan =
            (normalizedProductKey === "pro_extra_user_seat" && (activePlanKey === "pro" || activePlanKey === "pro_annual")) ||
            (normalizedProductKey === "team_extra_user_seat" && (activePlanKey === "team" || activePlanKey === "team_annual"));

        if (!validForPlan) {
            throw new Error("Selected extra user seat add-on does not match your active team plan");
        }
    }

    if (normalizedProductKey === "furnishing_addon") {
        const hasSubscriptionHistory = await hasAnyPlanSubscriptionHistoryForScope({
            customerId,
            purchaseFor,
            teamId,
            userId,
        });

        if (!hasSubscriptionHistory) {
            const error: any = new Error(
                "Physical staging add-on can only be purchased after subscribing to a plan at least once."
            );
            error.code = "ADDON_SUBSCRIPTION_HISTORY_REQUIRED";
            throw error;
        }
    }

    const existingSubscriptions = !isSubscriptionTopUp && config!.type === "subscription" && !isSeatAddon
        ? await listActiveSubscriptionsForScope({
            customerId,
            purchaseFor,
            teamId,
            userId,
        })
        : [];
    const replacingSubscriptionId = existingSubscriptions[0]?.id;

    if (!isSubscriptionTopUp && config!.type === "subscription" && !isSeatAddon && existingSubscriptions.length > 0 && !confirmPlanChange) {
        const error: any = new Error(
            "You already have an active subscription. Changing plans will cancel the current plan and transfer any unused credits to your wallet. Confirm to proceed."
        );
        error.code = "PLAN_CHANGE_CONFIRMATION_REQUIRED";
        throw error;
    }

    let credits = 0;
    let unitAmount = 0;
    let totalAmount = 0;
    let productName = "";

    const metadata: Record<string, string> = {
        productKey: normalizedProductKey,
        purchaseFor,
        userId,
        quantity: String(safeQuantity),
    };

    if (isSubscriptionTopUp) {
        const activeSubscriptions = await listActiveSubscriptionsForScope({
            customerId,
            purchaseFor,
            teamId,
            userId,
        });

        if (activeSubscriptions.length === 0) {
            throw new Error("An active subscription is required to buy credits at your plan rate");
        }

        const activeSubscription = activeSubscriptions[0];
        const subscriptionProductKey = activeSubscription.metadata?.productKey as ProductKey | undefined;
        const subscriptionConfig = subscriptionProductKey ? PRODUCT_CATALOG[subscriptionProductKey] : undefined;

        if (!subscriptionConfig || subscriptionConfig.type !== "subscription" || !subscriptionConfig.credits) {
            throw new Error("Unable to determine subscription credit rate for top-up");
        }

        const subscriptionUnitCents = toCents(subscriptionConfig.unitAmountUsd);
        const perCreditCents = Math.max(1, Math.round(subscriptionUnitCents / subscriptionConfig.credits));

        credits = safeQuantity;
        unitAmount = perCreditCents;
        totalAmount = unitAmount * safeQuantity;
        productName = `${subscriptionConfig.name} Top-Up Credits`;

        if (subscriptionProductKey) {
            metadata.subscriptionProductKey = subscriptionProductKey;
        }
        metadata.perCreditUsd = (unitAmount / 100).toFixed(2);
        metadata.topUp = "true";
    } else {
        credits = calcCredits(config!, safeQuantity);
        unitAmount = toCents(config!.unitAmountUsd);
        totalAmount = unitAmount * safeQuantity;
        productName = config!.name;
        metadata.productType = config!.type;

        if (normalizedProductKey === "furnishing_addon") {
            metadata.productCategory = "addon";
        }
    }

    metadata.productName = productName;

    metadata.credits = String(credits);
    metadata.unitAmount = String(unitAmount);
    if (isSeatAddon) {
        metadata.seatUnits = String(safeQuantity);
        metadata.seatAutoRenew = String(shouldAutoRenewSeat);
    }

    if (teamId) {
        metadata.teamId = teamId;
    }

    if (replacingSubscriptionId) {
        metadata.replacingSubscriptionId = replacingSubscriptionId;
    }

    const isSubscriptionMode = !isSubscriptionTopUp && config!.type === "subscription";
    
    const safeUiUnitAmountUsd = typeof uiUnitAmountUsd === "number" && Number.isFinite(uiUnitAmountUsd) && uiUnitAmountUsd > 0
        ? uiUnitAmountUsd
        : null;
    // Only override unitAmount for one-time purchases, NOT for subscriptions
    // Subscriptions must use the catalog prices to ensure correct recurring amounts
    const isOneTimeNonPlanPurchase = safeUiUnitAmountUsd && !isSubscriptionTopUp && !isSubscriptionMode && 
        !(normalizedProductKey === "starter" || normalizedProductKey === "pro" || normalizedProductKey === "team" || 
          normalizedProductKey === "starter_annual" || normalizedProductKey === "pro_annual" || normalizedProductKey === "team_annual" ||
          normalizedProductKey === "pro_extra_user_seat" || normalizedProductKey === "team_extra_user_seat");
    
    if (isOneTimeNonPlanPurchase) {
        unitAmount = toCents(safeUiUnitAmountUsd);
        totalAmount = unitAmount * safeQuantity;
    }
    const shouldCreateStripeInvoice = !isSubscriptionMode && totalAmount > 0;
    const session = await stripe.checkout.sessions.create({
        mode: isSubscriptionMode ? "subscription" : "payment",
        customer: customerId,
        line_items: [
            {
                quantity: safeQuantity,
                price_data: {
                    currency: "usd",
                    unit_amount: unitAmount,
                    product_data: {
                        name: productName,
                    },
                    recurring: isSubscriptionMode ? { interval: config!.interval || "month" } : undefined,
                },
            },
        ],
        metadata,
        invoice_creation: shouldCreateStripeInvoice ? { enabled: true } : undefined,
        subscription_data: isSubscriptionMode ? {
            metadata,
            ...(isSeatAddon && !shouldAutoRenewSeat ? { cancel_at_period_end: true } : {}),
        } : undefined,
        success_url: `${FRONTEND_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${FRONTEND_URL}/payment/error?type=cancelled`,
    });

    if (purchaseFor === "team" && teamId) {
            await prisma.team_purchase.create({
            data: {
                team_id: teamId,
                    amount: isSeatAddon ? safeQuantity : credits,
                price_usd: totalAmount / 100,
                status: "pending",
                stripe_session_id: session.id,
            },
        });
    } else {
        if (credits > 0) {
            const packageRecord = await ensureCreditPackage({
                name: isSubscriptionTopUp ? "plan_subscription_topup" : `plan_${productKey}`,
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

export async function sendContactSalesInquiry({
    email,
    message,
    companyName,
    teamSize,
    billingPreference,
    phone,
    userId,
}: {
    email: string;
    message?: string;
    companyName?: string;
    teamSize?: string;
    billingPreference?: string;
    phone?: string;
    userId?: string;
}) {
    const senderEmail = (email || "").trim();
    if (!senderEmail) {
        throw new Error("Email is required");
    }

    const SALES_CONTACT_EMAIL = process.env.SALES_CONTACT_EMAIL || "elevatespacesai@gmail.com";
    const safeMessage = (message || "").trim();
    const safeCompanyName = (companyName || "").trim();
    const safeTeamSize = (teamSize || "").trim();
    const safeBillingPreference = (billingPreference || "").trim();
    const safePhone = (phone || "").trim();
    const submittedAt = new Date().toISOString();

    const subject = `Enterprise plan inquiry${userId ? ` (user: ${userId})` : ""}`;
    const text = [
        "New Contact Sales request",
        `Submitted at: ${submittedAt}`,
        `User ID: ${userId || "N/A"}`,
        `Email: ${senderEmail}`,
        `Company: ${safeCompanyName || "N/A"}`,
        `Team Size: ${safeTeamSize || "N/A"}`,
        `Billing Preference: ${safeBillingPreference || "N/A"}`,
        `Phone: ${safePhone || "N/A"}`,
        "",
        "Message:",
        safeMessage || "Please contact me about enterprise pricing.",
    ].join("\n");

    const html = `
        <h2>New Contact Sales request</h2>
        <p><strong>Submitted at:</strong> ${submittedAt}</p>
        <p><strong>User ID:</strong> ${userId || "N/A"}</p>
        <p><strong>Email:</strong> ${senderEmail}</p>
        <p><strong>Company:</strong> ${safeCompanyName || "N/A"}</p>
        <p><strong>Team Size:</strong> ${safeTeamSize || "N/A"}</p>
        <p><strong>Billing Preference:</strong> ${safeBillingPreference || "N/A"}</p>
        <p><strong>Phone:</strong> ${safePhone || "N/A"}</p>
        <p><strong>Message:</strong></p>
        <p>${(safeMessage || "Please contact me about enterprise pricing.").replace(/\n/g, "<br />")}</p>
    `;

    await sendEmail({
        from: senderEmail,
        senderName: "Elevate Spaces Contact Sales",
        replyTo: senderEmail,
        to: SALES_CONTACT_EMAIL,
        subject,
        text,
        html,
    });

    return { success: true };
}

const INITIAL_SUBSCRIPTION_LOOKBACK_MS = 12 * 60 * 60 * 1000;

function getInitialSubscriptionCutoff() {
    return new Date(Date.now() - INITIAL_SUBSCRIPTION_LOOKBACK_MS);
}

async function findRecentPersonalSubscriptionPurchase({
    userId,
    packageId,
    amount,
}: {
    userId: string;
    packageId: string;
    amount: number;
}) {
    return prisma.user_credit_purchase.findFirst({
        where: {
            user_id: userId,
            package_id: packageId,
            amount,
            created_at: {
                gte: getInitialSubscriptionCutoff(),
            },
            status: {
                in: ["pending", "completed"],
            },
        },
        orderBy: { created_at: "desc" },
    });
}

async function findRecentTeamSubscriptionPurchase({
    teamId,
    amount,
}: {
    teamId: string;
    amount: number;
}) {
    return prisma.team_purchase.findFirst({
        where: {
            team_id: teamId,
            amount,
            created_at: {
                gte: getInitialSubscriptionCutoff(),
            },
            status: {
                in: ["pending", "completed"],
            },
        },
        orderBy: { created_at: "desc" },
    });
}

const SUBSCRIPTION_PLAN_PACKAGE_NAMES = [
    "plan_starter",
    "plan_pro",
    "plan_team",
    "plan_starter_annual",
    "plan_pro_annual",
    "plan_team_annual",
];

/**
 * Get remaining demo credits using unified tracking
 * Checks both user_demo_tracking AND linked guest_tracking
 * Returns the max(guest_count, user_count) to reflect actual unified usage
 */
async function getRemainingSignupDemoCredits(userId: string) {
    const now = new Date();

    // Get user demo tracking
    const userTracking = await prisma.user_demo_tracking.findUnique({
        where: { user_id: userId }
    });

    // Get linked guest tracking
    const guestTracking = await prisma.guest_tracking.findFirst({
        where: { userId }
    });

    // Calculate usage counts with monthly reset logic
    let userCount = 0;
    if (userTracking) {
        userCount = isNewMonth(userTracking.last_reset_at, now) ? 0 : userTracking.uploads_count;
    }

    let guestCount = 0;
    if (guestTracking) {
        guestCount = isNewMonth(guestTracking.last_used_at, now) ? 0 : guestTracking.uploads_count;
    }

    // Use the MAX of both counts (unified tracking)
    const unifiedCount = Math.max(userCount, guestCount);

    return Math.max(0, DEMO_LIMIT - unifiedCount);
}

async function getOneTimeDemoTransferCredits({
    userId,
    productKey,
    purchaseFor,
}: {
    userId: string;
    productKey: string;
    purchaseFor: PurchaseFor;
}) {
    if (purchaseFor !== "individual") {
        return 0;
    }

    // Transfer remaining demo credits on the first successful individual credit purchase,
    // including pay-per-image and top-ups (not only subscription plans).
    if (!productKey || productKey === "furnishing_addon") {
        return 0;
    }

    const completedCreditPurchases = await prisma.user_credit_purchase.count({
        where: {
            user_id: userId,
            status: "completed",
        },
    });

    if (completedCreditPurchases > 0) {
        return 0;
    }

    return getRemainingSignupDemoCredits(userId);
}

export async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    console.log('🔥🔥🔥 [PAYMENT] handleCheckoutCompleted - NEW CODE VERSION WITH MONGODB LOGGING 🔥🔥🔥');

    const metadata = session.metadata || {};
    const productKey = metadata.productKey;
    const normalizedProductKey = normalizeProductKey(String(productKey || ""));
    const isSeatAddon = productKey === "pro_extra_user_seat" || productKey === "team_extra_user_seat";
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

    // Extra debug log
    console.log('[DEBUG] Entered handleCheckoutCompleted, about to process payment logic');

    let credits = 0;
    let expectedAmount = 0;
    let productName = "";

    if (productKey === "subscription_topup") {
        credits = Number(metadata.credits || 0);
        expectedAmount = Number(metadata.unitAmount || 0) * quantity;
        productName = metadata.subscriptionProductKey
            ? `${metadata.subscriptionProductKey.toUpperCase()} Top-Up Credits`
            : "Subscription Top-Up Credits";
    } else {
        const config = getProductConfig(productKey);
        credits = calcCredits(config, quantity);
        expectedAmount = toCents(config.unitAmountUsd) * quantity;
        productName = config.name;
    }


    if (!productKey || !purchaseFor || !userId) {
        console.error(`[PAYMENT] Missing required metadata:`, {
            productKey: !!productKey,
            purchaseFor: !!purchaseFor,
            userId: !!userId,
            metadata
        });
        console.log('[PAYMENT] Early return: Missing required metadata');
        return;
    }

    if (session.payment_status !== "paid") {
        // Not a successful payment, do not process further
        console.log('[PAYMENT] Early return: Payment status is not "paid", status:', session.payment_status);
        return;
    }

    console.log('[PAYMENT] ✅ Passed validation checks, proceeding with payment processing...');


    if (session.amount_total !== null && session.amount_total !== expectedAmount) {
        throw new Error("Amount mismatch for checkout session");
    }

    const detailedSession = await stripe.checkout.sessions.retrieve(session.id, {
        expand: ["invoice"],
    });
    const detailedInvoice = typeof detailedSession.invoice === "string" ? null : detailedSession.invoice;
    const stripeInvoicePdfUrl = detailedInvoice?.invoice_pdf || null;
    const stripeInvoiceHostedUrl = detailedInvoice?.hosted_invoice_url || null;

    let userEmail: string | undefined = undefined;
    let userName: string | undefined = undefined;
    const isSubscriptionPlanPurchase =
        session.mode === "subscription" &&
        (PLAN_PRODUCT_KEYS.has(normalizedProductKey as ProductKey) || isSeatAddon);
    const subscriptionId = typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id;
    if (purchaseFor === "team") {
        if (!teamId) {
            throw new Error("Team ID missing in metadata");
        }

        const existing = await prisma.team_purchase.findFirst({
            where: { stripe_session_id: session.id },
        });

        if (existing?.status === "completed") {
            // Still send email if not sent before
            const user = await prisma.user.findUnique({ where: { id: userId } });
            userEmail = user?.email;
            userName = user?.name || undefined;
        } else {
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
                            stripe_subscription_id: subscriptionId,
                            completed_at: new Date(),
                        },
                    })
                );
            } else {
                operations.push(
                    prisma.team_purchase.update({
                        where: { id: existing.id },
                        data: { 
                            status: "completed", 
                            completed_at: new Date(),
                            stripe_subscription_id: subscriptionId,
                        },
                    })
                );
            }

            if (credits > 0) {
                operations.push(applyCreditsToTeam(teamId, credits));
            }

            await prisma.$transaction(operations);

            const user = await prisma.user.findUnique({ where: { id: userId } });
            userEmail = user?.email;
            userName = user?.name || undefined;
        }

        if (session.mode === "subscription" && !isSeatAddon) {
            const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
            const newSubscriptionId = typeof session.subscription === "string"
                ? session.subscription
                : session.subscription?.id;
            if (customerId && newSubscriptionId) {
                await cancelOtherActiveSubscriptions({
                    customerId,
                    purchaseFor,
                    teamId,
                    userId,
                    keepSubscriptionId: newSubscriptionId,
                });
            }
        }
    } else if (credits > 0) {
        const packageRecord = await ensureCreditPackage({
            name: `plan_${productKey}`,
            credits,
            price: (session.amount_total || 0) / 100,
        });

        const existing = await prisma.user_credit_purchase.findFirst({
            where: { stripe_session_id: session.id },
        });

        if (existing?.status === "completed") {
            // Still send email if not sent before
            const user = await prisma.user.findUnique({ where: { id: userId } });
            userEmail = user?.email;
            userName = user?.name || undefined;
        } else {
            const demoTransferCredits = await getOneTimeDemoTransferCredits({
                userId,
                productKey,
                purchaseFor,
            });
            let shouldApplyCredits = true;
            const operations: Prisma.PrismaPromise<any>[] = [];

            if (!existing) {
                // Calculate next renewal date (1 month from now)
                // const nextRenewalDate = new Date();
                // nextRenewalDate.setMonth(nextRenewalDate.getMonth() + 1);

                const nextRenewalDate = isSubscriptionPlanPurchase
                    ? calculateNextRenewalDate(new Date())
                    : null;

                operations.push(
                    prisma.user_credit_purchase.create({
                        data: {
                            user_id: userId,
                            package_id: packageRecord.id,
                            amount: credits,
                            price_usd: (session.amount_total || 0) / 100,
                            status: "completed",
                            stripe_session_id: session.id,
                            stripe_subscription_id: isSubscriptionPlanPurchase ? subscriptionId : null,
                            completed_at: new Date(),
                            autoRenewEnabled: isSubscriptionPlanPurchase,
                            nextRenewalDate,
                            renewalCount: 0,
                        },
                    })
                );
            } else {
                const nextRenewalDate = isSubscriptionPlanPurchase
                    ? calculateNextRenewalDate(new Date())
                    : null;

                const completionResult = await prisma.user_credit_purchase.updateMany({
                    where: {
                        id: existing.id,
                        status: "pending",
                    },
                    data: {
                        status: "completed",
                        completed_at: new Date(),
                        stripe_subscription_id: isSubscriptionPlanPurchase ? subscriptionId : null,
                        autoRenewEnabled: isSubscriptionPlanPurchase,
                        nextRenewalDate,
                    },
                });

                if (completionResult.count === 0) {
                    console.log("[PAYMENT] Skipping duplicate checkout processing for already completed purchase", {
                        purchaseId: existing.id,
                        sessionId: session.id,
                    });

                    const user = await prisma.user.findUnique({ where: { id: userId } });
                    userEmail = user?.email;
                    userName = user?.name || undefined;
                    shouldApplyCredits = false;
                }
            }

            if (shouldApplyCredits) {
                operations.push(applyCreditsToUser(userId, credits + demoTransferCredits));
            }

            if (shouldApplyCredits && demoTransferCredits > 0) {
                operations.push(
                    prisma.user_demo_tracking.upsert({
                        where: { user_id: userId },
                        create: {
                            user_id: userId,
                            uploads_count: DEMO_LIMIT,
                            last_reset_at: new Date(),
                        },
                        update: {
                            uploads_count: DEMO_LIMIT,
                            last_reset_at: new Date(),
                        },
                    })
                );
                operations.push(
                    prisma.guest_tracking.updateMany({
                        where: { userId },
                        data: {
                            uploads_count: DEMO_LIMIT,
                            last_used_at: new Date(),
                        },
                    })
                );
            }

            if (operations.length > 0) {
                await prisma.$transaction(operations);
            }

            if (shouldApplyCredits) {
                const completedPurchase = await prisma.user_credit_purchase.findFirst({
                    where: {
                        stripe_session_id: session.id,
                        user_id: userId,
                        status: "completed",
                    },
                    orderBy: { created_at: "desc" },
                });

                if (session.mode === "subscription" && completedPurchase) {
                    await enforceSingleActiveAutoRenewalSubscription({
                        userId,
                        keepPurchaseId: completedPurchase.id,
                    });
                }
            }

            const user = await prisma.user.findUnique({ where: { id: userId } });
            userEmail = user?.email;
            userName = user?.name || undefined;
        }

        if (session.mode === "subscription" && !isSeatAddon) {
            const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
            const newSubscriptionId = typeof session.subscription === "string"
                ? session.subscription
                : session.subscription?.id;
            if (customerId && newSubscriptionId) {
                await cancelOtherActiveSubscriptions({
                    customerId,
                    purchaseFor,
                    userId,
                    keepSubscriptionId: newSubscriptionId,
                });
            }
        }
    } else {
        const existingPayment = await prisma.payment.findFirst({
            where: { stripe_session_id: session.id },
        });

        if (existingPayment?.status === "PAID") {
            const user = await prisma.user.findUnique({ where: { id: userId } });
            userEmail = user?.email;
            userName = user?.name || undefined;
        } else if (!existingPayment) {
            await prisma.payment.create({
                data: {
                    user_id: userId,
                    amount: (session.amount_total || 0) / 100,
                    currency: "usd",
                    status: "PAID",
                    stripe_session_id: session.id,
                },
            });
            const user = await prisma.user.findUnique({ where: { id: userId } });
            userEmail = user?.email;
            userName = user?.name || undefined;
        } else {
            await prisma.payment.update({
                where: { id: existingPayment.id },
                data: { status: "PAID" },
            });
            const user = await prisma.user.findUnique({ where: { id: userId } });
            userEmail = user?.email;
            userName = user?.name || undefined;
        }
    }

    // Send receipt email after successful payment processing
    if (userEmail && session.mode !== "subscription") {
        let emailSent = false;
        let emailError: string | undefined = undefined;
        let emailSentAt: Date | undefined = undefined;

        console.log('[PAYMENT] ===== ENTERING EMAIL SECTION =====');
        console.log('[PAYMENT] userEmail:', userEmail);
        console.log('[PAYMENT] credits:', credits);
        console.log('[PAYMENT] sessionId:', session.id);

        try {
            console.log(`[EMAIL-DEBUG] User and email found, preparing to send receipt to ${userEmail}`);
            await sendEmail({
                from: "hello@elevatespacesai.com",
                senderName: "Elevated Spaces",
                to: userEmail,
                subject: stripeInvoicePdfUrl || stripeInvoiceHostedUrl
                    ? "Your Stripe Invoice and Payment Confirmation"
                    : "Your Payment Receipt - Elevated Spaces",
                text: [
                    "Thank you for your payment!",
                    "",
                    `Product: ${productName}`,
                    `Credits: ${credits}`,
                    `Amount Paid: $${((session.amount_total || 0) / 100).toFixed(2)}`,
                    stripeInvoiceHostedUrl ? `Stripe invoice: ${stripeInvoiceHostedUrl}` : "",
                    stripeInvoicePdfUrl ? `Stripe invoice PDF: ${stripeInvoicePdfUrl}` : "",
                    "",
                    "If you have any questions, contact support@elevatespacesai.com.",
                ].filter(Boolean).join("\n"),
                html: `
                    <h2>Thank you for your payment!</h2>
                    <p><b>Product:</b> ${productName}<br/><b>Credits:</b> ${credits}<br/><b>Amount Paid:</b> $${((session.amount_total || 0) / 100).toFixed(2)}</p>
                    ${stripeInvoiceHostedUrl ? `<p><b>Stripe invoice:</b> <a href="${stripeInvoiceHostedUrl}">${stripeInvoiceHostedUrl}</a></p>` : ""}
                    ${stripeInvoicePdfUrl ? `<p><b>Stripe invoice PDF:</b> <a href="${stripeInvoicePdfUrl}">${stripeInvoicePdfUrl}</a></p>` : ""}
                    <p>If you have any questions, contact <a href='mailto:support@elevatespacesai.com'>support@elevatespacesai.com</a>.</p>
                `,
            });
            console.log(`[EMAIL-DEBUG] Payment receipt sent to ${userEmail} successfully.`);
            emailSent = true;
            emailSentAt = new Date();
        } catch (emailErr) {
            console.error('[EMAIL-DEBUG] sendEmail threw error:', emailErr);
            emailError = emailErr instanceof Error ? emailErr.message : String(emailErr);
        }

        // Log payment to MongoDB
        try {
            console.log('[PAYMENT] Logging payment to MongoDB for session:', session.id);
            await loggingService.logPayment({
                transactionId: session.id,
                userId,
                userEmail,
                teamId,
                amount: (session.amount_total || 0) / 100,
                currency: session.currency || 'usd',
                credits,
                status: 'completed',
                paymentMethod: session.payment_method_types?.[0] || 'unknown',
                provider: 'stripe',
                providerResponse: {
                    sessionId: session.id,
                    customer: session.customer,
                    subscription: session.subscription,
                    mode: session.mode,
                },
                emailSent,
                emailSentAt,
                emailError,
                metadata: {
                    productKey,
                    productName,
                    purchaseFor,
                    quantity,
                },
            });
            console.log('[PAYMENT] Payment logged successfully to MongoDB');
        } catch (logErr) {
            console.error('[PAYMENT] Error logging payment to MongoDB:', logErr);
        }
    } else {
        console.error('[EMAIL-DEBUG] No user email found for receipt. userId:', userId);

        // Log payment even without email
        try {
            console.log('[PAYMENT] Logging payment to MongoDB (no email) for session:', session.id);
            await loggingService.logPayment({
                transactionId: session.id,
                userId,
                teamId,
                amount: (session.amount_total || 0) / 100,
                currency: session.currency || 'usd',
                credits,
                status: 'completed',
                paymentMethod: session.payment_method_types?.[0] || 'unknown',
                provider: 'stripe',
                emailSent: false,
                emailError: 'No user email found',
                metadata: {
                    productKey,
                    productName,
                    purchaseFor,
                    quantity,
                },
            });
            console.log('[PAYMENT] Payment logged successfully to MongoDB (no email)');
        } catch (logErr) {
            console.error('[PAYMENT] Error logging payment to MongoDB:', logErr);
        }
    }
}

export async function handleInvoicePaid(invoice: Stripe.Invoice) {
    console.error('[WEBHOOK] ========== INVOICE PAID WEBHOOK RECEIVED ==========');
    console.error('[WEBHOOK] Invoice ID:', invoice.id);
    console.error('[WEBHOOK] Invoice Number:', invoice.number);
    console.error('[WEBHOOK] Invoice Status:', invoice.status);
    
    const rawSubscription = (invoice as any).subscription as string | { id: string } | null;
    const subscriptionId = typeof rawSubscription === "string" ? rawSubscription : rawSubscription?.id;
    console.error('[WEBHOOK] Subscription ID:', subscriptionId);
    
    if (!subscriptionId) {
        console.error('[WEBHOOK] NO SUBSCRIPTION ID - RETURNING EARLY');
        return;
    }

    const billingReason = invoice.billing_reason || null;
    console.error('[WEBHOOK] Billing Reason:', billingReason);

    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    console.error('[WEBHOOK] Subscription retrieved, metadata:', subscription.metadata);
    
    const metadata = subscription.metadata || {};
    const productKey = metadata.productKey;
    const purchaseFor = metadata.purchaseFor as PurchaseFor | undefined;
    const userId = metadata.userId;
    const teamId = metadata.teamId;
    const quantity = Number(metadata.quantity || 1);

    console.error('[WEBHOOK] Extracted metadata - productKey:', productKey, 'purchaseFor:', purchaseFor, 'userId:', userId, 'teamId:', teamId, 'quantity:', quantity);

    if (!productKey || !purchaseFor || !userId) {
        console.error('[WEBHOOK] MISSING REQUIRED METADATA - RETURNING EARLY. productKey:', productKey, 'purchaseFor:', purchaseFor, 'userId:', userId);
        return;
    }

    const config = getProductConfig(productKey);
    const credits = calcCredits(config, quantity);
    const expectedAmount = toCents(config.unitAmountUsd) * quantity;

    console.error('[WEBHOOK] Config loaded - productKey:', productKey, 'credits:', credits, 'expectedAmount:', expectedAmount, 'actualAmount:', invoice.amount_paid);

    if (invoice.amount_paid !== expectedAmount) {
        console.error('[WEBHOOK] AMOUNT MISMATCH - THROWING ERROR');
        throw new Error("Amount mismatch for invoice");
    }

    if (purchaseFor === "team") {
        console.error('[WEBHOOK] TEAM PLAN PATH - teamId:', teamId);
        if (!teamId) {
            console.error('[WEBHOOK] TEAM PLAN BUT NO TEAM ID - THROWING ERROR');
            throw new Error("Team ID missing in metadata");
        }

        const existingByInvoice = await prisma.team_purchase.findFirst({
            where: { stripe_invoice_id: invoice.id },
        });

        console.error('[WEBHOOK] Checked for existing purchase by invoice ID, found:', !!existingByInvoice);

        if (existingByInvoice) {
            console.error('[WEBHOOK] PURCHASE ALREADY EXISTS BY INVOICE ID - RETURNING EARLY (idempotency)');
            return;
        }

        const recentPurchase = billingReason === "subscription_create"
            ? await findRecentTeamSubscriptionPurchase({
                teamId,
                amount: credits,
            })
            : null;

        console.error('[WEBHOOK] Recent purchase check - billingReason:', billingReason, 'found:', !!recentPurchase, 'status:', recentPurchase?.status);

        if (recentPurchase?.status === "completed") {
            console.error('[WEBHOOK] RECENT PURCHASE COMPLETED - UPDATING STRIPE IDS AND RETURNING');
            if (!recentPurchase.stripe_invoice_id || !recentPurchase.stripe_subscription_id) {
                await prisma.team_purchase.update({
                    where: { id: recentPurchase.id },
                    data: { 
                        stripe_invoice_id: invoice.id,
                        stripe_subscription_id: subscriptionId,
                    },
                });
            }

            return;
        }

        const operations: Prisma.PrismaPromise<any>[] = [
            recentPurchase
                ? prisma.team_purchase.update({
                    where: { id: recentPurchase.id },
                    data: {
                        amount: credits,
                        price_usd: invoice.amount_paid / 100,
                        status: "completed",
                        stripe_invoice_id: invoice.id,
                        stripe_subscription_id: subscriptionId,
                        completed_at: new Date(),
                    },
                })
                : prisma.team_purchase.create({
                    data: {
                        team_id: teamId,
                        amount: credits,
                        price_usd: invoice.amount_paid / 100,
                        status: "completed",
                        stripe_invoice_id: invoice.id,
                        stripe_subscription_id: subscriptionId,
                        completed_at: new Date(),
                    },
                }),
        ];

        if (credits > 0) {
            operations.push(applyCreditsToTeam(teamId, credits));
        }

        await prisma.$transaction(operations);
        console.error('[WEBHOOK] TEAM PURCHASE RECORD CREATED/UPDATED AND CREDITS APPLIED');

        // Get user email for logging
        const user = await prisma.user.findUnique({ where: { id: userId } });
        console.error('[WEBHOOK] USER LOOKUP - userId:', userId, 'found:', !!user, 'email:', user?.email);

        // Log subscription renewal payment to MongoDB
        try {
            console.log('[PAYMENT] Logging subscription renewal (team) to MongoDB for invoice:', invoice.id);
            await loggingService.logPayment({
                transactionId: invoice.id,
                userId,
                userEmail: user?.email,
                teamId,
                amount: invoice.amount_paid / 100,
                currency: invoice.currency || 'usd',
                credits,
                status: 'completed',
                paymentMethod: 'subscription',
                provider: 'stripe',
                providerResponse: {
                    invoiceId: invoice.id,
                    invoiceNumber: invoice.number || null,
                    subscriptionId,
                    customer: invoice.customer,
                    hostedInvoiceUrl: invoice.hosted_invoice_url,
                },
                emailSent: false,
                metadata: {
                    productKey,
                    productName: config.name,
                    purchaseFor,
                    quantity,
                    billingReason: invoice.billing_reason,
                },
            });
            console.log('[PAYMENT] Subscription renewal (team) logged successfully to MongoDB');
        } catch (logErr) {
            console.error('[PAYMENT] Error logging subscription renewal (team) to MongoDB:', logErr);
        }

        console.error('[WEBHOOK] Stripe invoice data ready for team plan:', {
            invoiceNumber: invoice.number || invoice.id,
            hostedInvoiceUrl: invoice.hosted_invoice_url,
            invoicePdfUrl: invoice.invoice_pdf,
            customerEmail: user?.email,
        });

        if (user?.email) {
            await sendCustomSubscriptionInvoiceEmail({
                to: user.email,
                userName: user.name || "Valued Customer",
                packageName: config.name,
                amount: invoice.amount_paid / 100,
                invoiceId: invoice.number || invoice.id,
                renewalNumber: ((subscription as any).renewalCount ?? 0) + 1,
                issueDate: new Date(),
                dueDate: new Date(),
                invoicePdfUrl: invoice.invoice_pdf,
                hostedInvoiceUrl: invoice.hosted_invoice_url,
            });
        } else {
            console.error('[WEBHOOK] Skipping custom invoice email for team plan - no user email found');
        }

        return;
    }

    if (credits > 0) {
        console.error('[WEBHOOK] PERSONAL PLAN PATH - userId:', userId, 'credits:', credits);
        
        const packageRecord = await ensureCreditPackage({
            name: `plan_${productKey}`,
            credits,
            price: invoice.amount_paid / 100,
        });

        const existingByInvoice = await prisma.user_credit_purchase.findFirst({
            where: { stripe_invoice_id: invoice.id },
        });

        console.error('[WEBHOOK] Checked for existing purchase by invoice ID, found:', !!existingByInvoice);

        if (existingByInvoice) {
            console.error('[WEBHOOK] PURCHASE ALREADY EXISTS BY INVOICE ID - RETURNING EARLY (idempotency)');
            return;
        }

        const recentPurchase = billingReason === "subscription_create"
            ? await findRecentPersonalSubscriptionPurchase({
                userId,
                packageId: packageRecord.id,
                amount: credits,
            })
            : null;

        console.error('[WEBHOOK] Recent purchase check - billingReason:', billingReason, 'found:', !!recentPurchase, 'status:', recentPurchase?.status);

        if (recentPurchase?.status === "completed") {
            console.error('[WEBHOOK] RECENT PURCHASE COMPLETED - UPDATING STRIPE IDS AND RETURNING');
            if (!recentPurchase.stripe_invoice_id) {
                await prisma.user_credit_purchase.update({
                    where: { id: recentPurchase.id },
                    data: { stripe_invoice_id: invoice.id },
                });
            }

            return;
        }

        await prisma.$transaction([
            recentPurchase
                ? prisma.user_credit_purchase.update({
                    where: { id: recentPurchase.id },
                    data: {
                        amount: credits,
                        price_usd: invoice.amount_paid / 100,
                        status: "completed",
                        stripe_invoice_id: invoice.id,
                        completed_at: new Date(),
                    },
                })
                : prisma.user_credit_purchase.create({
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
        console.error('[WEBHOOK] PERSONAL PURCHASE RECORD CREATED/UPDATED AND CREDITS APPLIED');

        // Get user email for logging
        const user = await prisma.user.findUnique({ where: { id: userId } });
        console.error('[WEBHOOK] USER LOOKUP - userId:', userId, 'found:', !!user, 'email:', user?.email);

        // Log subscription renewal payment to MongoDB
        try {
            console.log('[PAYMENT] Logging subscription renewal (personal) to MongoDB for invoice:', invoice.id);
            await loggingService.logPayment({
                transactionId: invoice.id,
                userId,
                userEmail: user?.email,
                amount: invoice.amount_paid / 100,
                currency: invoice.currency || 'usd',
                credits,
                status: 'completed',
                paymentMethod: 'subscription',
                provider: 'stripe',
                providerResponse: {
                    invoiceId: invoice.id,
                    invoiceNumber: invoice.number || null,
                    subscriptionId,
                    customer: invoice.customer,
                    hostedInvoiceUrl: invoice.hosted_invoice_url,
                },
                emailSent: false,
                metadata: {
                    productKey,
                    productName: config.name,
                    purchaseFor,
                    quantity,
                    billingReason: invoice.billing_reason,
                },
            });
            console.log('[PAYMENT] Subscription renewal (personal) logged successfully to MongoDB');
        } catch (logErr) {
            console.error('[PAYMENT] Error logging subscription renewal (personal) to MongoDB:', logErr);
        }

        console.error('[WEBHOOK] Stripe invoice data ready for personal plan:', {
            invoiceNumber: invoice.number || invoice.id,
            hostedInvoiceUrl: invoice.hosted_invoice_url,
            invoicePdfUrl: invoice.invoice_pdf,
            customerEmail: user?.email,
        });

        if (user?.email) {
            await sendCustomSubscriptionInvoiceEmail({
                to: user.email,
                userName: user.name || "Valued Customer",
                packageName: config.name,
                amount: invoice.amount_paid / 100,
                invoiceId: invoice.number || invoice.id,
                renewalNumber: ((subscription as any).renewalCount ?? 0) + 1,
                issueDate: new Date(),
                dueDate: new Date(),
                invoicePdfUrl: invoice.invoice_pdf,
                hostedInvoiceUrl: invoice.hosted_invoice_url,
            });
        } else {
            console.error('[WEBHOOK] Skipping custom invoice email for personal plan - no user email found');
        }

        return;
    }
    
    console.error('[WEBHOOK] ========== INVOICE PAID WEBHOOK COMPLETED SUCCESSFULLY ==========');
}



export async function getSessionDetails(sessionId: string) {
    try {
        const session = await stripe.checkout.sessions.retrieve(sessionId, {
            expand: ["line_items.data.price.product", "invoice"],
        });

        const metadata = session.metadata || {};
        const rawProductKey = metadata.productKey || "";
        const normalizedProductKey = rawProductKey.toLowerCase().trim().replace(/[\s-]+/g, "_");

        const lineItems = (session as any).line_items?.data as Array<any> | undefined;
        const firstLineItem = lineItems?.[0];
        const resolvedProductName =
            metadata.productName ||
            firstLineItem?.description ||
            ((firstLineItem?.price?.product as any)?.name as string | undefined) ||
            null;

        const metadataCategory = metadata.productCategory || metadata.productType || "";
        const normalizedCategory = String(metadataCategory).toLowerCase();
        const isAddonFromName =
            typeof resolvedProductName === "string" &&
            (resolvedProductName.toLowerCase().includes("furnishing") || resolvedProductName.toLowerCase().includes("physical staging"));
        const resolvedProductCategory =
            normalizedCategory === "addon" ||
                normalizedProductKey === "furnishing_addon" ||
                isAddonFromName
                ? "addon"
                : normalizedCategory || null;

        const invoice = typeof session.invoice === "string" ? null : session.invoice;

        return {
            id: session.id,
            status: session.status,
            payment_status: session.payment_status,
            customer_email: session.customer_details?.email,
            amount_total: session.amount_total,
            currency: session.currency,
            subscription: session.subscription,
            mode: session.mode,
            metadata,
            invoiceId: invoice?.id || null,
            invoiceNumber: invoice?.number || null,
            invoicePdf: invoice?.invoice_pdf || null,
            hostedInvoiceUrl: invoice?.hosted_invoice_url || null,
            resolvedProductKey: normalizedProductKey || null,
            resolvedProductName,
            resolvedProductCategory,
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
        const unpaidSessionExpiryThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000);

        // Find all pending user credit purchases
        const pendingPurchases = await prisma.user_credit_purchase.findMany({
            where: { status: "pending" },
            take: 50,
            include: {
                package: {
                    select: {
                        name: true,
                    },
                },
            },
        });

        console.log(`[PENDING-PROCESSOR] Found ${pendingPurchases.length} pending purchases`);

        const cleanedPersonalPurchaseIds = new Set<string>();

        for (const purchase of pendingPurchases) {
            if (!purchase.stripe_session_id) {
                continue;
            }

            if (purchase.created_at > unpaidSessionExpiryThreshold) {
                continue;
            }

            try {
                const session = await stripe.checkout.sessions.retrieve(purchase.stripe_session_id, {
                    expand: ["invoice"],
                });
                if (session.payment_status !== "unpaid") {
                    continue;
                }

                if (session.status === "open") {
                    try {
                        await stripe.checkout.sessions.expire(session.id);
                    } catch (expireError: any) {
                        console.warn(`[PENDING-PROCESSOR] Could not expire session ${session.id}:`, expireError?.message || expireError);
                    }
                }

                const deleted = await prisma.user_credit_purchase.deleteMany({
                    where: {
                        id: purchase.id,
                        status: "pending",
                    },
                });

                if (deleted.count > 0) {
                    cleanedPersonalPurchaseIds.add(purchase.id);
                    console.log(`[PENDING-PROCESSOR] Removed stale unpaid pending purchase ${purchase.id} (session ${session.id})`);
                }
            } catch (cleanupError: any) {
                console.warn(`[PENDING-PROCESSOR] Failed stale-unpaid cleanup for purchase ${purchase.id}:`, cleanupError?.message || cleanupError);
            }
        }

        for (const purchase of pendingPurchases) {
            if (cleanedPersonalPurchaseIds.has(purchase.id)) {
                continue;
            }

            try {
                if (!purchase.stripe_session_id) {
                    console.log(`[PENDING-PROCESSOR] Skipping purchase ${purchase.id} - no session ID`);
                    continue;
                }

                // Fetch session from Stripe
                const session = await stripe.checkout.sessions.retrieve(purchase.stripe_session_id, {
                    expand: ["invoice"],
                });

                console.log(`[PENDING-PROCESSOR] Checking session ${session.id}:`, {
                    paymentStatus: session.payment_status,
                    userId: purchase.user_id
                });

                if (session.payment_status === "paid") {
                    const metadata = session.metadata || {};
                    const rawProductKey = metadata.productKey || "";
                    const normalizedProductKey = String(rawProductKey)
                        .toLowerCase()
                        .trim()
                        .replace(/[\s-]+/g, "_");
                    const purchaseFor = (metadata.purchaseFor as PurchaseFor | undefined) || "individual";
                    const isSubscriptionPlan =
                        session.mode === "subscription" ||
                        PLAN_PRODUCT_KEYS.has(normalizedProductKey as any) ||
                        SUBSCRIPTION_PLAN_PACKAGE_NAMES.includes(purchase.package?.name || "");
                    const nextRenewalDate = calculateNextRenewalDate(new Date());

                    const demoTransferCredits = await getOneTimeDemoTransferCredits({
                        userId: purchase.user_id,
                        productKey: normalizedProductKey,
                        purchaseFor,
                    });

                    const completionResult = await prisma.user_credit_purchase.updateMany({
                        where: {
                            id: purchase.id,
                            status: "pending",
                        },
                        data: {
                            status: "completed",
                            completed_at: new Date(),
                            autoRenewEnabled: isSubscriptionPlan,
                            nextRenewalDate: isSubscriptionPlan ? nextRenewalDate : null,
                            renewalCount: 0,
                        },
                    });

                    if (completionResult.count === 0) {
                        console.log(`[PENDING-PROCESSOR] Skipping already-processed purchase ${purchase.id}`);
                        continue;
                    }

                    const operations: Prisma.PrismaPromise<any>[] = [
                        applyCreditsToUser(purchase.user_id, purchase.amount + demoTransferCredits),
                    ];

                    if (demoTransferCredits > 0) {
                        operations.push(
                            prisma.user_demo_tracking.upsert({
                                where: { user_id: purchase.user_id },
                                create: {
                                    user_id: purchase.user_id,
                                    uploads_count: DEMO_LIMIT,
                                    last_reset_at: new Date(),
                                },
                                update: {
                                    uploads_count: DEMO_LIMIT,
                                    last_reset_at: new Date(),
                                },
                            })
                        );
                        operations.push(
                            prisma.guest_tracking.updateMany({
                                where: { userId: purchase.user_id },
                                data: {
                                    uploads_count: DEMO_LIMIT,
                                    last_used_at: new Date(),
                                },
                            })
                        );
                    }

                    await prisma.$transaction(operations);

                    if (isSubscriptionPlan) {
                        await enforceSingleActiveAutoRenewalSubscription({
                            userId: purchase.user_id,
                            keepPurchaseId: purchase.id,
                        });
                    }

                    console.log(`[PENDING-PROCESSOR] ✓ Processed purchase ${purchase.id}:`, {
                        userId: purchase.user_id,
                        sessionMode: session.mode,
                        productKey: rawProductKey,
                        normalizedProductKey,
                        isSubscriptionPlan,
                        credits: purchase.amount,
                        transferredDemoCredits: demoTransferCredits,
                    });

                    const invoiceObject = session.invoice && typeof session.invoice === "object" ? session.invoice : null;
                    const invoiceId = typeof session.invoice === "string" ? session.invoice : invoiceObject?.id;

                    console.log(`[PENDING-PROCESSOR] Stripe invoice details for purchase ${purchase.id}:`, {
                        invoiceId,
                        invoiceNumber: invoiceObject?.number || null,
                        invoiceStatus: invoiceObject?.status || null,
                        hostedInvoiceUrl: invoiceObject?.hosted_invoice_url || null,
                        invoicePdf: invoiceObject?.invoice_pdf || null,
                        customer: invoiceObject?.customer || null,
                    });

                    // Send the custom app invoice email when the cron path completes the purchase.
                    if (isSubscriptionPlan && invoiceId && purchase.user_id) {
                        const user = await prisma.user.findUnique({ where: { id: purchase.user_id } });
                        if (user?.email) {
                            await sendCustomSubscriptionInvoiceEmail({
                                to: user.email,
                                userName: user.name || "Valued Customer",
                                packageName: purchase.package?.name || "Subscription",
                                amount: purchase.price_usd,
                                invoiceId: invoiceObject?.number || invoiceId,
                                renewalNumber: 0,
                                issueDate: new Date(),
                                dueDate: new Date(),
                                invoicePdfUrl: invoiceObject?.invoice_pdf || null,
                                hostedInvoiceUrl: invoiceObject?.hosted_invoice_url || null,
                            });
                            console.log(`[PENDING-PROCESSOR] Custom invoice email sent for purchase ${purchase.id}`);
                        } else {
                            console.log(`[PENDING-PROCESSOR] No user email available for subscription purchase ${purchase.id}`);
                        }
                    } else if (isSubscriptionPlan) {
                        console.log(`[PENDING-PROCESSOR] No invoice ID available yet for subscription purchase ${purchase.id}`);
                    }
                }
            } catch (error: any) {
                console.error(`[PENDING-PROCESSOR] Error processing purchase ${purchase.id}:`, error.message);
            }
        }

        // Process pending team purchases
        console.log("[PENDING-PROCESSOR] Processing pending team purchases...");
        
        try {
            const pendingTeamPurchases = await prisma.team_purchase.findMany({
                where: { status: "pending" },
                take: 50,
            });

            console.log(`[PENDING-PROCESSOR] Found ${pendingTeamPurchases.length} pending team purchases`);

            const cleanedTeamPurchaseIds = new Set<string>();

            for (const purchase of pendingTeamPurchases) {
                if (!purchase.stripe_session_id) {
                    continue;
                }

                if (purchase.created_at > unpaidSessionExpiryThreshold) {
                    continue;
                }

                try {
                    const session = await stripe.checkout.sessions.retrieve(purchase.stripe_session_id, {
                        expand: ["invoice"],
                    });
                    if (session.payment_status !== "unpaid") {
                        continue;
                    }

                    if (session.status === "open") {
                        try {
                            await stripe.checkout.sessions.expire(session.id);
                        } catch (expireError: any) {
                            console.warn(`[PENDING-PROCESSOR-TEAM] Could not expire session ${session.id}:`, expireError?.message || expireError);
                        }
                    }

                    const deleted = await prisma.team_purchase.deleteMany({
                        where: {
                            id: purchase.id,
                            status: "pending",
                        },
                    });

                    if (deleted.count > 0) {
                        cleanedTeamPurchaseIds.add(purchase.id);
                        console.log(`[PENDING-PROCESSOR-TEAM] Removed stale unpaid team purchase ${purchase.id} (session ${session.id})`);
                    }
                } catch (cleanupError: any) {
                    console.warn(`[PENDING-PROCESSOR-TEAM] Failed stale-unpaid cleanup for purchase ${purchase.id}:`, cleanupError?.message || cleanupError);
                }
            }

            for (const purchase of pendingTeamPurchases) {
                if (cleanedTeamPurchaseIds.has(purchase.id)) {
                    continue;
                }

                try {
                    if (!purchase.stripe_session_id) {
                        console.log(`[PENDING-PROCESSOR-TEAM] Skipping team purchase ${purchase.id} - no session ID`);
                        continue;
                    }

                    // Fetch session from Stripe
                    const session = await stripe.checkout.sessions.retrieve(purchase.stripe_session_id);

                    console.log(`[PENDING-PROCESSOR-TEAM] Checking session ${session.id}:`, {
                        paymentStatus: session.payment_status,
                        teamId: purchase.team_id,
                        mode: session.mode,
                    });

                    if (session.payment_status === "paid") {
                        // Extract subscription ID if this is a subscription
                        const subscriptionId = typeof session.subscription === "string" 
                            ? session.subscription 
                            : session.subscription?.id;

                        const completionResult = await prisma.team_purchase.updateMany({
                            where: {
                                id: purchase.id,
                                status: "pending",
                            },
                            data: {
                                status: "completed",
                                completed_at: new Date(),
                                stripe_subscription_id: subscriptionId,
                            },
                        });

                        if (completionResult.count === 0) {
                            console.log(`[PENDING-PROCESSOR-TEAM] Skipping already-processed purchase ${purchase.id}`);
                            continue;
                        }

                        // Apply credits to team wallet
                        if (purchase.amount > 0) {
                            await prisma.teams.update({
                                where: { id: purchase.team_id },
                                data: { wallet: { increment: purchase.amount } },
                            });
                        }

                        console.log(`[PENDING-PROCESSOR-TEAM] ✓ Processed team purchase ${purchase.id}:`, {
                            teamId: purchase.team_id,
                            credits: purchase.amount,
                            price: purchase.price_usd,
                            subscriptionId,
                            isSubscription: !!subscriptionId,
                        });

                        const invoiceObject = session.invoice && typeof session.invoice === "object" ? session.invoice : null;
                        const invoiceId = typeof session.invoice === "string" ? session.invoice : invoiceObject?.id;

                        console.log(`[PENDING-PROCESSOR-TEAM] Stripe invoice details for purchase ${purchase.id}:`, {
                            invoiceId,
                            invoiceNumber: invoiceObject?.number || null,
                            invoiceStatus: invoiceObject?.status || null,
                            hostedInvoiceUrl: invoiceObject?.hosted_invoice_url || null,
                            invoicePdf: invoiceObject?.invoice_pdf || null,
                            customer: invoiceObject?.customer || null,
                        });

                        if (subscriptionId && invoiceId) {
                            const team = await prisma.teams.findUnique({
                                where: { id: purchase.team_id },
                                select: { owner_id: true, name: true },
                            });
                            const owner = team?.owner_id
                                ? await prisma.user.findUnique({
                                    where: { id: team.owner_id },
                                    select: { email: true, name: true },
                                })
                                : null;

                            if (owner?.email) {
                                await sendCustomSubscriptionInvoiceEmail({
                                    to: owner.email,
                                    userName: owner.name || "Valued Customer",
                                    packageName: team?.name || "Team Plan",
                                    amount: purchase.price_usd,
                                    invoiceId: invoiceObject?.number || invoiceId,
                                    renewalNumber: 0,
                                    issueDate: new Date(),
                                    dueDate: new Date(),
                                    invoicePdfUrl: invoiceObject?.invoice_pdf || null,
                                    hostedInvoiceUrl: invoiceObject?.hosted_invoice_url || null,
                                });
                                console.log(`[PENDING-PROCESSOR-TEAM] Custom invoice email sent for purchase ${purchase.id}`);
                            } else {
                                console.log(`[PENDING-PROCESSOR-TEAM] No owner email found for team purchase ${purchase.id}`);
                            }
                        } else if (subscriptionId) {
                            console.log(`[PENDING-PROCESSOR-TEAM] No invoice ID available yet for team purchase ${purchase.id}`);
                        }
                    }
                } catch (error: any) {
                    console.error(`[PENDING-PROCESSOR-TEAM] Error processing team purchase ${purchase.id}:`, error.message);
                }
            }
        } catch (error: any) {
            console.error("[PENDING-PROCESSOR-TEAM] Error processing team purchases:", error.message);
        }

        console.log("[PENDING-PROCESSOR] Completed pending purchase processing");
    } catch (error: any) {
        if (isDatabaseUnavailableError(error)) {
            console.warn(
                "[PENDING-PROCESSOR] Database unreachable (P1001). Skipping this cycle and retrying on next schedule."
            );
            return;
        }

        console.error("[PENDING-PROCESSOR] Error:", error.message || error);
    }
}

export async function resendInvoiceById(invoiceId: string) {
    if (!invoiceId) throw new Error('invoiceId is required');

    try {
        if (stripe.invoices && typeof (stripe.invoices as any).sendInvoice === 'function') {
            // @ts-ignore
            await (stripe.invoices as any).sendInvoice(invoiceId);
            return { success: true, method: 'sdk' };
        }

        // Fallback: call the REST endpoint directly
        // @ts-ignore
        await stripe.request({ method: 'POST', url: `/v1/invoices/${invoiceId}/send` });
        return { success: true, method: 'rest' };
    } catch (err: any) {
        console.error('[SERVICE] resendInvoiceById error:', err);
        return { success: false, error: err?.message || String(err) };
    }
}
