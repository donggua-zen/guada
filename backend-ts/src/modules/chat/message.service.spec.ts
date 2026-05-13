jest.mock("uuid", () => ({ v4: () => "turn-id" }));

import { MessageService } from "./message.service";

describe("MessageService ownership checks", () => {
  let messageRepo: any;
  let contentRepo: any;
  let sessionRepo: any;
  let prisma: any;
  let service: MessageService;

  beforeEach(() => {
    prisma = {
      file: {
        findMany: jest.fn(),
      },
    };
    messageRepo = {
      findBySessionId: jest.fn(),
      findById: jest.fn(),
      findByIdWithCurrentContent: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    contentRepo = {
      getPrismaClient: jest.fn(() => prisma),
      update: jest.fn(),
    };
    sessionRepo = {
      findById: jest.fn(),
    };

    service = new MessageService(
      messageRepo,
      contentRepo,
      sessionRepo,
      { findByIds: jest.fn() } as any,
      {} as any,
      { toResourceAbsoluteUrl: (url: string) => url } as any,
      { deleteFilesByMessageId: jest.fn() } as any,
    );
  });

  it("does not list messages from another user's session", async () => {
    sessionRepo.findById.mockResolvedValue({ id: "session-1", userId: "user-2" });

    await expect(service.getMessages("session-1", "user-1")).rejects.toThrow(
      "Session not found",
    );
    expect(messageRepo.findBySessionId).not.toHaveBeenCalled();
  });

  it("does not update another user's message", async () => {
    messageRepo.findByIdWithCurrentContent.mockResolvedValue({
      id: "message-1",
      session: { userId: "user-2" },
      contents: [{ id: "content-1" }],
    });

    await expect(
      service.updateMessage("message-1", { content: "edited" }, "user-1"),
    ).rejects.toThrow("Message not found");

    expect(messageRepo.update).not.toHaveBeenCalled();
    expect(contentRepo.update).not.toHaveBeenCalled();
  });

  it("does not attach files from another user's session", async () => {
    sessionRepo.findById.mockResolvedValue({ id: "session-1", userId: "user-1" });
    prisma.file.findMany.mockResolvedValue([
      { id: "file-1", sessionId: "session-2", uploadUserId: "user-2" },
    ]);

    await expect(
      service.addMessage(
        "session-1",
        "user",
        "hello",
        ["file-1"],
        undefined,
        undefined,
        "user-1",
      ),
    ).rejects.toThrow("File not found");

    expect(messageRepo.create).not.toHaveBeenCalled();
  });
});
