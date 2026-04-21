/*
  Warnings:

  - You are about to drop the `session_summary` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "session_summary";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "session_context_state" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "session_id" TEXT NOT NULL,
    "summary_content" TEXT,
    "last_compressed_message_id" TEXT,
    "cleaning_strategy" TEXT,
    "last_cleaned_message_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "session_context_state_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "session_context_state_session_id_idx" ON "session_context_state"("session_id");
