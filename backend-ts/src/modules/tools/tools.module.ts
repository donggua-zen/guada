import { Module, OnModuleInit } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { SharedModule } from "../../common/services/shared.module";
import { SettingsStorage } from "../../common/utils/settings-storage.util";
import { SettingsService } from "../settings/settings.service";
import { ToolOrchestrator } from "./tool-orchestrator.service";

import { MemoryToolProvider } from "./providers/memory-tool.provider";
import { TimeToolProvider } from "./providers/time-tool.provider";
import { ImageRecognitionToolProvider } from "./providers/image-recognition-tool.provider";
import { ShellToolProvider } from "./providers/shell-tool.provider";
import { FileToolProvider } from "./providers/file-tool.provider";
import { BrowserToolProvider } from "./providers/browser-tool.provider";

@Module({
  imports: [
    HttpModule,
    SharedModule,
  ],
  providers: [
    ToolOrchestrator,
    MemoryToolProvider,
    TimeToolProvider,
    ImageRecognitionToolProvider,
    ShellToolProvider,
    FileToolProvider,
    BrowserToolProvider,
    SettingsStorage,
    SettingsService,
  ],
  exports: [ToolOrchestrator],
})
export class ToolsModule implements OnModuleInit {
  constructor(
    private readonly toolOrchestrator: ToolOrchestrator,
    private readonly memoryProvider: MemoryToolProvider,
    private readonly timeProvider: TimeToolProvider,
    private readonly imageRecognitionProvider: ImageRecognitionToolProvider,
    private readonly shellProvider: ShellToolProvider,
    private readonly fileProvider: FileToolProvider,
    private readonly browserProvider: BrowserToolProvider,
  ) {}

  onModuleInit() {
    this.toolOrchestrator.addProvider(this.memoryProvider);
    this.toolOrchestrator.addProvider(this.timeProvider);
    this.toolOrchestrator.addProvider(this.imageRecognitionProvider);
    this.toolOrchestrator.addProvider(this.shellProvider);
    this.toolOrchestrator.addProvider(this.fileProvider);

    // 仅在 Electron 环境下注册 BrowserToolProvider
    const isElectronEnv = process.env.ELECTRON_APP === "true";
    if (isElectronEnv) {
      this.toolOrchestrator.addProvider(this.browserProvider);
      console.log("BrowserToolProvider registered (Electron environment)");
    } else {
      console.log("BrowserToolProvider skipped (non-Electron environment)");
    }
  }
}
