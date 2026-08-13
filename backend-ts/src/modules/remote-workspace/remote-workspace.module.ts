import { Module, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";
import { RemoteWorkspaceController } from "./remote-workspace.controller";
import { RemoteWorkspaceService } from "./remote-workspace.service";
import { RemoteWorkspacePlugin } from "./remote-workspace.plugin";
import { AuthModule } from "../auth/auth.module";
import { PluginManager } from "../plugins";

@Module({
  imports: [AuthModule],
  controllers: [RemoteWorkspaceController],
  providers: [RemoteWorkspaceService, RemoteWorkspacePlugin],
  exports: [RemoteWorkspaceService],
})
export class RemoteWorkspaceModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RemoteWorkspaceModule.name);

  constructor(
    private readonly pluginManager: PluginManager,
    private readonly remoteWorkspacePlugin: RemoteWorkspacePlugin,
  ) {}

  async onModuleInit() {
    await this.pluginManager.registerPlugin(this.remoteWorkspacePlugin);
    this.logger.log("RemoteWorkspacePlugin 已注册");
  }

  onModuleDestroy() {
    // 模块销毁时释放所有远端连接与定时器
    this.remoteWorkspacePlugin.dispose();
    this.logger.log("RemoteWorkspaceModule destroyed: connections released");
  }
}
