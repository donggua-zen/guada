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
import { Observable } from "rxjs";
import { Response, Request } from "express";

@Controller("chat")
@UseGuards(AuthGuard)
export class ChatController {
  constructor(
    private agentEngine: AgentEngine,
    private sessionService: SessionService,
  ) {}

  @Sse("completions")
  async completions(
    @Body()
    body: {
      sessionId: string;
      messageId: string;
      regenerationMode?: string; // 再生模式
      assistantMessageId?: string; // 现有助手消息 ID
    },
    @CurrentUser() user: any,
    @Req() req: Request,
  ): Promise<Observable<MessageEvent>> {
    const {
      sessionId,
      messageId,
      regenerationMode = "overwrite", // 默认 overwrite 模式
      assistantMessageId,
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
      regenerationMode?: string; // 改为 string 类型：'overwrite' | 'multi_version' | 'append'
      enableReasoning?: boolean;
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
}
