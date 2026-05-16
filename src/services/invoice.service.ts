import prisma from "../dbConnection";
import { sendEmail } from "../config/mail.config";

export interface InvoiceData {
    invoiceId: string;
    subscriptionId: string;
    userId: string;
    packageName: string;
    credits: number;
    amount: number;
    currency: string;
    issueDate: Date;
    dueDate: Date;
    renewalNumber: number;
    userName: string;
    userEmail: string;
    companyName: string;
    billingCycle?: "monthly" | "annual" | "one_time";
    planFor?: "personal" | "team";
    autoRenewal?: boolean;
    seatCapacityLabel?: string;
    teamName?: string | null;
    dateSubscribed?: Date;
    validTill?: Date | null;
    hostedInvoiceUrl?: string | null;
    invoicePdfUrl?: string | null;
}

/**
 * Invoice Generation Service
 * Handles creation and delivery of PDF invoices
 */
export class InvoiceService {
    /**
     * Generate invoice HTML (for browser preview or PDF conversion)
     */
    static generateInvoiceHTML(data: InvoiceData): string {
        const billingLabel = data.billingCycle === "annual"
            ? "Annual"
            : data.billingCycle === "one_time"
                ? "One-time"
                : "Monthly";
        const planForLabel = data.planFor === "team" ? "Team" : "Personal";
        const autoRenewalLabel = data.autoRenewal ? "Enabled" : "Disabled";
        const subscribedDate = (data.dateSubscribed || data.issueDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        const validTillLabel = data.validTill ? data.validTill.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : "-";
        const teamLine = data.teamName ? `<p><strong>Team:</strong> ${data.teamName}</p>` : "";
        const invoiceLinks = [
            data.hostedInvoiceUrl ? `<p><strong>Stripe invoice:</strong> <a href="${data.hostedInvoiceUrl}">${data.hostedInvoiceUrl}</a></p>` : "",
            data.invoicePdfUrl ? `<p><strong>Stripe invoice PDF:</strong> <a href="${data.invoicePdfUrl}">${data.invoicePdfUrl}</a></p>` : "",
        ].filter(Boolean).join("");

        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #111827; background: #f8fafc; }
                    .container { max-width: 940px; margin: 0 auto; padding: 32px 20px 48px; }
                    .sheet { background: #fff; border: 1px solid #e5e7eb; border-radius: 20px; overflow: hidden; box-shadow: 0 24px 60px rgba(15, 23, 42, 0.08); }
                    .topbar { background: linear-gradient(135deg, #4f46e5 0%, #0f172a 100%); color: #fff; padding: 28px 32px; display: flex; justify-content: space-between; gap: 20px; align-items: flex-start; }
                    .company-info h1 { font-size: 24px; margin-bottom: 6px; }
                    .company-info p { font-size: 13px; opacity: 0.85; }
                    .invoice-info { text-align: right; }
                    .invoice-info h2 { font-size: 30px; letter-spacing: 0.08em; margin-bottom: 8px; }
                    .invoice-info p { font-size: 13px; line-height: 1.65; opacity: 0.92; }
                    .content { padding: 28px 32px 34px; }
                    .meta-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 22px; }
                    .meta-card { background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 14px; padding: 14px 16px; }
                    .meta-label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #6b7280; margin-bottom: 4px; }
                    .meta-value { font-size: 14px; font-weight: 600; color: #111827; }
                    .customer-section { margin: 28px 0 20px; }
                    .section-title { font-size: 12px; font-weight: 700; color: #4f46e5; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 10px; }
                    .customer-info { font-size: 13px; line-height: 1.7; color: #374151; }
                    .pills { display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0 24px; }
                    .pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 7px 12px; font-size: 12px; font-weight: 600; background: #eef2ff; color: #3730a3; }
                    .pill.gray { background: #f3f4f6; color: #374151; }
                    .items-table { width: 100%; margin: 24px 0; border-collapse: collapse; }
                    .items-table th { background-color: #f9fafb; padding: 12px 10px; text-align: left; font-size: 12px; font-weight: 700; color: #374151; border-bottom: 1px solid #e5e7eb; }
                    .items-table td { padding: 14px 10px; font-size: 13px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
                    .text-right { text-align: right; }
                    .summary { margin: 28px 0 0; display: flex; justify-content: flex-end; }
                    .summary-box { width: min(340px, 100%); }
                    .summary-row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 13px; border-bottom: 1px solid #e5e7eb; color: #374151; }
                    .summary-row.total { font-weight: 700; font-size: 16px; border-bottom: 0; color: #111827; padding-top: 14px; }
                    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #6b7280; text-align: center; line-height: 1.6; }
                    .links { margin-top: 14px; font-size: 12px; line-height: 1.7; }
                    .links a { color: #4f46e5; word-break: break-all; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="sheet">
                        <div class="topbar">
                            <div class="company-info">
                                <h1>${data.companyName}</h1>
                                <p>Billing and subscription invoice</p>
                            </div>
                            <div class="invoice-info">
                                <h2>INVOICE</h2>
                                <p><strong>Invoice #:</strong> ${data.invoiceId}</p>
                                <p><strong>Renewal #:</strong> ${data.renewalNumber}</p>
                                <p><strong>Issue Date:</strong> ${data.issueDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                                <p><strong>Due Date:</strong> ${data.dueDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                            </div>
                        </div>

                        <div class="content">
                            <div class="meta-grid">
                                <div class="meta-card"><span class="meta-label">Plan Name</span><div class="meta-value">${data.packageName}</div></div>
                                <div class="meta-card"><span class="meta-label">Plan For</span><div class="meta-value">${planForLabel}</div></div>
                                <div class="meta-card"><span class="meta-label">Billing</span><div class="meta-value">${billingLabel}</div></div>
                                <div class="meta-card"><span class="meta-label">Auto-renewal</span><div class="meta-value">${autoRenewalLabel}</div></div>
                                <div class="meta-card"><span class="meta-label">Date Subscribed</span><div class="meta-value">${subscribedDate}</div></div>
                                <div class="meta-card"><span class="meta-label">Valid Till</span><div class="meta-value">${validTillLabel}</div></div>
                            </div>

                            <div class="customer-section">
                                <div class="section-title">Bill To</div>
                                <div class="customer-info">
                                    <p><strong>${data.userName}</strong></p>
                                    <p>${data.userEmail}</p>
                                    ${teamLine}
                                </div>
                            </div>

                            <div class="pills">
                                <span class="pill">${data.seatCapacityLabel || `${data.credits} Credits`}</span>
                                <span class="pill gray">${data.autoRenewal ? "Auto-renewing" : "One-time"}</span>
                                <span class="pill gray">${billingLabel}</span>
                            </div>

                            <table class="items-table">
                                <thead>
                                    <tr>
                                        <th style="width: 50%;">Description</th>
                                        <th style="width: 20%;">Quantity</th>
                                        <th style="width: 15%;" class="text-right">Unit Price</th>
                                        <th style="width: 15%;" class="text-right">Amount</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td>
                                            <strong>${data.packageName} Plan</strong><br>
                                            <span style="font-size: 12px; color: #6b7280;">${data.credits} Credits</span>
                                        </td>
                                        <td>1</td>
                                        <td class="text-right">$${data.amount.toFixed(2)}</td>
                                        <td class="text-right"><strong>$${data.amount.toFixed(2)}</strong></td>
                                    </tr>
                                </tbody>
                            </table>

                            <div class="summary">
                                <div class="summary-box">
                                    <div class="summary-row">
                                        <span>Subtotal:</span>
                                        <span>$${data.amount.toFixed(2)}</span>
                                    </div>
                                    <div class="summary-row">
                                        <span>Tax:</span>
                                        <span>$0.00</span>
                                    </div>
                                    <div class="summary-row total">
                                        <span>Total Due:</span>
                                        <span>$${data.amount.toFixed(2)}</span>
                                    </div>
                                </div>
                            </div>

                            ${invoiceLinks ? `<div class="links">${invoiceLinks}</div>` : ""}

                            <div class="footer">
                                <p><strong>Thank you for your business!</strong></p>
                                <p>This invoice reflects your current subscription details and billing cycle.</p>
                                <p style="margin-top: 12px;"><strong>${data.companyName}</strong> © 2026. All rights reserved.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </body>
            </html>
        `;
    }

    /**
     * Create invoice record in database
     */
    static async createInvoice(data: {
        subscriptionId: string;
        userId: string;
        amount: number;
        status: "generated" | "sent" | "paid";
        htmlContent: string;
        metadata?: Record<string, any>;
    }) {
        try {
            const invoice = await prisma.$executeRawUnsafe(`
                INSERT INTO "invoice" 
                (id, "subscription_id", "user_id", amount, status, "html_content", metadata, "created_at", "updated_at")
                VALUES 
                ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
                RETURNING *
            `, 
            `INV-${Date.now()}`,
            data.subscriptionId,
            data.userId,
            data.amount,
            data.status,
            data.htmlContent,
            JSON.stringify(data.metadata || {})
            );

            return invoice;
        } catch (error) {
            console.error("Error creating invoice record:", error);
            throw error;
        }
    }

    /**
     * Send invoice via email
     */
    static async sendInvoiceEmail(
        to: string,
        userName: string,
        packageName: string,
        invoiceHtml: string,
        amount: number
    ) {
        try {
            await sendEmail({
                from: "noreply@elevatedspaces.com",
                senderName: "Elevated Spaces",
                to,
                subject: `Invoice Confirmation - ${packageName} Subscription Renewal`,
                text: `Your ${packageName} subscription renewal invoice for $${amount.toFixed(2)} is attached. Thank you for your business!`,
                html: `
                    <h2>Invoice Confirmation</h2>
                    <p>Hi ${userName},</p>
                    <p>Your ${packageName} subscription renewal has been processed successfully.</p>
                    <p>Invoice amount: <strong>$${amount.toFixed(2)}</strong></p>
                    <p>Please see the attached invoice for details. Your next billing cycle will renew on the same date next month.</p>
                    <br>
                    <p>Thank you for continuing with Elevated Spaces!</p>
                    <hr>
                    <p style="font-size: 12px; color: #666;">
                        <strong>${packageName} Plan Details:</strong><br>
                        Amount: $${amount.toFixed(2)}<br>
                        Billing: Monthly recurring<br>
                        Status: Active
                    </p>
                `,
            });

            console.log(`Invoice email sent to ${to}`);
        } catch (error) {
            console.error("Error sending invoice email:", error);
            throw error;
        }
    }

    /**
     * Get invoice HTML for display (for preview on frontend)
     */
    static async getInvoicePreview(invoiceId: string) {
        try {
            // This would fetch from DB in production
            // For now, return null for testing
            return null;
        } catch (error) {
            console.error("Error getting invoice preview:", error);
            throw error;
        }
    }

    /**
     * Get user's invoice history
     */
    static async getUserInvoices(userId: string, limit = 10) {
        try {
            const invoices = await prisma.$executeRawUnsafe(`
                SELECT 
                    inv.id,
                    inv."subscription_id",
                    inv.amount,
                    inv.status,
                    inv."created_at",
                    ucp."package_id",
                    cp.name as "package_name",
                    cp.credits
                FROM invoice inv
                JOIN "user_credit_purchase" ucp ON inv."subscription_id" = ucp.id
                JOIN "credit_package" cp ON ucp."package_id" = cp.id
                WHERE inv."user_id" = $1
                ORDER BY inv."created_at" DESC
                LIMIT $2
            `, userId, limit);

            return invoices || [];
        } catch (error) {
            console.error("Error fetching user invoices:", error);
            throw error;
        }
    }
}

export default InvoiceService;
