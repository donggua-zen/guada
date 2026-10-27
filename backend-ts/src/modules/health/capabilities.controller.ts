import { Controller, Get } from "@nestjs/common";
import { supportedSandboxModes } from "../../common/services/sandbox-policy";

/**
 * 运行时能力探测（公开路由，与 /health 同级）。
 *
 * 前端据此裁剪输入区安全档位：Windows 后端不提供 read-only。
 * 平台必须由后端给出——Web/移动端访问 Windows 后端时，客户端平台不可靠。
 */
@Controller("capabilities")
export class CapabilitiesController {
  @Get()
  get() {
    return {
      platform: process.platform,
      sandboxModes: supportedSandboxModes(),
    };
  }
}
