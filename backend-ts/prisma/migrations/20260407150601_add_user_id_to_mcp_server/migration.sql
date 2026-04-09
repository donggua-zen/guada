/*
  Warnings:

  - You are about to alter the column `settings` on the `character` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `file_metadata` on the `file` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `metadata` on the `kb_chunk` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `metadata_config` on the `knowledge_base` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `headers` on the `mcp_server` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `tools` on the `mcp_server` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `metadata` on the `memory` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `additional_kwargs` on the `message_content` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `meta_data` on the `message_content` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `features` on the `model` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `settings` on the `session` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to alter the column `settings` on the `user_setting` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - Added the required column `user_id` to the `mcp_server` table without a default value. This is not possible if the table is not empty.

*/
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
    "settings" JSONB,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "character_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "model" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "character_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_character" ("avatar_url", "created_at", "description", "id", "is_public", "model_id", "settings", "title", "updated_at", "user_id") SELECT "avatar_url", "created_at", "description", "id", "is_public", "model_id", "settings", "title", "updated_at", "user_id" FROM "character";
DROP TABLE "character";
ALTER TABLE "new_character" RENAME TO "character";
CREATE TABLE "new_file" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "file_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "file_type" TEXT NOT NULL,
    "file_extension" TEXT NOT NULL,
    "content" TEXT,
    "url" TEXT,
    "preview_url" TEXT,
    "content_hash" TEXT NOT NULL,
    "upload_user_id" TEXT,
    "session_id" TEXT,
    "message_id" TEXT,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "file_metadata" JSONB,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "file_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "message" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_file" ("content", "content_hash", "created_at", "display_name", "file_extension", "file_metadata", "file_name", "file_size", "file_type", "id", "is_public", "message_id", "preview_url", "session_id", "updated_at", "upload_user_id", "url") SELECT "content", "content_hash", "created_at", "display_name", "file_extension", "file_metadata", "file_name", "file_size", "file_type", "id", "is_public", "message_id", "preview_url", "session_id", "updated_at", "upload_user_id", "url" FROM "file";
DROP TABLE "file";
ALTER TABLE "new_file" RENAME TO "file";
CREATE INDEX "file_content_hash_idx" ON "file"("content_hash");
CREATE INDEX "file_upload_user_id_idx" ON "file"("upload_user_id");
CREATE INDEX "file_session_id_idx" ON "file"("session_id");
CREATE INDEX "file_message_id_idx" ON "file"("message_id");
CREATE TABLE "new_kb_chunk" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "file_id" TEXT NOT NULL,
    "knowledge_base_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "vector_id" TEXT,
    "embedding_dimensions" INTEGER,
    "token_count" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kb_chunk_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "kb_file" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_kb_chunk" ("chunk_index", "content", "created_at", "embedding_dimensions", "file_id", "id", "knowledge_base_id", "metadata", "token_count", "vector_id") SELECT "chunk_index", "content", "created_at", "embedding_dimensions", "file_id", "id", "knowledge_base_id", "metadata", "token_count", "vector_id" FROM "kb_chunk";
DROP TABLE "kb_chunk";
ALTER TABLE "new_kb_chunk" RENAME TO "kb_chunk";
CREATE INDEX "kb_chunk_file_id_idx" ON "kb_chunk"("file_id");
CREATE INDEX "kb_chunk_knowledge_base_id_idx" ON "kb_chunk"("knowledge_base_id");
CREATE INDEX "kb_chunk_vector_id_idx" ON "kb_chunk"("vector_id");
CREATE TABLE "new_knowledge_base" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "user_id" TEXT NOT NULL,
    "embedding_model_id" TEXT NOT NULL,
    "chunk_max_size" INTEGER NOT NULL DEFAULT 1000,
    "chunk_overlap_size" INTEGER NOT NULL DEFAULT 100,
    "chunk_min_size" INTEGER NOT NULL DEFAULT 50,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "metadata_config" JSONB,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "knowledge_base_embedding_model_id_fkey" FOREIGN KEY ("embedding_model_id") REFERENCES "model" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "knowledge_base_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_knowledge_base" ("chunk_max_size", "chunk_min_size", "chunk_overlap_size", "created_at", "description", "embedding_model_id", "id", "is_active", "is_public", "metadata_config", "name", "updated_at", "user_id") SELECT "chunk_max_size", "chunk_min_size", "chunk_overlap_size", "created_at", "description", "embedding_model_id", "id", "is_active", "is_public", "metadata_config", "name", "updated_at", "user_id" FROM "knowledge_base";
