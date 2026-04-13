-- CreateTable
CREATE TABLE "character_group" (
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
CREATE TABLE "new_character" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "avatar_url" TEXT,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "model_id" TEXT,
    "group_id" TEXT,
    "settings" JSONB,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "character_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "character_group" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "character_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "model" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "character_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_character" ("avatar_url", "created_at", "description", "id", "is_public", "model_id", "settings", "title", "updated_at", "user_id") SELECT "avatar_url", "created_at", "description", "id", "is_public", "model_id", "settings", "title", "updated_at", "user_id" FROM "character";
DROP TABLE "character";
ALTER TABLE "new_character" RENAME TO "character";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
