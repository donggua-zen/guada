jest.mock("./chat-runner.service", () => ({ ChatRunnerService: class {} }));
jest.mock("./session.service", () => ({ SessionService: class {} }));
jest.mock("../../common/database/message.repository", () => ({ MessageRepository: class {} }));
jest.mock("./session-stream.manager", () => ({ SessionStreamManager: class {} }));
jest.mock("./session-events.service", () => ({ SessionEventsService: class {} }));

const { ChatController } = require("./chat.controller");

describe("ChatController", () => {
  const user = { id: "user-1" };
  const body = { sessionId: "session-1", messageId: "message-1" };

  let chatRunner: { startStream: jest.Mock };
  let sessionService: { getSessionById: jest.Mock };
  let controller: any;

  beforeEach(() => {
    chatRunner = { startStream: jest.fn() };
    sessionService = { getSessionById: jest.fn() };
    controller = new ChatController(
      sessionService as any,
      {} as any,
      {} as any,
      chatRunner as any,
    );
  });

  it("does not open stream response when session is unauthorized", async () => {
    sessionService.getSessionById.mockRejectedValue(new Error("unauthorized"));
    const res = {
      setHeader: jest.fn(),
      on: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      writableEnded: false,
    };

    await expect(
      controller.streamMessage(body, user, res as any, { on: jest.fn() } as any),
    ).rejects.toThrow("unauthorized");

    expect(res.setHeader).not.toHaveBeenCalled();
    expect(chatRunner.startStream).not.toHaveBeenCalled();
  });
});
