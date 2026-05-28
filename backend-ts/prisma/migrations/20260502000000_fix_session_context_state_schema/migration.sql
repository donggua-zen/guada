-- DropIndex
DROP INDEX "global_settings_key_user_id_key";

-- DropIndex
DROP INDEX "global_settings_user_id_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "global_settings";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_bot_instance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "platform_config" JSONB NOT NULL,
    "additional_kwargs" JSONB,
    "reconnect_enabled" BOOLEAN NOT NULL DEFAULT true,
    "max_retries" INTEGER NOT NULL DEFAULT 5,
    "retry_interval" INTEGER NOT NULL DEFAULT 5000,
    "default_character_id" TEXT NOT NULL,
    "default_model_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'stopped',
    "last_started_at" DATETIME,
    "last_error" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "bot_instance_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_bot_instance" ("created_at", "default_character_id", "default_model_id", "enabled", "id", "last_error", "last_started_at", "max_retries", "name", "platform", "reconnect_enabled", "retry_interval", "status", "updated_at", "user_id") SELECT "created_at", "default_character_id", "default_model_id", "enabled", "id", "last_error", "last_started_at", "max_retries", "name", "platform", "reconnect_enabled", "retry_interval", "status", "updated_at", "user_id" FROM "bot_instance";
DROP TABLE "bot_instance";
ALTER TABLE "new_bot_instance" RENAME TO "bot_instance";
CREATE INDEX "bot_instance_user_id_idx" ON "bot_instance"("user_id");
CREATE INDEX "bot_instance_platform_idx" ON "bot_instance"("platform");
CREATE INDEX "bot_instance_status_idx" ON "bot_instance"("status");
CREATE TABLE "new_model" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "provider_id" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "model_type" TEXT NOT NULL,
    "config" JSONB,
    "is_favorite" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "model_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "model_provider" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_model" ("config", "created_at", "id", "model_name", "model_type", "name", "provider_id", "updated_at") SELECT "config", "created_at", "id", "model_name", "model_type", "name", "provider_id", "updated_at" FROM "model";
DROP TABLE "model";
ALTER TABLE "new_model" RENAME TO "model";
CREATE TABLE "new_session_context_state" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "session_id" TEXT NOT NULL,
    "summary_content" TEXT,
    "last_compacted_message_id" TEXT,
    "last_compacted_content_id" TEXT,
    "last_pruned_content_id" TEXT,
    "pruning_metadata" JSONB,
    "cleaning_strategy" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "session_context_state_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_session_context_state" ("cleaning_strategy", "created_at", "id", "session_id", "summary_content", "updated_at") SELECT "cleaning_strategy", "created_at", "id", "session_id", "summary_content", "updated_at" FROM "session_context_state";
DROP TABLE "session_context_state";
ALTER TABLE "new_session_context_state" RENAME TO "session_context_state";
CREATE UNIQUE INDEX "session_context_state_session_id_key" ON "session_context_state"("session_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

