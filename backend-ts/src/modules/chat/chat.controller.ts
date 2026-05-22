import {
  Controller,
  Post,
  Body,
  Sse,
  MessageEvent,
  UseGuards,
  Res,
  Req,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { AgentEngine } from "./agent-engine.service";
import { SessionService } from "./session.service";
import { MessageRepository } from "../../common/database/message.repository";
import { Observable } from "rxjs";
import { Response, Request } from "express";

@Controller("chat")
@UseGuards(AuthGuard)
export class ChatController {
  constructor(
    private agentEngine: AgentEngine,
    private sessionService: SessionService,
    private messageRepo: MessageRepository,
  ) { }

  @Sse("completions")
  async completions(
    @Body()
    body: {
      sessionId: string;
      messageId: string;
      regenerationMode?: string; // 再生模式：'overwrite' | 'multi_version' | 'resume'
      assistantMessageId?: string; // 现有助手消息 ID
      resumeData?: any; // 【新增】断点续传数据（如审批决策）
    },
    @CurrentUser() user: any,
    @Req() req: Request,
  ): Promise<Observable<MessageEvent>> {
    const {
      sessionId,
      messageId,
      regenerationMode = "overwrite", // 默认 overwrite 模式
      assistantMessageId,
      resumeData, // 【新增】
    } = body;
    const session = await this.sessionService.getSessionById(sessionId, user.id);

    // 创建 AbortController 用于中断 LLM 请求
    const abortController = new AbortController();

    // 监听客户端断开连接事件
    req.on("close", () => {
      if (!req.complete) {
        console.log("Client disconnected, aborting LLM request");
        abortController.abort();
      }
    });

    // 将 AgentService 的 AsyncGenerator 转换为 RxJS Observable
    return new Observable((observer) => {
      const iterator = this.agentEngine.completions(
        session,
        messageId,
        regenerationMode, // 传递再生模式
        assistantMessageId, // 传递现有助手消息 ID
        abortController.signal, // 传递中断信号
        resumeData, // 【新增】传递断点续传数据
      );

      let isCompleted = false;

      const push = async () => {
        if (isCompleted) return;

        try {
          const { value, done } = await iterator.next();
          if (done) {
            isCompleted = true;
            observer.next({ data: "[DONE]" });
            observer.complete();
          } else {
            observer.next({ data: JSON.stringify(value) });
            push();
          }
        } catch (error: any) {
          isCompleted = true;
          if (error.name === "AbortError") {
            console.log("LLM request aborted due to client disconnect");
            observer.complete();
          } else {
            observer.error(error);
          }
        }
      };

      push();

      // 清理函数：当 Observable 被取消订阅时中断请求
      return () => {
        if (!isCompleted) {
          console.log("Observable unsubscribed, aborting LLM request");
          abortController.abort();
        }
      };
    });
  }

  /**
   * 流式生成消息响应
   */
  @Post("stream")
  async streamMessage(
    @Body()
    body: {
      sessionId: string;
      messageId?: string;
      assistantMessageId?: string;
      regenerationMode?: string; // 改为 string 类型：'overwrite' | 'multi_version' | 'resume'
      enableReasoning?: boolean;
      resumeData?: any; // 【新增】断点续传数据
    },
    @CurrentUser() user: any,
    @Res() res: Response,
    @Req() req: Request,
  ) {
    const {
      sessionId,
      messageId,
      assistantMessageId,
      regenerationMode = "overwrite", // 默认 overwrite 模式
      resumeData, // 【新增】
    } = body;

    const session = await this.sessionService.getSessionById(sessionId, user.id);

    // 设置 SSE 响应头
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    // 创建 AbortController 用于中断 LLM 请求
    const abortController = new AbortController();

    // 标记是否已处理断开连接
    let isAborted = false;

    const handleDisconnect = () => {
      if (!isAborted && !res.writableEnded) {
        isAborted = true;
        abortController.abort();
      }
    };

    // 同时监听 req 和 res 的 close 事件以提高可靠性
    req.on("close", handleDisconnect);
    res.on("close", handleDisconnect);

    try {
      const iterator = this.agentEngine.completions(
        session,
        messageId || "", // 传递 messageId
        regenerationMode, // 传递再生模式
        assistantMessageId, // 传递现有助手消息 ID
        abortController.signal, // 传递中断信号
        resumeData, // 【新增】传递断点续传数据
      );

      for await (const chunk of iterator) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error: any) {
      if (error.name === "AbortError") {
        console.log(
          "LLM request aborted due to client disconnect (stream endpoint)",
        );
        if (!res.writableEnded) {
          res.end();
        }
      } else {
        console.error("Stream error:", error);
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
          res.end();
        }
      }
    }
  }

  /**
   * 【新增】工具审批接口
   * 
   * 前端调用此接口批量提交审批决策。
   * 审批后，前端需要重新发起流式请求，Agent 循环会检测到 approvalContext.decisions
   * 并根据每个工具的决策执行相应的操作（approved: 执行工具, rejected: 生成错误响应）。
   */
  @Post("approve-tools")
  async approveTools(
    @Body()
    body: {
      messageId: string;  // 助手消息 ID
      decisions: Array<{  // 所有需要审批的工具的决策
        toolCallId: string;
        decision: 'approve' | 'reject';
        reason?: string;  // 拒绝原因（可选）
      }>;
    },
    @CurrentUser() user: any,
  ) {
    const { messageId, decisions } = body;

    // 验证消息存在，并获取当前的 content
    const message = await this.messageRepo.findById(messageId, {
      withContents: true,
      onlyCurrentContent: true,
    });

    if (!message || !message.contents || message.contents.length === 0) {
      throw new Error('Message not found');
    }

    // TODO: 验证消息属于当前用户
    // const session = await this.sessionService.getSessionById(message.sessionId, user.id);
    // if (!session) {
    //   throw new Error('Unauthorized');
    // }

    // 获取当前 content 的最后一个轮次（ReAct 循环中最新的一轮）
    const currentContent = message.contents[message.contents.length - 1];
    const metadata = (currentContent.metadata as any) || {};
    const approvalContext = metadata.approvalContext;

    if (!approvalContext || approvalContext.type !== 'approval') {
      throw new Error('No pending approval context found');
    }

    if (approvalContext.status !== 'pending') {
      throw new Error(`Approval already ${approvalContext.status}`);
    }

    // 验证决策数量匹配
    const pendingToolCallIds = approvalContext.pendingToolCallIds || [];
    if (decisions.length !== pendingToolCallIds.length) {
      throw new Error(`Expected ${pendingToolCallIds.length} decisions, got ${decisions.length}`);
    }

    // 验证所有决策的工具 ID 都在 pendingToolCallIds 中
    const pendingIds = new Set(pendingToolCallIds);
    for (const decision of decisions) {
      if (!pendingIds.has(decision.toolCallId)) {
        throw new Error(`Invalid toolCallId: ${decision.toolCallId}`);
      }
    }

    // 更新审批状态和决策
    metadata.approvalContext = {
      ...approvalContext,
      status: 'completed',  // 标记为已完成
      decisions: decisions,
      updatedAt: new Date().toISOString(),
    };

    // 保存更新后的 content metadata
    await this.messageRepo.update(currentContent.id, { metadata });

    return {
      success: true,
      messageId,
      contentId: currentContent.id,
      decisionsCount: decisions.length,
    };
  }
}
