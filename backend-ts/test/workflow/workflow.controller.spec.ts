/**
 * WorkflowController.listRuns 合并语义
 *
 * 端点返回 = 磁盘历史 ∪ 内存快照：同 runId 内存优先（运行中权威），
 * 按 startedAt 倒序；会话归属校验不通过 → 404。
 */
import { WorkflowController } from "../../src/modules/workflow/workflow.controller";

describe("WorkflowController.listRuns 合并", () => {
  const history = [
    { runId: "wfr_old", name: "旧", status: "completed", startedAt: 100, agents: [], logs: [], lastSeq: 1 },
    { runId: "wfr_live", name: "磁盘态", status: "completed", startedAt: 300, agents: [], logs: [], lastSeq: 9 },
  ];
  const live = [
    { runId: "wfr_live", name: "运行中", status: "running", startedAt: 300, agents: [], logs: [], lastSeq: 12 },
    { runId: "wfr_new", name: "新", status: "running", startedAt: 500, agents: [], logs: [], lastSeq: 2 },
  ];

  function createController(sessionExists = true) {
    return new WorkflowController(
      { getSessionRunStates: () => live } as any,
      { listRunSnapshots: async () => history } as any,
      { getSessionById: async () => (sessionExists ? { id: "s1" } : null) } as any,
    );
  }

  it("内存覆盖同 runId 磁盘快照，按 startedAt 倒序", async () => {
    const { runs } = await createController().listRuns("s1");
    expect(runs.map((r: any) => r.runId)).toEqual(["wfr_new", "wfr_live", "wfr_old"]);
    const merged = runs.find((r: any) => r.runId === "wfr_live");
    expect(merged.status).toBe("running");
    expect(merged.name).toBe("运行中");
  });

  it("会话不存在 → 404", async () => {
    await expect(
      createController(false).listRuns("nope"),
    ).rejects.toMatchObject({ status: 404 });
  });
});
