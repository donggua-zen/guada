import { APP_BOOT_ID } from "../../common/utils/boot-id.util";
import {
  SIDEBAR_STATE_CHANGED,
  SidebarStateService,
} from "./sidebar-state.service";

describe("SidebarStateService", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function createService() {
    const emit = jest.fn();
    const service = new SidebarStateService({ emit } as any);
    return { service, emit };
  }

  it("snapshot 带 bootId 与单调 revision", () => {
    const { service } = createService();
    const before = service.snapshot();
    expect(before).toMatchObject({
      scope: "sidebar",
      bootId: APP_BOOT_ID,
      revision: 0,
    });

    service.touch("a");
    service.touch("b");
    expect(service.snapshot().revision).toBe(2);
  });

  it("300ms 内多次 touch 合并为一次广播，payload 取最新修订号", () => {
    const { service, emit } = createService();

    service.touch("first");
    jest.advanceTimersByTime(100);
    service.touch("second");

    expect(emit).not.toHaveBeenCalled();
    // 固定窗口：从第一次 touch 起算 300ms，不是从最后一次 touch 滑动
    jest.advanceTimersByTime(199);
    expect(emit).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      SIDEBAR_STATE_CHANGED,
      expect.objectContaining({
        scope: "sidebar",
        bootId: APP_BOOT_ID,
        revision: 2,
        reason: "second",
      }),
    );
  });

  it("广播后再次 touch 开启新一轮合并", () => {
    const { service, emit } = createService();

    service.touch("first");
    jest.advanceTimersByTime(300);
    service.touch("second");
    jest.advanceTimersByTime(300);

    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[1][1]).toMatchObject({
      revision: 2,
      reason: "second",
    });
  });

  it("销毁时清掉未触发的广播", () => {
    const { service, emit } = createService();
    service.touch("pending");
    service.onModuleDestroy();
    jest.advanceTimersByTime(1000);
    expect(emit).not.toHaveBeenCalled();
  });
});
