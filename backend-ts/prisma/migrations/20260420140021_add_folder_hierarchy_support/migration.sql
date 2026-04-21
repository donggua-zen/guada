-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_kb_file" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "knowledge_base_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "file_type" TEXT NOT NULL,
    "file_extension" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "file_path" TEXT,
    "content" TEXT,
    "relative_path" TEXT,
    "parent_folder_id" TEXT,
    "is_directory" BOOLEAN NOT NULL DEFAULT false,
    "processing_status" TEXT NOT NULL DEFAULT 'pending',
    "progress_percentage" INTEGER NOT NULL DEFAULT 0,
    "current_step" TEXT,
    "error_message" TEXT,
    "total_chunks" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "uploaded_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" DATETIME,
    CONSTRAINT "kb_file_knowledge_base_id_fkey" FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_base" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "kb_file_parent_folder_id_fkey" FOREIGN KEY ("parent_folder_id") REFERENCES "kb_file" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_kb_file" ("content", "content_hash", "current_step", "display_name", "error_message", "file_extension", "file_name", "file_path", "file_size", "file_type", "id", "knowledge_base_id", "processed_at", "processing_status", "progress_percentage", "total_chunks", "total_tokens", "uploaded_at") SELECT "content", "content_hash", "current_step", "display_name", "error_message", "file_extension", "file_name", "file_path", "file_size", "file_type", "id", "knowledge_base_id", "processed_at", "processing_status", "progress_percentage", "total_chunks", "total_tokens", "uploaded_at" FROM "kb_file";
DROP TABLE "kb_file";
ALTER TABLE "new_kb_file" RENAME TO "kb_file";
CREATE INDEX "kb_file_knowledge_base_id_idx" ON "kb_file"("knowledge_base_id");
CREATE INDEX "kb_file_content_hash_idx" ON "kb_file"("content_hash");
CREATE INDEX "kb_file_processing_status_idx" ON "kb_file"("processing_status");
CREATE INDEX "kb_file_parent_folder_id_idx" ON "kb_file"("parent_folder_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