DROP TABLE "knowledge_base";
ALTER TABLE "new_knowledge_base" RENAME TO "knowledge_base";
CREATE TABLE "new_mcp_server" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "headers" JSONB,
    "tools" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "user_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "mcp_server_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_mcp_server" ("created_at", "description", "enabled", "headers", "id", "name", "tools", "updated_at", "url") SELECT "created_at", "description", "enabled", "headers", "id", "name", "tools", "updated_at", "url" FROM "mcp_server";
DROP TABLE "mcp_server";
ALTER TABLE "new_mcp_server" RENAME TO "mcp_server";
CREATE TABLE "new_memory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "session_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'long_term',
    "memory_type" TEXT NOT NULL DEFAULT 'factual',
    "importance" INTEGER NOT NULL DEFAULT 5,
    "tags" TEXT,
    "metadata" JSONB,
    "expires_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "memory_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_memory" ("category", "content", "created_at", "expires_at", "id", "importance", "memory_type", "metadata", "session_id", "tags", "updated_at") SELECT "category", "content", "created_at", "expires_at", "id", "importance", "memory_type", "metadata", "session_id", "tags", "updated_at" FROM "memory";
DROP TABLE "memory";
ALTER TABLE "new_memory" RENAME TO "memory";
CREATE INDEX "memory_session_id_idx" ON "memory"("session_id");
CREATE INDEX "memory_category_idx" ON "memory"("category");
CREATE INDEX "memory_memory_type_idx" ON "memory"("memory_type");
CREATE TABLE "new_message_content" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "message_id" TEXT NOT NULL,
    "turns_id" TEXT NOT NULL,
    "role" TEXT,
    "content" TEXT NOT NULL,
    "reasoning_content" TEXT,
    "additional_kwargs" JSONB,
    "meta_data" JSONB,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "message_content_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "message" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_message_content" ("additional_kwargs", "content", "created_at", "id", "message_id", "meta_data", "reasoning_content", "role", "turns_id", "updated_at") SELECT "additional_kwargs", "content", "created_at", "id", "message_id", "meta_data", "reasoning_content", "role", "turns_id", "updated_at" FROM "message_content";
DROP TABLE "message_content";
ALTER TABLE "new_message_content" RENAME TO "message_content";
CREATE INDEX "message_content_message_id_idx" ON "message_content"("message_id");
CREATE INDEX "message_content_turns_id_idx" ON "message_content"("turns_id");
CREATE TABLE "new_model" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "provider_id" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "model_type" TEXT NOT NULL,
    "max_tokens" INTEGER,
    "max_output_tokens" INTEGER,
    "features" JSONB,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "model_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "model_provider" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_model" ("created_at", "features", "id", "max_output_tokens", "max_tokens", "model_name", "model_type", "name", "provider_id", "updated_at") SELECT "created_at", "features", "id", "max_output_tokens", "max_tokens", "model_name", "model_type", "name", "provider_id", "updated_at" FROM "model";
DROP TABLE "model";
ALTER TABLE "new_model" RENAME TO "model";
CREATE TABLE "new_session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT,
    "user_id" TEXT NOT NULL,
    "avatar_url" TEXT,
    "description" TEXT,
    "model_id" TEXT,
    "character_id" TEXT,
    "settings" JSONB,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "last_active_at" DATETIME,
    CONSTRAINT "session_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "character" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "session_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "model" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_session" ("avatar_url", "character_id", "created_at", "description", "id", "last_active_at", "model_id", "settings", "title", "updated_at", "user_id") SELECT "avatar_url", "character_id", "created_at", "description", "id", "last_active_at", "model_id", "settings", "title", "updated_at", "user_id" FROM "session";
DROP TABLE "session";
ALTER TABLE "new_session" RENAME TO "session";
CREATE TABLE "new_user_setting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "user_setting_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_user_setting" ("created_at", "id", "settings", "updated_at", "user_id") SELECT "created_at", "id", "settings", "updated_at", "user_id" FROM "user_setting";
DROP TABLE "user_setting";
ALTER TABLE "new_user_setting" RENAME TO "user_setting";
CREATE UNIQUE INDEX "user_setting_user_id_key" ON "user_setting"("user_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
