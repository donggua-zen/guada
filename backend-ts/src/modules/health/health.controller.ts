import { Controller, Get } from "@nestjs/common";

/**
 * 轻量健康检查端点：供 Electron 看门狗探测后端存活。
 * 故障判读在 Electron 侧完成：连接被拒 = 进程死亡；请求超时 = 事件循环阻塞。
 */
@Controller("health")
export class HealthController {
  @Get()
  check() {
    return {
      status: "ok",
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
