import { FileService } from "./file.service";

describe("FileService ownership checks", () => {
  let fileRepo: any;
  let prisma: any;
  let service: FileService;

  beforeEach(() => {
    fileRepo = {
      create: jest.fn(),
      findById: jest.fn(),
    };
    prisma = {
      session: {
        findFirst: jest.fn(),
      },
      message: {
        findUnique: jest.fn(),
      },
    };

    service = new FileService(
      {} as any,
      {} as any,
      fileRepo,
      prisma,
      {} as any,
      { toResourceAbsoluteUrl: (url: string) => url } as any,
    );
  });

  it("does not upload to another user's session", async () => {
    prisma.session.findFirst.mockResolvedValue(null);

    await expect(
      service.uploadFile(
        "session-1",
        { originalname: "note.txt", size: 1, buffer: Buffer.from("a") },
        "user-1",
      ),
    ).rejects.toThrow("Session not found");

    expect(fileRepo.create).not.toHaveBeenCalled();
  });

  it("does not copy into another user's message", async () => {
    prisma.message.findUnique.mockResolvedValue({
      id: "message-1",
      session: { userId: "user-2" },
    });

    await expect(
      service.copyFile("file-1", "message-1", "user-1"),
    ).rejects.toThrow("Message not found");

    expect(fileRepo.findById).not.toHaveBeenCalled();
    expect(fileRepo.create).not.toHaveBeenCalled();
  });

  it("does not copy another user's file", async () => {
    prisma.message.findUnique.mockResolvedValue({
      id: "message-1",
      sessionId: "session-1",
      session: { userId: "user-1" },
    });
    fileRepo.findById.mockResolvedValue({
      id: "file-1",
      sessionId: "session-2",
      uploadUserId: "user-2",
    });
    prisma.session.findFirst.mockResolvedValue(null);

    await expect(
      service.copyFile("file-1", "message-1", "user-1"),
    ).rejects.toThrow("File not found");

    expect(fileRepo.create).not.toHaveBeenCalled();
  });
});
