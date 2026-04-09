-- AlterTable
ALTER TABLE "global_settings" ADD COLUMN "user_id" TEXT;

-- CreateIndex
CREATE INDEX "global_settings_user_id_idx" ON "global_settings"("user_id");

-- DropIndex
DROP INDEX "global_settings_key_key";

-- CreateIndex
CREATE UNIQUE INDEX "global_settings_key_user_id_key" ON "global_settings"("key", "user_id");
