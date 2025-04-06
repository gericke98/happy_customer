-- Add the shop for shameless-test.myshopify.com
INSERT INTO "shops" ("id", "name", "domain", "is_active", "created_at", "updated_at")
VALUES (
  'shameless-test',
  'Shameless Test',
  'shameless-test.myshopify.com',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO UPDATE
SET "is_active" = true, "updated_at" = CURRENT_TIMESTAMP; 