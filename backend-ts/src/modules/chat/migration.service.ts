import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../../common/database/prisma.service";

/**
 * 消息版本迁移服务
 *
 * 将旧格式的 assistant 消息（多版本通过 turnsId 区分 content）
 * 迁移到新格式（每个版本独立 message，通过 currentVersionId 引用）。
 *
 * 迁移逻辑：
 * 1. 找到所有有 assistant 子消息但 currentVersionId 为空的用户消息
 * 2. 删除非活跃版本的内容（turnsId != currentTurnsId）
 * 3. 设 userMessage.currentVersionId = assistantMessage.id
 *
 * 仅执行一次，启动时自动检测并迁移。
 */
@Injectable()
export class MigrationService implements OnModuleInit {
  private readonly logger = new Logger(MigrationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    try {
      await this.migrate();
    } catch (error: any) {
      this.logger.error(`消息版本迁移失败: ${error.message}`, error.stack);
    }
  }

  private async migrate(): Promise<void> {
    // 检测是否需要迁移：查找有 assistant 子消息但 currentVersionId 为空的用户消息
    const userMessages = await this.prisma.message.findMany({
      where: {
        role: "user",
        currentVersionId: null,
        children: {
          some: { role: "assistant" },
        },
      },
      include: {
        children: {
          where: { role: "assistant" },
          include: {
            contents: {
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
    });

    if (userMessages.length === 0) {
      this.logger.log("无需迁移，已有 currentVersionId 数据");
      return;
    }

    this.logger.log(`发现 ${userMessages.length} 条用户消息需要迁移...`);

    for (const userMsg of userMessages) {
      await this.migrateUserMessage(userMsg);
    }

    this.logger.log(`消息版本迁移完成，共迁移 ${userMessages.length} 条`);
  }

  private async migrateUserMessage(userMsg: any): Promise<void> {
    const assistantMsg = userMsg.children[0];
    if (!assistantMsg) return;

    const activeTurnsId = assistantMsg.currentTurnsId;

    // 删除非活跃版本的内容（turnsId != currentTurnsId）
    if (activeTurnsId && assistantMsg.contents?.length > 0) {
      const inactiveContents = assistantMsg.contents.filter(
        (c: any) => c.turnsId !== activeTurnsId,
      );
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
  }
}