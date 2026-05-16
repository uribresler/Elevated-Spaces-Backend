import { Request, Response } from "express";
import prisma from "../dbConnection";
import Stripe from "stripe";

const STRIPE_API_VERSION = "2025-12-15.clover";
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION }) : null;

// 30-day grace period for expired/cancelled subscriptions (in milliseconds)
const GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

function isSubscriptionEffectivelyActive(purchase: { completed_at: Date | null; cancelledAt: Date | null; autoRenewEnabled: boolean }): boolean {
  const now = new Date();
  
  // If not cancelled and auto-renew enabled, it's active
  if (!purchase.cancelledAt && purchase.autoRenewEnabled) {
    return true;
  }
  
  // If cancelled or auto-renew disabled, check if within 30-day grace period from completed_at
  if (purchase.completed_at) {
    const graceExpiry = new Date(purchase.completed_at.getTime() + GRACE_PERIOD_MS);
    return now < graceExpiry;
  }
  
  return false;
}

function normalizePackageName(packageName?: string | null): string {
    if (!packageName) return "Unknown Package";

    const trimmed = packageName.trim();
    const withoutPrefix = trimmed.startsWith("plan_") ? trimmed.slice(5) : trimmed;
    return withoutPrefix
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

type BillingCycle = "monthly" | "annual";
type PlanTier = "starter" | "pro" | "team" | "enterprise" | "unknown";

function getBillingCycleFromPackageName(packageName?: string | null): BillingCycle {
    const normalized = String(packageName || "").toLowerCase();
    if (normalized.includes("annual") || normalized.includes("year")) {
        return "annual";
    }
    return "monthly";
}

function getPlanTierFromPackageName(packageName?: string | null): PlanTier {
    const normalized = String(packageName || "").toLowerCase();
    if (normalized.includes("enterprise")) return "enterprise";
    if (normalized.includes("team")) return "team";
    if (normalized.includes("pro")) return "pro";
    if (normalized.includes("starter")) return "starter";
    return "unknown";
}

function getIncludedSeatsForTier(tier: PlanTier): number {
    switch (tier) {
        case "pro":
            return 2;
        case "team":
            return 5;
        case "enterprise":
            return 6;
        case "starter":
            return 1;
        default:
            return 0;
    }
}

function formatSeatCapacity(params: { tier: PlanTier; extraSeats?: number; isExtraSeatPurchase?: boolean; seatUnits?: number }): string {
    const { tier, extraSeats = 0, isExtraSeatPurchase = false, seatUnits = 0 } = params;
    if (isExtraSeatPurchase) {
        return `+${Math.max(0, seatUnits)} extra`;
    }

    const included = getIncludedSeatsForTier(tier);
    if (!included) return "-";
    if (tier === "enterprise") {
        return extraSeats > 0 ? `6 + ${extraSeats} extra` : "6";
    }
    return extraSeats > 0 ? `${included}/${included} + ${extraSeats} extra` : `${included}/${included}`;
}

function resolveAmountWithFallback(params: {
    amount: number;
    tier: PlanTier;
    billingCycle: BillingCycle;
    packageFallbackPrice?: number | null;
}): number {
    if (params.amount > 0) {
        return params.amount;
    }

    if (params.packageFallbackPrice && params.packageFallbackPrice > 0) {
        return params.packageFallbackPrice;
    }

    const { tier, billingCycle } = params;
    if (tier === "starter") return billingCycle === "annual" ? 300 : 29;
    if (tier === "pro") return billingCycle === "annual" ? 744 : 69;
    if (tier === "team") return billingCycle === "annual" ? 1500 : 139;
    return 0;
}

function isExtraSeatPackageName(packageName?: string | null): boolean {
    const normalized = String(packageName || "").toLowerCase();
    return normalized.includes("extra") && normalized.includes("seat");
}

function inferTeamPurchaseMeta(params: { amount: number; priceUsd: number }) {
    const { amount, priceUsd } = params;
    const unitPrice = amount > 0 ? priceUsd / amount : 0;
    const isExtraSeat = amount > 0 && (Math.abs(unitPrice - 15) < 0.01 || Math.abs(unitPrice - 20) < 0.01);

    if (isExtraSeat) {
        return {
            packageName: `Extra Seats (${amount})`,
            billingCycle: "monthly" as const,
            isExtraSeatPurchase: true,
            seatUnits: amount,
            tier: "unknown" as PlanTier,
        };
    }

    const credits = Number(amount);
    let tier: PlanTier = "unknown";
    if (credits === 60 || credits === 720) tier = "starter";
    else if (credits === 160 || credits === 1920) tier = "pro";
    else if (credits === 360 || credits === 4320) tier = "team";
    else if (credits >= 500) tier = "enterprise";

    const billingCycle: BillingCycle = credits === 720 || credits === 1920 || credits === 4320 ? "annual" : "monthly";

    return {
        packageName: tier === "unknown" ? "Team Plan Purchase" : normalizePackageName(tier),
        billingCycle,
        isExtraSeatPurchase: false,
        seatUnits: 0,
        tier,
    };
}

/**
 * Payment History Controller
 * Shows all transactions, subscriptions, and invoices for a user
 */
export class PaymentHistoryController {
    /**
     * GET /api/payments/history
     * Get complete payment history including subscriptions
     */
    static async getPaymentHistory(req: Request, res: Response) {
        try {
            const userId = req.user?.id;

            if (!userId) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            const [subscriptions, ownedTeams, addonPayments] = await Promise.all([
                prisma.user_credit_purchase.findMany({
                    where: { user_id: userId },
                    include: { package: true },
                    orderBy: { created_at: "desc" },
                }),
                prisma.teams.findMany({
                    where: {
                        owner_id: userId,
                        deleted_at: null,
                    },
                    select: {
                        id: true,
                        name: true,
                    },
                }),
                prisma.payment.findMany({
                    where: { user_id: userId, status: "PAID" },
                    orderBy: { created_at: "desc" },
                }),
            ]);

            const ownedTeamIds = ownedTeams.map((team) => team.id);
            const teamPurchases = ownedTeamIds.length > 0
                ? await prisma.team_purchase.findMany({
                    where: {
                        team_id: { in: ownedTeamIds },
                    },
                    include: {
                        team: {
                            select: {
                                id: true,
                                name: true,
                            },
                        },
                    },
                    orderBy: { created_at: "desc" },
                })
                : [];

            const personalExtraSeats = subscriptions
                .filter((purchase) => purchase.status === "completed" && isExtraSeatPackageName(purchase.package.name))
                .reduce((sum, purchase) => sum + Math.max(0, Number(purchase.amount || 0)), 0);

            const teamExtraSeatsByTeamId = teamPurchases.reduce<Record<string, number>>((acc, purchase) => {
                if (purchase.status !== "completed") return acc;
                const inferred = inferTeamPurchaseMeta({ amount: purchase.amount, priceUsd: purchase.price_usd });
                if (!inferred.isExtraSeatPurchase) return acc;
                acc[purchase.team_id] = (acc[purchase.team_id] || 0) + Math.max(0, inferred.seatUnits);
                return acc;
            }, {});

            const personalTransactions = subscriptions.map((sub) => {
                const resolvedStatus = (sub.status === 'pending' && sub.stripe_session_id) ? 'in_process' : sub.status;
                const packageName = sub.package.name;
                const tier = getPlanTierFromPackageName(packageName);
                const billingCycle = getBillingCycleFromPackageName(packageName);
                const amount = resolveAmountWithFallback({
                    amount: Number(sub.price_usd || 0),
                    tier,
                    billingCycle,
                    packageFallbackPrice: Number(sub.package.price || 0),
                });
                return {
                id: sub.id,
                type: "subscription",
                scope: "personal",
                packageName: normalizePackageName(packageName),
                credits: sub.amount,
                amount,
                status: resolvedStatus,
                autoRenewal: sub.autoRenewEnabled,
                renewalCount: sub.renewalCount,
                createdAt: sub.created_at,
                completedAt: sub.completed_at,
                nextRenewalDate: sub.nextRenewalDate,
                cancelledAt: sub.cancelledAt,
                cancellationReason: sub.cancellationReason,
                stripeInvoiceId: sub.stripe_invoice_id,
                billingCycle,
                isExtraSeatPurchase: isExtraSeatPackageName(packageName),
                seatUnits: isExtraSeatPackageName(packageName) ? Math.max(0, sub.amount) : 0,
                seatCapacityLabel: formatSeatCapacity({
                    tier,
                    extraSeats: personalExtraSeats,
                    isExtraSeatPurchase: isExtraSeatPackageName(packageName),
                    seatUnits: isExtraSeatPackageName(packageName) ? Math.max(0, sub.amount) : 0,
                }),
                teamId: null,
                teamName: null,
            };
            });

            const teamTransactions = teamPurchases.map((purchase) => {
                const inferred = inferTeamPurchaseMeta({ amount: purchase.amount, priceUsd: purchase.price_usd });
                const amount = resolveAmountWithFallback({
                    amount: Number(purchase.price_usd || 0),
                    tier: inferred.tier,
                    billingCycle: inferred.billingCycle,
                });
                return {
                    id: purchase.id,
                    type: "team_purchase",
                    scope: "team",
                    packageName: inferred.packageName,
                    credits: inferred.isExtraSeatPurchase ? 0 : purchase.amount,
                    amount,
                    status: (purchase.status === 'pending' && purchase.stripe_session_id) ? 'in_process' : purchase.status,
                    autoRenewal: inferred.isExtraSeatPurchase ? true : false,
                    renewalCount: 0,
                    createdAt: purchase.created_at,
                    completedAt: purchase.completed_at,
                    nextRenewalDate: null,
                    cancelledAt: null,
                    cancellationReason: null,
                    stripeInvoiceId: purchase.stripe_invoice_id,
                    billingCycle: inferred.billingCycle as any,
                    isExtraSeatPurchase: inferred.isExtraSeatPurchase,
                    seatUnits: inferred.seatUnits,
                    seatCapacityLabel: formatSeatCapacity({
                        tier: inferred.tier,
                        extraSeats: teamExtraSeatsByTeamId[purchase.team_id] || 0,
                        isExtraSeatPurchase: inferred.isExtraSeatPurchase,
                        seatUnits: inferred.seatUnits,
                    }),
                    teamId: purchase.team_id,
                    teamName: purchase.team?.name || null,
                };
            });

            const addonTransactions = addonPayments.map((payment) => {
                return {
                    id: payment.id,
                    type: "addon",
                    scope: "personal",
                    packageName: "Physical Staging Add-On",
                    credits: 0,
                    amount: Number(payment.amount || 0),
                    status: payment.status.toLowerCase() === "paid" ? "completed" : payment.status.toLowerCase(),
                    autoRenewal: false,
                    renewalCount: 0,
                    createdAt: payment.created_at,
                    completedAt: payment.created_at,
                    nextRenewalDate: null,
                    cancelledAt: null,
                    cancellationReason: null,
                    stripeInvoiceId: null,
                    billingCycle: "one_time" as any,
                    isExtraSeatPurchase: false,
                    seatUnits: 0,
                    seatCapacityLabel: "-",
                    teamId: null,
                    teamName: null,
                };
            });

            // For extra seat purchases, fetch Stripe subscription to get auto-renewal status
            const transactionsWithAutoRenewal = await Promise.all(
                ([] as any[]).concat(personalTransactions)
                    .concat(teamTransactions)
                    .concat(addonTransactions)
                    .map(async (transaction) => {
                        if (transaction.type === "team_purchase" && transaction.isExtraSeatPurchase) {
                            const purchase = teamPurchases.find((p) => p.id === transaction.id);
                            if (purchase?.stripe_subscription_id && stripe) {
                                try {
                                    const subscription = await stripe.subscriptions.retrieve(purchase.stripe_subscription_id);
                                    const autoRenewFromMetadata = String(subscription.metadata?.seatAutoRenew || "true").toLowerCase() !== "false";
                                    return { ...transaction, autoRenewal: autoRenewFromMetadata };
                                } catch (error) {
                                    console.error("Failed to fetch subscription for auto-renewal status:", error);
                                    return { ...transaction, autoRenewal: false };
                                }
                            }
                        }
                        return transaction;
                    })
            );

            const transactions = transactionsWithAutoRenewal.sort((a, b) => {
                const aDate = new Date(a.completedAt || a.createdAt).getTime();
                const bDate = new Date(b.completedAt || b.createdAt).getTime();
                return bDate - aDate;
            });

            return res.status(200).json({
                success: true,
                data: {
                    userId,
                    totalTransactions: transactions.length,
                    totalSpent: transactions
                        .filter((transaction) => transaction.status === "completed" || transaction.status === "paid")
                        .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0),
                    transactions,
                },
            });
        } catch (error) {
            console.error("Error fetching payment history:", error);
            return res.status(500).json({ error: "Failed to fetch payment history" });
        }
    }

    /**
     * GET /api/payments/invoices
     * Get list of all invoices with optional filtering and search
     * Query params:
     * - limit: number of invoices to return (default 20)
     * - search: search by invoice number or package name
     * - dateFrom: filter invoices from this date (ISO string)
     * - dateTo: filter invoices until this date (ISO string)
     * - minAmount: filter invoices with amount >= minAmount
     * - maxAmount: filter invoices with amount <= maxAmount
     */
    static async getInvoices(req: Request, res: Response) {
        try {
            const userId = req.user?.id;

            if (!userId) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            const limit = parseInt(req.query.limit as string) || 20;
            const search = (req.query.search as string)?.toLowerCase().trim() || "";
            const dateFrom = req.query.dateFrom ? new Date(req.query.dateFrom as string) : null;
            const dateTo = req.query.dateTo ? new Date(req.query.dateTo as string) : null;
            const minAmount = req.query.minAmount ? parseFloat(req.query.minAmount as string) : null;
            const maxAmount = req.query.maxAmount ? parseFloat(req.query.maxAmount as string) : null;

            const whereClause: any = {
                user_id: userId,
                status: "completed",
            };

            // Add date range filtering
            if (dateFrom || dateTo) {
                whereClause.completed_at = {};
                if (dateFrom) {
                    whereClause.completed_at.gte = dateFrom;
                }
                if (dateTo) {
                    const endOfDay = new Date(dateTo);
                    endOfDay.setHours(23, 59, 59, 999);
                    whereClause.completed_at.lte = endOfDay;
                }
            }

            const addonWhereClause: any = {
                user_id: userId,
                status: "PAID",
            };
            if (dateFrom || dateTo) {
                addonWhereClause.created_at = {};
                if (dateFrom) {
                    addonWhereClause.created_at.gte = dateFrom;
                }
                if (dateTo) {
                    const endOfDay = new Date(dateTo);
                    endOfDay.setHours(23, 59, 59, 999);
                    addonWhereClause.created_at.lte = endOfDay;
                }
            }

            const [subscriptions, ownedTeams, addonPayments] = await Promise.all([
                prisma.user_credit_purchase.findMany({
                    where: whereClause,
                    include: { package: true },
                    orderBy: { completed_at: "desc" },
                    take: limit * 3,
                }),
                prisma.teams.findMany({
                    where: {
                        owner_id: userId,
                        deleted_at: null,
                    },
                    select: {
                        id: true,
                        name: true,
                    },
                }),
                prisma.payment.findMany({
                    where: addonWhereClause,
                    orderBy: { created_at: "desc" },
                    take: limit * 3,
                }),
            ]);

            const invoiceRows = await prisma.invoice.findMany({
                where: { user_id: userId },
                orderBy: { created_at: "desc" },
                take: limit * 3,
            });
            const invoiceRowBySubscriptionId = new Map(invoiceRows.map((row) => [row.subscription_id, row]));

            const ownedTeamIds = ownedTeams.map((team) => team.id);
            const teamPurchases = ownedTeamIds.length > 0
                ? await prisma.team_purchase.findMany({
                    where: {
                        team_id: { in: ownedTeamIds },
                        status: "completed",
                    },
                    include: {
                        team: {
                            select: {
                                id: true,
                                name: true,
                            },
                        },
                    },
                    orderBy: { completed_at: "desc" },
                    take: limit * 3,
                })
                : [];

            const personalExtraSeats = subscriptions
                .filter((purchase) => purchase.status === "completed" && isExtraSeatPackageName(purchase.package.name))
                .reduce((sum, purchase) => sum + Math.max(0, Number(purchase.amount || 0)), 0);

            const teamExtraSeatsByTeamId = teamPurchases.reduce<Record<string, number>>((acc, purchase) => {
                if (purchase.status !== "completed") return acc;
                const inferred = inferTeamPurchaseMeta({ amount: purchase.amount, priceUsd: purchase.price_usd });
                if (!inferred.isExtraSeatPurchase) return acc;
                acc[purchase.team_id] = (acc[purchase.team_id] || 0) + Math.max(0, inferred.seatUnits);
                return acc;
            }, {});

            const personalInvoices = subscriptions.map((sub, index) => {
                const invoiceRow = invoiceRowBySubscriptionId.get(sub.id) as any;
                const invoiceMetadata = (invoiceRow?.metadata || {}) as Record<string, any>;
                const packageName = sub.package.name;
                const tier = getPlanTierFromPackageName(packageName);
                const billingCycle = getBillingCycleFromPackageName(packageName);
                const amount = resolveAmountWithFallback({
                    amount: Number(invoiceRow?.amount || sub.price_usd || 0),
                    tier,
                    billingCycle,
                    packageFallbackPrice: Number(sub.package.price || 0),
                });
                // compute dateSubscribed and validTill
                const dateSubscribed = invoiceMetadata.dateSubscribed ? new Date(invoiceMetadata.dateSubscribed) : sub.created_at || sub.completed_at || new Date();
                let validTill: Date | null = null;
                if (invoiceMetadata.validTill) {
                    validTill = new Date(invoiceMetadata.validTill);
                } else if (dateSubscribed) {
                    const base = new Date(dateSubscribed);
                    if (billingCycle === "monthly") {
                        validTill = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000);
                    } else if (billingCycle === "annual") {
                        validTill = new Date(base.getTime() + 365 * 24 * 60 * 60 * 1000);
                    }
                }

                return {
                    id: `INV-P-${sub.id}`,
                    subscriptionId: sub.id,
                    invoiceNumber: invoiceMetadata.invoiceNumber || sub.stripe_invoice_id || `INV-P-${subscriptions.length - index}`,
                    packageName: invoiceMetadata.packageName || normalizePackageName(packageName),
                    credits: sub.amount,
                    amount,
                    issueDate: invoiceRow?.created_at || sub.completed_at,
                    dueDate: invoiceRow?.created_at || sub.completed_at,
                    status: "paid",
                    renewalNumber: (invoiceMetadata.renewalNumber ?? sub.renewalCount) || 0,
                    nextBillingDate: sub.nextRenewalDate,
                    billingCycle: invoiceMetadata.billingCycle || billingCycle,
                    scope: "personal",
                    planFor: invoiceMetadata.planFor || "personal",
                    autoRenewal: typeof invoiceMetadata.autoRenewal === "boolean" ? invoiceMetadata.autoRenewal : !!sub.autoRenewEnabled,
                    dateSubscribed: dateSubscribed,
                    validTill: validTill,
                    teamName: null,
                    isExtraSeatPurchase: isExtraSeatPackageName(packageName),
                    seatUnits: isExtraSeatPackageName(packageName) ? Math.max(0, sub.amount) : 0,
                    seatCapacityLabel: formatSeatCapacity({
                        tier,
                        extraSeats: personalExtraSeats,
                        isExtraSeatPurchase: isExtraSeatPackageName(packageName),
                        seatUnits: isExtraSeatPackageName(packageName) ? Math.max(0, sub.amount) : 0,
                    }),
                    previewAvailable: Boolean(invoiceMetadata.stripeInvoicePdfUrl || invoiceMetadata.stripeInvoiceHostedUrl || invoiceRow?.html_content),
                    stripeInvoicePdfUrl: invoiceMetadata.stripeInvoicePdfUrl || null,
                    stripeInvoiceHostedUrl: invoiceMetadata.stripeInvoiceHostedUrl || null,
                };
            });

            const teamInvoices = teamPurchases.map((purchase, index) => {
                const inferred = inferTeamPurchaseMeta({ amount: purchase.amount, priceUsd: purchase.price_usd });
                const amount = resolveAmountWithFallback({
                    amount: Number(purchase.price_usd || 0),
                    tier: inferred.tier,
                    billingCycle: inferred.billingCycle,
                });
                const dateSubscribed = purchase.created_at || purchase.completed_at || new Date();
                let validTill: Date | null = null;
                if (dateSubscribed) {
                    const base = new Date(dateSubscribed);
                    if (inferred.billingCycle === "monthly") {
                        validTill = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000);
                    } else if (inferred.billingCycle === "annual") {
                        validTill = new Date(base.getTime() + 365 * 24 * 60 * 60 * 1000);
                    }
                }

                return {
                    id: `INV-T-${purchase.id}`,
                    subscriptionId: purchase.id,
                    invoiceNumber: purchase.stripe_invoice_id || `INV-T-${teamPurchases.length - index}`,
                    packageName: inferred.packageName,
                    credits: inferred.isExtraSeatPurchase ? 0 : purchase.amount,
                    amount,
                    issueDate: purchase.completed_at,
                    dueDate: purchase.completed_at,
                    status: "paid",
                    renewalNumber: 0,
                    nextBillingDate: null,
                    billingCycle: inferred.billingCycle as any,
                    scope: "team",
                    planFor: "team",
                    autoRenewal: false,
                    dateSubscribed: dateSubscribed,
                    validTill: validTill,
                    teamName: purchase.team?.name || null as any,
                    isExtraSeatPurchase: inferred.isExtraSeatPurchase,
                    seatUnits: inferred.seatUnits,
                    seatCapacityLabel: formatSeatCapacity({
                        tier: inferred.tier,
                        extraSeats: teamExtraSeatsByTeamId[purchase.team_id] || 0,
                        isExtraSeatPurchase: inferred.isExtraSeatPurchase,
                        seatUnits: inferred.seatUnits,
                    }),
                    previewAvailable: false,
                };
            });

            const addonInvoices = addonPayments.map((payment, index) => {
                const dateSubscribed = payment.created_at || new Date();
                return {
                    id: `INV-A-${payment.id}`,
                    subscriptionId: payment.id,
                    invoiceNumber: `INV-A-${addonPayments.length - index}`,
                    packageName: "Physical Staging Add-On",
                    credits: 0,
                    amount: Number(payment.amount || 0),
                    issueDate: payment.created_at,
                    dueDate: payment.created_at,
                    status: "paid",
                    renewalNumber: 0,
                    nextBillingDate: null,
                    billingCycle: "one_time",
                    scope: "personal",
                    planFor: "personal",
                    autoRenewal: false,
                    dateSubscribed: dateSubscribed,
                    validTill: null,
                    teamName: null,
                    isExtraSeatPurchase: false,
                    seatUnits: 0,
                    seatCapacityLabel: "-",
                    previewAvailable: false,
                };
            });

            // For extra seat invoices, fetch Stripe subscription to get auto-renewal status
            const invoicesWithAutoRenewal = await Promise.all(
                ([] as any[]).concat(personalInvoices)
                    .concat(teamInvoices)
                    .concat(addonInvoices)
                    .map(async (invoice) => {
                        if (invoice.id.startsWith("INV-T-") && invoice.isExtraSeatPurchase) {
                            const purchase = teamPurchases.find((p) => p.id === invoice.subscriptionId);
                            if (purchase?.stripe_subscription_id && stripe) {
                                try {
                                    const subscription = await stripe.subscriptions.retrieve(purchase.stripe_subscription_id);
                                    // Note: invoices don't have autoRenewal field in response type, but we can add it for consistency
                                    return invoice;
                                } catch (error) {
                                    console.error("Failed to fetch subscription for invoice auto-renewal:", error);
                                    return invoice;
                                }
                            }
                        }
                        return invoice;
                    })
            );

            let invoices = invoicesWithAutoRenewal
                .sort((a, b) => {
                    const aDate = new Date(a.issueDate || 0).getTime();
                    const bDate = new Date(b.issueDate || 0).getTime();
                    return bDate - aDate;
                })
                .filter((invoice) => {
                    if (search) {
                        const searchMatch =
                            invoice.invoiceNumber.toLowerCase().includes(search) ||
                            invoice.packageName.toLowerCase().includes(search) ||
                            String(invoice.teamName || "").toLowerCase().includes(search);
                        if (!searchMatch) return false;
                    }

                    if (minAmount !== null && invoice.amount < minAmount) return false;
                    if (maxAmount !== null && invoice.amount > maxAmount) return false;

                    return true;
                })
                .slice(0, limit);

            return res.status(200).json({
                success: true,
                data: {
                    userId,
                    totalInvoices: invoices.length,
                    invoices,
                },
            });
        } catch (error) {
            console.error("Error fetching invoices:", error);
            return res.status(500).json({ error: "Failed to fetch invoices" });
        }
    }

    /**
     * GET /api/payments/invoices/:subscriptionId/preview
     * Get invoice preview (HTML)
     */
    static async getInvoicePreview(req: Request, res: Response) {
        try {
            const { subscriptionId } = req.params;
            const userId = req.user?.id;

            if (!userId) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            // Get subscription details
            const subscription = await prisma.user_credit_purchase.findUnique({
                where: { id: subscriptionId },
                include: { user: true, package: true },
            });

            if (!subscription) {
                return res.status(404).json({ error: "Subscription not found" });
            }

            // Verify ownership
            if (subscription.user_id !== userId) {
                return res.status(403).json({
                    error: "You do not have access to this invoice",
                });
            }

            // Import invoice service
            const InvoiceService = (await import("../services/invoice.service"))
                .default;

            const invoiceData = {
                invoiceId: `INV-${subscription.id}`,
                subscriptionId: subscription.id,
                userId: subscription.user_id,
                packageName: subscription.package.name,
                credits: subscription.amount,
                amount: subscription.price_usd,
                currency: "usd",
                issueDate: subscription.completed_at || new Date(),
                dueDate: subscription.completed_at || new Date(),
                renewalNumber: subscription.renewalCount || 0,
                userName: subscription.user.name || "Valued Customer",
                userEmail: subscription.user.email,
                companyName: "Elevated Spaces",
                billingCycle: (subscription.package.name.toLowerCase().includes("annual") ? "annual" : "monthly") as "monthly" | "annual",
                planFor: "personal" as const,
                autoRenewal: !!subscription.autoRenewEnabled,
                seatCapacityLabel: `${subscription.amount} Credits`,
                dateSubscribed: subscription.created_at || subscription.completed_at || new Date(),
                validTill: subscription.completed_at
                    ? new Date(new Date(subscription.completed_at).getTime() + 30 * 24 * 60 * 60 * 1000)
                    : null,
            };

            const invoiceHTML = InvoiceService.generateInvoiceHTML(invoiceData);

            return res.status(200).json({
                success: true,
                data: {
                    subscriptionId,
                    invoiceId: invoiceData.invoiceId,
                    html: invoiceHTML,
                },
            });
        } catch (error) {
            console.error("Error generating invoice preview:", error);
            return res.status(500).json({
                error: "Failed to generate invoice preview",
            });
        }
    }

    /**
     * GET /api/payments/summary
     * Get payment summary/stats
     */
    static async getPaymentSummary(req: Request, res: Response) {
        try {
            const userId = req.user?.id;

            if (!userId) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            // Get all purchases
            const purchases = await prisma.user_credit_purchase.findMany({
                where: { user_id: userId },
                include: { package: true },
            });

            const ownedTeams = await prisma.teams.findMany({
                where: {
                    owner_id: userId,
                    deleted_at: null,
                },
                select: { id: true },
            });

            const ownedTeamIds = ownedTeams.map((team) => team.id);
            const teamPurchases = ownedTeamIds.length > 0
                ? await prisma.team_purchase.findMany({
                    where: {
                        team_id: { in: ownedTeamIds },
                    },
                })
                : [];


            const completed = purchases.filter((p) => p.status === "completed");
            const pending = purchases.filter((p) => p.status === "pending");
            const failed = purchases.filter((p) => p.status === "failed");
            const activeCandidates = purchases.filter(
                (p) => isSubscriptionEffectivelyActive(p)
            );
            const active: typeof activeCandidates = [];

            console.log('[DEBUG] getPaymentSummary - completed purchases:', completed.length);
            console.log('[DEBUG] getPaymentSummary - activeCandidates:', activeCandidates.map(p => ({
                id: p.id,
                package: p.package?.name,
                status: p.status,
                autoRenewEnabled: p.autoRenewEnabled,
                cancelledAt: p.cancelledAt,
                completed_at: p.completed_at,
                stripe_session_id: p.stripe_session_id ? '***' : null,
            })));

            for (const purchase of activeCandidates) {
                if (!purchase.stripe_session_id) {
                    console.log('[DEBUG] Marking purchase as cancelled - no stripe_session_id:', purchase.id);
                    await prisma.user_credit_purchase.updateMany({
                        where: {
                            id: purchase.id,
                            cancelledAt: null,
                        },
                        data: {
                            autoRenewEnabled: false,
                            cancelledAt: new Date(),
                            cancellationReason: "Auto-synced: missing Stripe session id",
                            nextRenewalDate: null,
                        },
                    });
                    continue;
                }

                // If auto-renew is disabled, don't validate against Stripe
                // The subscription is still valid within grace period
                if (!purchase.autoRenewEnabled) {
                    console.log('[DEBUG] Auto-renew disabled for purchase, accepting as active:', purchase.id);
                    active.push(purchase);
                    continue;
                }

                if (!stripe) {
                    active.push(purchase);
                    continue;
                }

                try {
                    const session = await stripe.checkout.sessions.retrieve(purchase.stripe_session_id);
                    const subscriptionId = typeof session.subscription === "string"
                        ? session.subscription
                        : session.subscription?.id;

                    if (!subscriptionId) {
                        console.log('[DEBUG] No subscription ID found for purchase:', purchase.id);
                        await prisma.user_credit_purchase.updateMany({
                            where: {
                                id: purchase.id,
                                cancelledAt: null,
                            },
                            data: {
                                autoRenewEnabled: false,
                                cancelledAt: new Date(),
                                cancellationReason: "Auto-synced from Stripe: checkout has no subscription",
                                nextRenewalDate: null,
                            },
                        });
                        continue;
                    }

                    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
                    const isStripeActive =
                        subscription.status === "active" ||
                        subscription.status === "trialing" ||
                        subscription.status === "past_due";

                    console.log('[DEBUG] Stripe validation - purchase:', purchase.id, 'status:', subscription.status, 'isActive:', isStripeActive);

                    if (isStripeActive) {
                        active.push(purchase);
                        continue;
                    }

                    console.log('[DEBUG] Marking purchase as cancelled due to Stripe status:', purchase.id, subscription.status);
                    await prisma.user_credit_purchase.updateMany({
                        where: {
                            id: purchase.id,
                            cancelledAt: null,
                        },
                        data: {
                            autoRenewEnabled: false,
                            cancelledAt: new Date(),
                            cancellationReason: `Auto-synced from Stripe status: ${subscription.status}`,
                            nextRenewalDate: null,
                        },
                    });
                } catch (error: any) {
                    const isMissingSubscription =
                        error?.type === "StripeInvalidRequestError" &&
                        error?.code === "resource_missing";

                    if (isMissingSubscription) {
                        console.log('[DEBUG] Stripe subscription not found for purchase:', purchase.id);
                        await prisma.user_credit_purchase.updateMany({
                            where: {
                                id: purchase.id,
                                cancelledAt: null,
                            },
                            data: {
                                autoRenewEnabled: false,
                                cancelledAt: new Date(),
                                cancellationReason: "Auto-synced from Stripe: subscription not found",
                                nextRenewalDate: null,
                            },
                        });
                        continue;
                    }

                    // Fall back to DB state on transient Stripe failures.
                    console.log('[DEBUG] Stripe error for purchase, using DB state:', purchase.id, error.message);
                    active.push(purchase);
                }
            }
            const cancelled = purchases.filter((p) => p.cancelledAt);

            const completedTeamPurchases = teamPurchases.filter((purchase) => purchase.status === "completed");
            const totalSpent = completed.reduce(
                (sum, purchase) => sum + (purchase.price_usd * (1 + purchase.renewalCount)),
                0
            ) + completedTeamPurchases.reduce((sum, purchase) => sum + purchase.price_usd, 0);

            const totalCredits = completed.reduce((sum, p) => sum + p.amount, 0);
            const totalRenewals = completed.reduce(
                (sum, p) => sum + p.renewalCount,
                0
            );

            const recentTransactions = [
                ...completed.map((purchase) => ({
                    id: purchase.id,
                    package: normalizePackageName(purchase.package.name),
                    amount: purchase.price_usd,
                    date: purchase.completed_at,
                })),
                ...completedTeamPurchases.map((purchase) => {
                    const inferred = inferTeamPurchaseMeta({ amount: purchase.amount, priceUsd: purchase.price_usd });
                    return {
                        id: purchase.id,
                        package: inferred.packageName,
                        amount: purchase.price_usd,
                        date: purchase.completed_at,
                    };
                }),
            ]
                .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
                .slice(0, 5);

            return res.status(200).json({
                success: true,
                data: {
                    summary: {
                        totalPurchases: purchases.length + teamPurchases.length,
                        totalSpent: parseFloat(totalSpent.toFixed(2)),
                        totalCredits,
                        totalRenewals,
                        averageTransactionValue: parseFloat(
                            (totalSpent / Math.max(1, completed.length + completedTeamPurchases.length)).toFixed(2)
                        ),
                    },
                    breakdown: {
                        completed: completed.length + completedTeamPurchases.length,
                        pending: pending.length,
                        failed: failed.length,
                        active: active.length,
                        cancelled: cancelled.length,
                    },
                    activeSubscriptions: active.map((sub) => ({
                        id: sub.id,
                        package: sub.package.name,
                        credits: sub.amount,
                        monthlyAmount: sub.price_usd,
                        nextRenewal: sub.nextRenewalDate,
                        renewals: sub.renewalCount,
                        cancelledAt: sub.cancelledAt,
                        autoRenewEnabled: sub.autoRenewEnabled,
                        completedAt: sub.completed_at,
                    })),
                    recentTransactions,
                },
            });
        } catch (error) {
            console.error("Error fetching payment summary:", error);
            return res.status(500).json({
                error: "Failed to fetch payment summary",
            });
        }
    }
}

export default PaymentHistoryController;
