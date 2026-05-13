jest.mock("./agent-engine.service", () => ({ AgentEngine: class {} }));
jest.mock("./session.service", () => ({ SessionService: class {} }));

const { ChatController } = require("./chat.controller");

describe("ChatController", () => {
  const user = { id: "user-1" };
  const body = { sessionId: "session-1", messageId: "message-1" };

  let agentEngine: { completions: jest.Mock };
  let sessionService: { getSessionById: jest.Mock };
  let controller: any;

  beforeEach(() => {
    agentEngine = { completions: jest.fn() };
    sessionService = { getSessionById: jest.fn() };
    controller = new ChatController(agentEngine as any, sessionService as any);
  });

  it("verifies session ownership before creating completions stream", async () => {
    sessionService.getSessionById.mockResolvedValue({ id: body.sessionId });

    await controller.completions(body, user, { on: jest.fn() } as any);

    expect(sessionService.getSessionById).toHaveBeenCalledWith(
      body.sessionId,
      user.id,
    );
  });

  it("does not start completions when session is unauthorized", async () => {
    sessionService.getSessionById.mockRejectedValue(new Error("unauthorized"));

    await expect(
      controller.completions(body, user, { on: jest.fn() } as any),
    ).rejects.toThrow("unauthorized");
    expect(agentEngine.completions).not.toHaveBeenCalled();
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
    expect(agentEngine.completions).not.toHaveBeenCalled();
  });
});
