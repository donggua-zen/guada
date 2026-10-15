/**
 * KeepAwakeService —— 后端「是否在干活」经 bridge 上报给 Electron 主进程。
 *
 * 价值点：① 判据只看 ChatRunner（所有执行入口都经它）；② 上报是幂等的（每 tick 发真值），
 * 宿主重连后不依赖任何补偿逻辑；③ 断线期间不 emit（否则每 5s 刷一条告警）。
 *
 * 手法：ChatRunner 与 BridgeClient 都用替身（本服务对二者的依赖面只有两个方法），
 * 用假定时器推进轮询，断言落在 emit 的载荷与次序上。
 */
import { Logger } from "@nestjs/common";
import { KeepAwakeService } from "../../src/modules/runtime/keep-awake.service";

describe("KeepAwakeService", () => {
  let chatRunner: { hasActiveWork: jest.Mock };
  let bridgeClient: { isConnected: boolean; emit: jest.Mock };
  let service: KeepAwakeService;

  beforeEach(() => {
    jest.useFakeTimers();
    chatRunner = { hasActiveWork: jest.fn(() => false) };
    bridgeClient = { isConnected: true, emit: jest.fn() };
    service = new KeepAwakeService(chatRunner as any, bridgeClient as any);
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("初始化即上报一次当前状态（真值来自 ChatRunner）", () => {
    chatRunner.hasActiveWork.mockReturnValue(true);

    service.onModuleInit();

    expect(bridgeClient.emit).toHaveBeenCalledTimes(1);
    expect(bridgeClient.emit).toHaveBeenCalledWith("keep_awake_state", { busy: true });
  });

  it("每个 tick 都幂等上报当前真值（含从忙到闲的变化）", () => {
    service.onModuleInit();
    expect(bridgeClient.emit).toHaveBeenLastCalledWith("keep_awake_state", { busy: false });

    chatRunner.hasActiveWork.mockReturnValue(true);
    jest.advanceTimersByTime(5_000);
    expect(bridgeClient.emit).toHaveBeenLastCalledWith("keep_awake_state", { busy: true });

    // 值没变也照发：宿主侧断线会把状态复位，靠每 tick 的真值自愈
    jest.advanceTimersByTime(5_000);
    expect(bridgeClient.emit).toHaveBeenCalledTimes(3);
    expect(bridgeClient.emit).toHaveBeenLastCalledWith("keep_awake_state", { busy: true });

    chatRunner.hasActiveWork.mockReturnValue(false);
    jest.advanceTimersByTime(5_000);
    expect(bridgeClient.emit).toHaveBeenLastCalledWith("keep_awake_state", { busy: false });
  });

  it("桥未连接时不上报（避免断线期间刷 emit 告警），重连后由下一 tick 补真值", () => {
    bridgeClient.isConnected = false;
    service.onModuleInit();
    jest.advanceTimersByTime(10_000);
    expect(bridgeClient.emit).not.toHaveBeenCalled();

    bridgeClient.isConnected = true;
    chatRunner.hasActiveWork.mockReturnValue(true);
    jest.advanceTimersByTime(5_000);
    expect(bridgeClient.emit).toHaveBeenCalledWith("keep_awake_state", { busy: true });
  });

  it("onModuleDestroy 之后不再上报", () => {
    service.onModuleInit();
    expect(bridgeClient.emit).toHaveBeenCalledTimes(1);

    service.onModuleDestroy();
    jest.advanceTimersByTime(30_000);

    expect(bridgeClient.emit).toHaveBeenCalledTimes(1);
  });
});
