import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../../common/database/prisma.service";
import * as fs from "fs";
import * as path from "path";

/**
 * 消息版本迁移服务
 *
 * 将旧格式的 assistant 消息（多版本通过 turnsId 区分 content）
 * 迁移到新格式（每个版本独立 message，通过 currentVersionId 引用）。
 *
 * 迁移逻辑：
 * 1. 找到所有有 assistant 子消息但 currentVersionId 为空的用户消息
 * 2. 设 userMessage.currentVersionId = 第一个 assistant 子消息的 id
 * 3. 删除非活跃版本的内容（turnsId != currentTurnsId）
 *
 * 通过标记文件控制迁移状态，避免重复执行。
 */
@Injectable()
export class MigrationService implements OnModuleInit {
  private readonly logger = new Logger(MigrationService.name);
  private readonly markerFile: string;

  constructor(private readonly prisma: PrismaService) {
    const dataDir =
      process.env.USERDATA_DIR ||
      process.env.DATA_DIR ||
      path.join(process.cwd(), "data");
    this.markerFile = path.join(dataDir, ".migration_v1_done");
  }

  async onModuleInit() {
    try {
      await this.migrate();
    } catch (error: any) {
      this.logger.error(`消息版本迁移失败: ${error.message}`, error.stack);
    }
  }

  private async migrate(): Promise<void> {
    // 检查标记文件，已迁移则跳过
    if (fs.existsSync(this.markerFile)) {
      this.logger.log("迁移标记文件已存在，跳过迁移");
      return;
    }

    // 查找有 assistant 子消息但 currentVersionId 为空的用户消息
    const userMessages = await this.prisma.message.findMany({
      where: {
        role: "user",
        currentVersionId: null,
      },
    });

    if (userMessages.length === 0) {
      this.logger.log("无需迁移，没有需要迁移的用户消息");
      await this.writeMarker();
      return;
    }

    this.logger.log(`发现 ${userMessages.length} 条用户消息需要迁移...`);

    let migratedCount = 0;
    for (const userMsg of userMessages) {
      // 查找该用户消息的第一个 assistant 子消息
      const assistantMsg = await this.prisma.message.findFirst({
        where: {
          role: "assistant",
          parentId: userMsg.id,
        },
        include: {
          contents: {
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { createdAt: "asc" },
      });

      if (!assistantMsg) continue;

      const activeTurnsId = assistantMsg.currentTurnsId;

      // 删除非活跃版本的内容（turnsId != currentTurnsId）
      if (activeTurnsId && assistantMsg.contents?.length > 0) {
        const inactiveContents = assistantMsg.contents.filter(
          (c: any) => c.turnsId !== activeTurnsId,
        );
        if (inactiveContents.length === assistantMsg.contents.length) {
          inactiveContents.length = 0;
          inactiveContents.push(...assistantMsg.contents.slice(0, -2));
        }
        if (inactiveContents.length > 0) {
          await this.prisma.messageContent.deleteMany({
            where: {
              id: { in: inactiveContents.map((c: any) => c.id) },
            },
          });
          this.logger.debug(
            `用户消息 ${userMsg.id}：删除 ${inactiveContents.length} 条非活跃版本内容`,
          );
        }
      }

      // 设 userMessage.currentVersionId = assistantMessage.id
      await this.prisma.message.update({
        where: { id: userMsg.id },
        data: { currentVersionId: assistantMsg.id },
      });

      this.logger.debug(
        `用户消息 ${userMsg.id} → currentVersionId = ${assistantMsg.id}`,
      );
      migratedCount++;
    }

    // 写入标记文件
    await this.writeMarker();

    this.logger.log(`消息版本迁移完成，共迁移 ${migratedCount} 条`);
  }

  private async writeMarker(): Promise<void> {
    try {
      await fs.promises.mkdir(path.dirname(this.markerFile), {
        recursive: true,
      });
      await fs.promises.writeFile(
        this.markerFile,
        new Date().toISOString(),
        "utf-8",
      );
      this.logger.log(`迁移标记文件已写入: ${this.markerFile}`);
    } catch (error: any) {
      this.logger.warn(`写入迁移标记文件失败: ${error.message}`);
    }
  }
}
