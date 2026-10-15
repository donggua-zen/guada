import { Module } from "@nestjs/common";
import { ChatModule } from "../chat/chat.module";
import { KeepAwakeService } from "./keep-awake.service";

/**
 * 运行时状态模块：把后端「现在在不在干活」这类跨域状态对外（Electron 宿主）广播。
 * BridgeModule 是全局模块，BridgeClient 无需在此 import。
 */
@Module({
  imports: [ChatModule],
  providers: [KeepAwakeService],
  exports: [KeepAwakeService],
})
export class RuntimeModule {}
