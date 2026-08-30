jest.mock("uuid", () => ({ v4: () => "turn-id" }));

import { MessageService } from "./message.service";

describe("MessageService", () => {
  let messageRepo: any;
  let contentRepo: any;
  let kbRepo: any;
  let urlService: any;
  let fileService: any;
  let uploadPathService: any;
  let fileRepo: any;
  let prisma: any;
  let service: MessageService;

  beforeEach(() => {
    prisma = {
      file: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(),
      message: {
        findFirst: jest.fn(),
        deleteMany: jest.fn(),
        delete: jest.fn(),
        create: jest.fn(),
      },
      messageContent: {
        create: jest.fn(),
      },
      file_updateMany: jest.fn(),
    };
    messageRepo = {
      findBySessionId: jest.fn(),
      findById: jest.fn(),
      findRecentBySessionId: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    contentRepo = {
      getPrismaClient: jest.fn(() => prisma),
      update: jest.fn(),
    };
    kbRepo = {
      findByIds: jest.fn(),
    };
    urlService = {
      toResourceAbsoluteUrl: (url: string) => url,
    };
    fileService = {
      deleteFilesByMessageId: jest.fn(),
    };
    uploadPathService = {
      toPhysicalPath: jest.fn(),
    };
    fileRepo = {
      create: jest.fn(),
      clearExpiredToolImages: jest.fn(),
    };

    service = new MessageService(
      messageRepo,
      contentRepo,
      kbRepo,
      urlService,
      fileService,
      uploadPathService,
      fileRepo,
    );
  });

  describe("getMessages", () => {
    it("returns messages for a session", async () => {
      messageRepo.findBySessionId.mockResolvedValue([
        {
          id: "msg-1",
          sessionId: "session-1",
          contents: [{ id: "c1", role: "user", content: "hello" }],
          files: [],
          metadata: null,
        },
      ]);

      const result = await service.getTurns("session-1");
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe("msg-1");
    });

    it("returns empty array for session with no messages", async () => {
      messageRepo.findBySessionId.mockResolvedValue([]);

      const result = await service.getTurns("session-1");
      expect(result.items).toHaveLength(0);
    });

    it("supports pagination via limit option", async () => {
      messageRepo.findRecentBySessionId.mockResolvedValue([]);

      await service.getTurns("session-1", { limit: 10 });
      expect(messageRepo.findRecentBySessionId).toHaveBeenCalled();
    });
  });

  describe("updateTurn", () => {
    it("updates message content", async () => {
      messageRepo.findById.mockResolvedValue({
        id: "message-1",
        contents: [{ id: "content-1" }],
      });

      await service.updateTurn("session-1", "message-1", { content: "edited" });

      expect(contentRepo.update).toHaveBeenCalledWith("content-1", {
        content: "edited",
      });
    });

    it("throws when message has no content", async () => {
      messageRepo.findById.mockResolvedValue({
        id: "message-1",
        contents: [],
      });

      await expect(
        service.updateTurn("session-1", "message-1", { content: "x" }),
      ).rejects.toThrow("Message content not found");
    });
  });

  describe("addUserMessage", () => {
    it("creates a new message with files", async () => {
      prisma.$transaction.mockImplementation(async (fn) => {
        return fn(prisma);
      });
      prisma.message.create.mockResolvedValue({ id: "new-msg-1" });
      messageRepo.findById.mockResolvedValue({
        id: "new-msg-1",
        files: [],
        contents: [],
      });

      await service.addUserMessage(
        "session-1",
        "hello world",
        [{ attachmentId: "file-1", name: "f", mediaType: "", bytes: 0, url: "" }],
        {},
      );

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.message.create).toHaveBeenCalled();
    });

    it("throws when replaceTurnId belongs to another session", async () => {
      prisma.$transaction.mockImplementation(async (fn) => {
        return fn(prisma);
      });
      prisma.message.findFirst.mockResolvedValue({
        id: "msg-1",
        sessionId: "other-session",
      });

      await expect(
        service.addUserMessage("session-1", "hello", [], { replaceTurnId: "msg-1" }),
      ).rejects.toThrow("Message not found");
    });
  });
});
