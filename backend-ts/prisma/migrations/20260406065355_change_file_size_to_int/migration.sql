-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT,
    "user_id" TEXT NOT NULL,
    "avatar_url" TEXT,
    "description" TEXT,
    "model_id" TEXT,
    "character_id" TEXT,
    "settings" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "last_active_at" DATETIME,
    CONSTRAINT "session_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "model" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "session_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "character" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "session_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "parent_id" TEXT,
    "current_turns_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "message_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "message_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "message" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "message_content" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "message_id" TEXT NOT NULL,
    "turns_id" TEXT NOT NULL,
    "role" TEXT,
    "content" TEXT NOT NULL,
    "reasoning_content" TEXT,
    "additional_kwargs" TEXT,
    "meta_data" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "message_content_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "message" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "model_provider" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "api_url" TEXT NOT NULL,
    "api_key" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "model" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "provider_id" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "model_type" TEXT NOT NULL,
    "max_tokens" INTEGER,
    "max_output_tokens" INTEGER,
    "features" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "model_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "model_provider" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "role" TEXT,
    "avatar_url" TEXT,
    "parent_id" TEXT,
    "nickname" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "password_hash" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "character" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "avatar_url" TEXT,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "model_id" TEXT,
    "settings" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "character_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "character_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "model" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "knowledge_base" (
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
    "metadata_config" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "knowledge_base_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "knowledge_base_embedding_model_id_fkey" FOREIGN KEY ("embedding_model_id") REFERENCES "model" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "kb_file" (
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
    "processing_status" TEXT NOT NULL DEFAULT 'pending',
    "progress_percentage" INTEGER NOT NULL DEFAULT 0,
    "current_step" TEXT,
    "error_message" TEXT,
    "total_chunks" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "uploaded_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" DATETIME,
    CONSTRAINT "kb_file_knowledge_base_id_fkey" FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_base" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "kb_chunk" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "file_id" TEXT NOT NULL,
    "knowledge_base_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "vector_id" TEXT,
    "embedding_dimensions" INTEGER,
    "token_count" INTEGER NOT NULL DEFAULT 0,
    "metadata" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kb_chunk_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "kb_file" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "memory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "session_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'long_term',
    "memory_type" TEXT NOT NULL DEFAULT 'factual',
    "importance" INTEGER NOT NULL DEFAULT 5,
    "tags" TEXT,
    "metadata" TEXT,
    "expires_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "memory_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "file" (
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
    "file_metadata" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "global_settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL,
    "value" TEXT,
    "value_type" TEXT NOT NULL DEFAULT 'str',
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'general',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "mcp_server" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "headers" TEXT,
    "tools" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "user_setting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "settings" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "user_setting_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "message_session_id_idx" ON "message"("session_id");

-- CreateIndex
CREATE INDEX "message_parent_id_idx" ON "message"("parent_id");

-- CreateIndex
CREATE INDEX "message_current_turns_id_idx" ON "message"("current_turns_id");

-- CreateIndex
CREATE INDEX "message_content_message_id_idx" ON "message_content"("message_id");

-- CreateIndex
CREATE INDEX "message_content_turns_id_idx" ON "message_content"("turns_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_phone_key" ON "user"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "kb_file_knowledge_base_id_idx" ON "kb_file"("knowledge_base_id");

-- CreateIndex
CREATE INDEX "kb_file_content_hash_idx" ON "kb_file"("content_hash");

-- CreateIndex
CREATE INDEX "kb_file_processing_status_idx" ON "kb_file"("processing_status");

-- CreateIndex
CREATE INDEX "kb_chunk_file_id_idx" ON "kb_chunk"("file_id");

-- CreateIndex
CREATE INDEX "kb_chunk_knowledge_base_id_idx" ON "kb_chunk"("knowledge_base_id");

-- CreateIndex
CREATE INDEX "kb_chunk_vector_id_idx" ON "kb_chunk"("vector_id");

-- CreateIndex
CREATE INDEX "memory_session_id_idx" ON "memory"("session_id");

-- CreateIndex
CREATE INDEX "memory_category_idx" ON "memory"("category");

-- CreateIndex
CREATE INDEX "memory_memory_type_idx" ON "memory"("memory_type");

-- CreateIndex
CREATE INDEX "file_content_hash_idx" ON "file"("content_hash");

-- CreateIndex
CREATE INDEX "file_upload_user_id_idx" ON "file"("upload_user_id");

-- CreateIndex
CREATE INDEX "file_session_id_idx" ON "file"("session_id");

-- CreateIndex
CREATE INDEX "file_message_id_idx" ON "file"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "global_settings_key_key" ON "global_settings"("key");

-- CreateIndex
CREATE UNIQUE INDEX "user_setting_user_id_key" ON "user_setting"("user_id");
