/**
 * 测试头像删除逻辑
 * 
 * 使用方法：
 * npm run test:avatar-cleanup
 */

import { PrismaClient } from "@prisma/client";
import * as path from "path";
import * as fs from "fs";

const prisma = new PrismaClient();

async function testAvatarCleanup() {
  console.log("=== 测试头像删除逻辑 ===\n");

  // 1. 获取所有有头像的角色
  const characters = await prisma.character.findMany({
    where: {
      avatarUrl: {
        not: null,
      },
    },
    select: {
      id: true,
      title: true,
      avatarUrl: true,
    },
  });

  console.log(`找到 ${characters.length} 个有头像的角色:\n`);

  for (const char of characters) {
    console.log(`角色: ${char.title}`);
    console.log(`  ID: ${char.id}`);
    console.log(`  头像路径: ${char.avatarUrl}`);

    // 判断类型
    if (char.avatarUrl!.startsWith("http")) {
      console.log(`  类型: 外部 URL`);
    } else if (char.avatarUrl!.startsWith("static/")) {
      console.log(`  类型: 静态资源（不会删除）`);
    } else if (char.avatarUrl!.startsWith("uploads/")) {
      console.log(`  类型: 上传文件`);
      
      // 检查文件是否存在
      const uploadRoot = process.env.UPLOAD_ROOT_DIR || "./data/file_stores";
      const actualPath = char.avatarUrl!.substring("uploads/".length);
      const physicalPath = path.join(uploadRoot, actualPath);
      
      console.log(`  物理路径: ${physicalPath}`);
      console.log(`  文件存在: ${fs.existsSync(physicalPath) ? "是" : "否"}`);
    } else {
      console.log(`  类型: 旧格式（兼容处理）`);
      
      // 检查文件是否存在
      const uploadRoot = process.env.UPLOAD_ROOT_DIR || "./data/file_stores";
      const physicalPath = path.join(uploadRoot, char.avatarUrl!);
      
      console.log(`  物理路径: ${physicalPath}`);
      console.log(`  文件存在: ${fs.existsSync(physicalPath) ? "是" : "否"}`);
    }

    console.log("");
  }

  console.log("=== 测试完成 ===");
}

testAvatarCleanup()
  .catch((error) => {
    console.error("错误:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
