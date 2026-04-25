// Prisma 配置文件的 JavaScript 版本（用于生产环境）
require("dotenv/config");
const { defineConfig } = require("prisma/config");

module.exports = defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"] || "file:./data/ai_chat.db",
  },
});
