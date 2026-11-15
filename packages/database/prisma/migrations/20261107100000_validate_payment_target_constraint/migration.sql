-- The preflight for Payment_exactly_one_target_check returned zero violations.
-- Validation scans existing rows and does not modify or delete business data.
ALTER TABLE "Payment"
    VALIDATE CONSTRAINT "Payment_exactly_one_target_check";
