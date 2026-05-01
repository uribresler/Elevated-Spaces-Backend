ALTER TABLE "team_membership"
ADD COLUMN "is_paid_extra_seat" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "seat_auto_renew" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "seat_last_paid_at" TIMESTAMP(3),
ADD COLUMN "seat_expires_at" TIMESTAMP(3),
ADD COLUMN "seat_payment_product_key" TEXT;
