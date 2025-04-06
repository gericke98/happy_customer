-- Add the allowed origin for shameless-test.myshopify.com
INSERT INTO "allowed_origins" ("origin", "shop_id", "is_active", "created_at", "updated_at")
VALUES (
  'https://shameless-test.myshopify.com',
  'shameless-test',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("origin") DO UPDATE
SET "is_active" = true, "updated_at" = CURRENT_TIMESTAMP; 