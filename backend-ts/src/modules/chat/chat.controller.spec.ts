jest.mock("./chat-runner.service", () => ({ ChatRunnerService: class {} }));
jest.mock("./session.service", () => ({ SessionService: class {} }));
jest.mock("./session-stream.manager", () => ({ SessionStreamManager: class {} }));
jest.mock("./session-events.service", () => ({ SessionEventsService: class {} }));
jest.mock("./parsers/tag-parser-pipeline.service", () => ({ TagParserPipeline: class {} }));

const { ChatController } = require("./chat.controller");

describe("ChatController", () => {
  const body = { sessionId: "session-1", messageId: "message-1" };

  let chatRunner: { startStream: jest.Mock; enqueueMessage: jest.Mock };
  let sessionService: { getSessionById: jest.Mock };
  let tagParserPipeline: { parse: jest.Mock };
  let streamManager: { hasActiveStream: jest.Mock };
  let userInputQueue: { enqueue: jest.Mock };
  let controller: any;

  beforeEach(() => {
    chatRunner = { startStream: jest.fn(), enqueueMessage: jest.fn() };
    sessionService = { getSessionById: jest.fn() };
    tagParserPipeline = { parse: jest.fn() };
    streamManager = { hasActiveStream: jest.fn(() => false) };
    userInputQueue = {
      enqueue: jest.fn(() => ({
        item: { id: "q1" },
        snapshot: { revision: 1, epoch: "epoch-1" },
      })),
    };
    controller = new ChatController(
      sessionService as any,
      streamManager as any,
      chatRunner as any,
      tagParserPipeline as any,
      {} as any,
      userInputQueue as any,
    );
  });

  it("writes error response when startStream throws HttpException", async () => {
    const { HttpException, HttpStatus } = require("@nestjs/common");
    chatRunner.startStream.mockRejectedValue(
      new HttpException("unauthorized", HttpStatus.UNAUTHORIZED),
    );

    const res = {
      setHeader: jest.fn(),
      on: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      writableEnded: false,
    };

    await controller.streamMessage(body, res as any, { on: jest.fn() } as any, "");

    // /chat/stream 已降级为 RPC:startStream 应被调用,错误以 HTTP 响应返回(不 re-throw)
    expect(chatRunner.startStream).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
    expect(res.json).toHaveBeenCalled();
  });

  it("writes 500 when startStream throws non-HttpException", async () => {
    chatRunner.startStream.mockRejectedValue(new Error("internal error"));

    const res = {
      setHeader: jest.fn(),
      on: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      writableEnded: false,
    };

    await controller.streamMessage(body, res as any, { on: jest.fn() } as any, "");

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "internal error" }),
    );
  });

  it("starts stream successfully when startStream resolves", async () => {
    chatRunner.startStream.mockResolvedValue(jest.fn()); // returns unsubscribe fn

    const res = {
      setHeader: jest.fn(),
      on: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      writableEnded: false,
    };

    await controller.streamMessage(body, res as any, { on: jest.fn() } as any, "");

    expect(chatRunner.startStream).toHaveBeenCalled();
    // RPC 模式:触发后立即返回 ok,不再阻塞到流结束
    expect(res.json).toHaveBeenCalledWith({ ok: true, started: true });
    expect(res.end).not.toHaveBeenCalled();
  });

  it("normalizes settingsOverride before saving it on a queued item", async () => {
    streamManager.hasActiveStream.mockReturnValue(true);
    const res = {
      setHeader: jest.fn(),
      on: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      writableEnded: false,
    };

    await controller.streamMessage(
      {
        sessionId: "session-1",
        userMessage: { content: "queued" },
        settingsOverride: {
          modelId: "prov:m",
          thinkingEffort: "high",
          maxTokensLimit: 2048,
          sandboxMode: "read-only",
          planEnabled: true,
          // 非白名单键必须被丢弃
          plugins: ["evil"],
        },
      } as any,
      res as any,
      { on: jest.fn() } as any,
      "",
    );

    // 直发不应用覆盖；只有入队项保存白名单快照
    expect(chatRunner.startStream).not.toHaveBeenCalled();
    expect(userInputQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        settingsOverride: {
          modelId: "prov:m",
          thinkingEffort: "high",
          maxTokensLimit: 2048,
          sandboxMode: "read-only",
          planEnabled: true,
        },
      }),
    );
  });

  it("rejects invalid settingsOverride with 400 before starting a stream", async () => {
    const res = {
      setHeader: jest.fn(),
      on: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      writableEnded: false,
    };

    await expect(
      controller.streamMessage(
        {
          sessionId: "session-1",
          userMessage: { content: "queued" },
          settingsOverride: { sandboxMode: "yolo" },
        } as any,
        res as any,
        { on: jest.fn() } as any,
        "",
      ),
    ).rejects.toMatchObject({
      response: { code: "INVALID_SETTINGS_OVERRIDE" },
    });
    expect(chatRunner.startStream).not.toHaveBeenCalled();
  });

  it("enqueues user input when the session is busy instead of returning 409", async () => {
    streamManager.hasActiveStream.mockReturnValue(true);
    const res = {
      setHeader: jest.fn(),
      on: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      writableEnded: false,
    };

    await controller.streamMessage(
      {
        sessionId: "session-1",
        userMessage: { content: "queued", knowledgeBaseIds: ["kb1"] },
        settingsOverride: { modelId: "prov:m" },
      } as any,
      res as any,
      { on: jest.fn() } as any,
      "client-1",
    );

    expect(chatRunner.startStream).not.toHaveBeenCalled();
    expect(userInputQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        content: "queued",
        knowledgeBaseIds: ["kb1"],
        settingsOverride: { modelId: "prov:m" },
        clientId: "client-1",
      }),
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        queued: true,
        itemId: "q1",
        revision: 1,
        epoch: "epoch-1",
      }),
    );
  });

  it("falls back to enqueue when startStream loses the busy race", async () => {
    const { HttpException, HttpStatus } = require("@nestjs/common");
    chatRunner.startStream.mockRejectedValue(
      new HttpException(
        { error: "busy", code: "SESSION_BUSY" },
        HttpStatus.CONFLICT,
      ),
    );
    const res = {
      setHeader: jest.fn(),
      on: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      writableEnded: false,
    };

    await controller.streamMessage(
      {
        sessionId: "session-1",
        userMessage: { content: "queued" },
      } as any,
      res as any,
      { on: jest.fn() } as any,
      "client-1",
    );

    expect(userInputQueue.enqueue).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ queued: true, itemId: "q1" }),
    );
  });

  it("keeps 409 for busy requests without user content (resume/regenerate)", async () => {
    const { HttpException, HttpStatus } = require("@nestjs/common");
    streamManager.hasActiveStream.mockReturnValue(true);
    chatRunner.startStream.mockRejectedValue(
      new HttpException(
        { error: "busy", code: "SESSION_BUSY" },
        HttpStatus.CONFLICT,
      ),
    );
    const res = {
      setHeader: jest.fn(),
      on: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      writableEnded: false,
    };

    await controller.streamMessage(
      { sessionId: "session-1", userMessage: { id: "m1" } } as any,
      res as any,
      { on: jest.fn() } as any,
      "client-1",
    );

    expect(userInputQueue.enqueue).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
  });

  it("maps MODEL_NOT_RESOLVED to HTTP 400", async () => {
    const error: any = new Error(
      "MODEL_NOT_RESOLVED: selected model was deleted",
    );
    error.code = "MODEL_NOT_RESOLVED";
    chatRunner.startStream.mockRejectedValue(error);

    const res = {
      setHeader: jest.fn(),
      on: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      writableEnded: false,
    };

    await controller.streamMessage(
      {
        sessionId: "session-1",
        userMessage: { content: "queued" },
        settingsOverride: { modelId: "prov:deleted" },
      } as any,
      res as any,
      { on: jest.fn() } as any,
      "",
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "MODEL_NOT_RESOLVED" }),
    );
  });
});
