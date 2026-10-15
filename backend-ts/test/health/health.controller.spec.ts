/**
 * HealthController —— 此前零测试（模块仅 17 行，但它是 Electron 看门狗判读后端存活的唯一依据，
 * 故障判读逻辑在 Electron 侧依赖这里的字段形状：连接被拒=进程死亡，请求超时=事件循环阻塞）。
 */
import { HealthController } from "../../src/modules/health/health.controller";

describe("HealthController", () => {
  it("返回 status=ok / 数字 uptime / ISO 时间戳", () => {
    const result = new HealthController().check();

    expect(result.status).toBe("ok");
    expect(typeof result.uptime).toBe("number");
    expect(Number.isInteger(result.uptime)).toBe(true);
    expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false);
  });

  it("uptime 来自 process.uptime 且取整", () => {
    const spy = jest.spyOn(process, "uptime").mockReturnValue(1234.789);

    try {
      expect(new HealthController().check().uptime).toBe(1235);
    } finally {
      spy.mockRestore();
    }
  });
});
