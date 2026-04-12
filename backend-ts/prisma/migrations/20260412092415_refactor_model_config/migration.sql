/*
  Warnings:

  - You are about to drop the column `context_window` on the `model` table. All the data in the column will be lost.
  - You are about to drop the column `features` on the `model` table. All the data in the column will be lost.
  - You are about to drop the column `max_output_tokens` on the `model` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_model" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "provider_id" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "model_type" TEXT NOT NULL,
    "config" JSONB,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "model_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "model_provider" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_model" ("created_at", "id", "model_name", "model_type", "name", "provider_id", "updated_at") SELECT "created_at", "id", "model_name", "model_type", "name", "provider_id", "updated_at" FROM "model";
DROP TABLE "model";
ALTER TABLE "new_model" RENAME TO "model";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
