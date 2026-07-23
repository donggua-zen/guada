jest.mock("./chat-runner.service", () => ({ ChatRunnerService: class {} }));
jest.mock("./session.service", () => ({ SessionService: class {} }));
jest.mock("../../common/database/message.repository", () => ({ MessageRepository: class {} }));
jest.mock("./session-stream.manager", () => ({ SessionStreamManager: class {} }));
jest.mock("./session-events.service", () => ({ SessionEventsService: class {} }));
jest.mock("./parsers/tag-parser-pipeline.service", () => ({ TagParserPipeline: class {} }));

const { ChatController } = require("./chat.controller");

describe("ChatController", () => {
  const user = { id: "user-1" };
  const body = { sessionId: "session-1", messageId: "message-1" };

  let chatRunner: { startStream: jest.Mock; enqueueMessage: jest.Mock };
  let sessionService: { getSessionById: jest.Mock };
  let tagParserPipeline: { parse: jest.Mock };
  let controller: any;

  beforeEach(() => {
    chatRunner = { startStream: jest.fn(), enqueueMessage: jest.fn() };
    sessionService = { getSessionById: jest.fn() };
    tagParserPipeline = { parse: jest.fn() };
    controller = new ChatController(
      sessionService as any,
      {} as any,
      {} as any,
      chatRunner as any,
      tagParserPipeline as any,
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

    await controller.streamMessage(body, user, res as any, { on: jest.fn() } as any);

    // SSE headers should have been set before calling startStream
    expect(res.setHeader).toHaveBeenCalled();
    // startStream should have been called
    expect(chatRunner.startStream).toHaveBeenCalled();
    // Error should have been written as HTTP response (not re-thrown)
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

    await controller.streamMessage(body, user, res as any, { on: jest.fn() } as any);

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
      writableEnded: false,
    };

    await controller.streamMessage(body, user, res as any, { on: jest.fn() } as any);

    expect(res.setHeader).toHaveBeenCalled();
    expect(chatRunner.startStream).toHaveBeenCalled();
    // Response should not have been ended (stream is ongoing)
    expect(res.end).not.toHaveBeenCalled();
  });
});
