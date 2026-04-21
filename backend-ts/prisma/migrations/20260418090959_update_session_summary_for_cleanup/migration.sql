-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_session_summary" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "session_id" TEXT NOT NULL,
    "summary_content" TEXT,
    "last_compressed_message_id" TEXT,
    "cleaning_strategy" TEXT,
    "last_cleaned_message_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "session_summary_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_session_summary" ("created_at", "id", "last_compressed_message_id", "session_id", "summary_content", "updated_at") SELECT "created_at", "id", "last_compressed_message_id", "session_id", "summary_content", "updated_at" FROM "session_summary";
DROP TABLE "session_summary";
ALTER TABLE "new_session_summary" RENAME TO "session_summary";
CREATE INDEX "session_summary_session_id_idx" ON "session_summary"("session_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
