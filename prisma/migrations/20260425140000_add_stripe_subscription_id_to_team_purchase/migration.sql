-- Add stripe_subscription_id to team_purchase table
ALTER TABLE "team_purchase" ADD COLUMN "stripe_subscription_id" TEXT;

-- Create index for faster subscription lookups
CREATE INDEX "team_purchase_stripe_subscription_id_idx" ON "team_purchase"("stripe_subscription_id");
