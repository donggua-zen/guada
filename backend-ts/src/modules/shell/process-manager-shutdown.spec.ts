import { EventEmitter2 } from "@nestjs/event-emitter";
import { ProcessManagerService } from "./process-manager.service";

/// <reference types="jest" />

describe("ProcessManagerService shutdown reaper", () => {
  it("onApplicationShutdown 终止所有 running 并释放句柄", async () => {
    const service = new ProcessManagerService(
      {} as any,
      new EventEmitter2(),
    );
    service.onModuleInit();

    const entry: any = {
      id: "shutdown-proc",
      sessionId: "s1",
      status: "running",
      kind: "node",
      command: "sleep 10",
      childProcess: { pid: 999_999 },
      terminationPromise: Promise.resolve(),
      terminationResolve: jest.fn(),
    };
    (service as any).processes.set(entry.id, entry);
    (service as any).sessionProcesses.set(
      "s1",
      new Map([[entry.id, entry]]),
    );

    const terminate = jest
      .spyOn(service as any, "terminateTree")
      .mockImplementation(() => undefined);
    const release = jest
      .spyOn(service as any, "releaseProcessHandles")
      .mockImplementation(() => undefined);

    await service.onApplicationShutdown();

    expect(terminate).toHaveBeenCalledWith(entry);
    expect(release).toHaveBeenCalledWith(entry);

    service.onModuleDestroy();
  });
});
