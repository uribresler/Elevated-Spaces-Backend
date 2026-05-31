-- Add Stripe PDF URL to invoice table
ALTER TABLE "invoice" ADD COLUMN "stripe_invoice_pdf_url" TEXT;

-- Backfill from existing invoice metadata when available
UPDATE "invoice"
SET "stripe_invoice_pdf_url" = metadata->>'stripeInvoicePdfUrl'
WHERE metadata ? 'stripeInvoicePdfUrl'
  AND ("stripe_invoice_pdf_url" IS NULL OR "stripe_invoice_pdf_url" = '');
