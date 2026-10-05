import { Inject, Injectable, Logger } from "@nestjs/common";
import type { ContentBlock } from "../../common/types/conversation.types";
import {
  MESSAGE_STORE_TOKEN,
  type IMessageStore,
} from "../../common/persistence/message-store.interface";
import type { BaseEvent } from "../../common/persistence/types";
import { PlanFileService } from "../../common/services/plan-file.service";

/** 计划状态：待审批 / 已批准 / 已拒绝（对齐 ZCode 的 Plans 目录语义，含未决态） */
export type PlanStatus = "pending" | "approved" | "rejected";

export interface PlanHistoryItem {
  /** 计划身份 = 提交它的 ExitPlanMode 工具调用 id（与转录天然对应） */
  planId: string;
  /** 所属回合（可据此在对话里定位；回合被删除的条目会被过滤） */
  turnId: string | null;
  /** 列表标题：计划首个 Markdown 标题，缺省取首个非空行 */
  title: string;
  /** 计划正文（Markdown 全文） */
  content: string;
  status: PlanStatus;
  /** 提交时间（事件 time，Unix 毫秒） */
  createdAt: number;
  /** 计划文件的工作区相对路径（文件已落盘时；未落盘为 null，列表仍由转录提供） */
  path: string | null;
}

const TITLE_MAX_CHARS = 60;

/** 列表标题：首个 Markdown 标题行（# …），否则首个非空行；超长截断 */
function deriveTitle(content: string): string {
  const lines = content.split(/\r?\n/);
  const heading = lines.find((line) => /^#{1,6}\s+\S/.test(line.trim()));
  const raw = (heading ? heading.trim().replace(/^#{1,6}\s+/, "") : "")
    || lines.find((line) => line.trim().length > 0)
    || "";
  const title = raw.trim();
  return title.length > TITLE_MAX_CHARS
    ? `${title.slice(0, TITLE_MAX_CHARS - 1)}…`
    : title;
}

/**
 * 事件流 → 计划列表（纯函数，便于单测）。
 *
 * 计划正文的权威副本是转录里的 ExitPlanMode 工具调用参数（model 产出即落库）；
 * 状态来自配对的 tool/result（meta.planApproved / isError）；被删除回合（turn/delete）
 * 的计划整体剔除——用户删掉那一轮，计划也不再算历史。
 */
export function collectPlansFromEvents(events: BaseEvent[]): PlanHistoryItem[] {
  const items: PlanHistoryItem[] = [];
  const indexByPlanId = new Map<string, number>();
  const deletedTurns = new Set<string>();
  let currentTurnId: string | null = null;

  for (const event of events) {
    const data = event.data as Record<string, any>;

    switch (event.type) {
      case "turn/start":
        currentTurnId = typeof data.turnId === "string" ? data.turnId : null;
        break;
      case "turn/delete":
        if (typeof data.turnId === "string") deletedTurns.add(data.turnId);
        break;
      case "assistant/message": {
        const blocks = Array.isArray(data.content)
          ? (data.content as ContentBlock[])
          : [];
        for (const block of blocks) {
          if (block?.type !== "tool-call" || block.name !== "ExitPlanMode") continue;
          const plan = parsePlanArgument(block.arguments);
          if (!plan) continue;
          indexByPlanId.set(block.toolCallId, items.length);
          items.push({
            planId: block.toolCallId,
            turnId: currentTurnId,
            title: deriveTitle(plan),
            content: plan,
            status: "pending",
            createdAt: event.time,
            path: null,
          });
        }
        break;
      }
      case "tool/result": {
        const idx = indexByPlanId.get(String(data.toolCallId));
        if (idx === undefined) break;
        const meta = data.meta as Record<string, unknown> | null | undefined;
        const approvedFlag =
          meta && typeof meta.planApproved === "boolean"
            ? (meta.planApproved as boolean)
            : undefined;
        items[idx].status =
          approvedFlag === true
            ? "approved"
            : approvedFlag === false
              ? "rejected"
              : data.isError === true
                ? "rejected"
                : "approved";
        break;
      }
      default:
        break;
    }
  }

  const live = items.filter(
    (item) => item.turnId === null || !deletedTurns.has(item.turnId),
  );
  // 最近在前（转录天然按时间序）
  return live.reverse();
}

/** 工具调用参数是模型产出的原始 JSON 字符串；坏数据跳过（不阻断列表） */
function parsePlanArgument(args: unknown): string | null {
  if (typeof args !== "string" || !args.trim()) return null;
  try {
    const parsed = JSON.parse(args) as Record<string, unknown>;
    const plan = parsed?.plan;
    return typeof plan === "string" && plan.trim() ? plan : null;
  } catch {
    return null;
  }
}

/**
 * 会话计划历史服务。
 *
 * 为什么不从文件系统列目录：计划正文的权威副本在转录（ExitPlanMode 的 tool-call 参数），
 * 文件只是落盘副本——转录能给出状态（待审/已批/被拒）、标题与顺序，且不受文件被清理影响
 * （对齐 ZCode：计划身份 = toolCallId，Plans 目录来自会话数据）。
 */
@Injectable()
export class PlanHistoryService {
  private readonly logger = new Logger(PlanHistoryService.name);

  constructor(
    @Inject(MESSAGE_STORE_TOKEN) private readonly messageStore: IMessageStore,
    private readonly planFile: PlanFileService,
  ) {}

  /** 列出会话的全部计划（最近在前），并补上已落盘文件的工作区相对路径 */
  async listPlans(
    sessionId: string,
    workspacePath: string,
  ): Promise<PlanHistoryItem[]> {
    let events: BaseEvent[] = [];
    try {
      events = await this.messageStore.getAllEvents(sessionId);
    } catch (error: any) {
      this.logger.warn(
        `Failed to load events for plan history (${sessionId}): ${error?.message}`,
      );
      return [];
    }

    const items = collectPlansFromEvents(events);
    for (const item of items) {
      if (await this.planFile.planFileExists(workspacePath, sessionId, item.planId)) {
        item.path = this.planFile.resolveRelativePlanPath(
          workspacePath,
          sessionId,
          item.planId,
        );
      }
    }
    return items;
  }
}
