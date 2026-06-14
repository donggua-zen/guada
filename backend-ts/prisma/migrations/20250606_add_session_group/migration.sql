-- CreateTable
CREATE TABLE "session_group" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT,
    "user_id" TEXT NOT NULL,
    "avatar_url" TEXT,
    "description" TEXT,
    "model_id" TEXT,
    "character_id" TEXT,
    "group_id" TEXT,
    "settings" JSONB,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "last_active_at" DATETIME,
    "session_type" TEXT DEFAULT 'web',
    "bot_id" TEXT,
    "platform" TEXT,
    "external_id" TEXT,
    "workspace_path" TEXT,
    CONSTRAINT "session_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "character" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "session_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "session_group" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "session_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "model" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_session" ("avatar_url", "bot_id", "character_id", "created_at", "description", "external_id", "id", "last_active_at", "model_id", "platform", "session_type", "settings", "title", "updated_at", "user_id", "workspace_path") SELECT "avatar_url", "bot_id", "character_id", "created_at", "description", "external_id", "id", "last_active_at", "model_id", "platform", "session_type", "settings", "title", "updated_at", "user_id", "workspace_path" FROM "session";
DROP TABLE "session";
ALTER TABLE "new_session" RENAME TO "session";
CREATE INDEX "session_user_id_idx" ON "session"("user_id");
CREATE INDEX "session_session_type_idx" ON "session"("session_type");
CREATE INDEX "session_bot_id_idx" ON "session"("bot_id");
CREATE INDEX "session_platform_idx" ON "session"("platform");
CREATE INDEX "session_external_id_idx" ON "session"("external_id");
CREATE INDEX "session_bot_id_external_id_idx" ON "session"("bot_id", "external_id");
CREATE INDEX "session_group_id_idx" ON "session"("group_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "session_group_user_id_idx" ON "session_group"("user_id");
