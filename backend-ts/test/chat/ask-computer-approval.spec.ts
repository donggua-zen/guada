import {
  AskService,
  COMMAND_ALLOW_ONCE,
  COMMAND_ALLOW_TURN,
  COMMAND_DENY,
} from "../../src/common/services/ask.service";
import { InteractionWaitService } from "../../src/common/services/interaction-wait.service";
import { turnApprovalMemory } from "../../src/common/services/turn-approval-memory";
import { AskDeniedError } from "../../src/common/types/ask.types";

describe("AskService.requestComputerUseApproval", () => {
  beforeEach(() => turnApprovalMemory.clear());
  afterEach(() => turnApprovalMemory.clear());

  function makeSession() {
    const published: any[] = [];
    return {
      sessionId: "sess-computer",
      published,
      appendAskAsked: jest.fn().mockResolvedValue(undefined),
      publishStream: jest.fn(async (chunk: any) => {
        published.push(chunk);
      }),
      appendAskAnswered: jest.fn().mockResolvedValue(undefined),
    } as any;
  }

  async function awaitRequest(wait: InteractionWaitService, session: any) {
    for (let i = 0; i < 200; i++) {
      const requested = session.published.find((chunk: any) => chunk.type === "ask_requested");
      if (requested && wait.getPendingQuestions(session.sessionId, requested.requestId)) {
        return requested;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error("computer-use ask_requested was not registered in time");
  }

  function answer(
    wait: InteractionWaitService,
    session: any,
    requested: any,
    selected: string[],
    custom?: string,
  ) {
    wait.resolveAnswers(session.sessionId, requested.requestId, [
      { id: requested.questions[0].id, selected, custom },
    ]);
  }

  it("uses the computer-use card kind and offers once / turn / deny", async () => {
    const wait = new InteractionWaitService();
    const service = new AskService(wait);
    const session = makeSession();

    const promise = service.requestComputerUseApproval(session, {
      toolCallId: "call-1",
      toolName: "computer_input",
      detail: "Click element [1]",
    });
    const requested = await awaitRequest(wait, session);

    expect(requested.cardKind).toBe("computer-use-approval");
    expect(requested.title).toBe("Computer Use 操作确认");
    expect(requested.toolName).toBe("computer_input");
    expect(requested.toolCallId).toBe("call-1");
    expect(requested.questions[0].options.map((option: any) => option.label)).toEqual([
      COMMAND_ALLOW_ONCE,
      COMMAND_ALLOW_TURN,
      COMMAND_DENY,
    ]);
    expect(requested.questions[0].detail).toContain("Click element [1]");

    answer(wait, session, requested, [COMMAND_ALLOW_ONCE]);
    await expect(promise).resolves.toBeUndefined();
  });

  it("remembers turn approval and does not create a second card", async () => {
    const wait = new InteractionWaitService();
    const service = new AskService(wait);
    const session = makeSession();

    const first = service.requestComputerUseApproval(session, {
      toolCallId: "call-1",
      detail: "Type text",
    });
    const requested = await awaitRequest(wait, session);
    answer(wait, session, requested, [COMMAND_ALLOW_TURN]);
    await expect(first).resolves.toBeUndefined();

    await expect(
      service.requestComputerUseApproval(session, { toolCallId: "call-2", detail: "Press key" })
    ).resolves.toBeUndefined();
    expect(session.published.filter((chunk: any) => chunk.type === "ask_requested")).toHaveLength(1);
  });

  it("rejects when the user denies or supplies custom feedback", async () => {
    const wait = new InteractionWaitService();
    const service = new AskService(wait);
    const session = makeSession();

    const denied = service.requestComputerUseApproval(session, { toolCallId: "call-1" });
    const requested = await awaitRequest(wait, session);
    answer(wait, session, requested, [COMMAND_DENY], "不要点这个");
    await expect(denied).rejects.toBeInstanceOf(AskDeniedError);
    await expect(denied).rejects.toMatchObject({ feedback: "不要点这个" });
  });
});
