import { Module, OnModuleInit, Logger } from "@nestjs/common";
import { RemoteWorkspaceController } from "./remote-workspace.controller";
import { RemoteWorkspaceService } from "./remote-workspace.service";
import { RemoteWorkspacePlugin } from "./remote-workspace.plugin";
import { RemoteAgentManager } from "./remote-workspace-agent-manager";
import { RemoteBindingStateService } from "./remote-binding-state.service";
import { WorkspaceToolRouter } from "./workspace-router";
import { AuthModule } from "../auth/auth.module";
import { PluginManager } from "../plugins";
import { JobsModule } from "../jobs/jobs.module";

@Module({
  imports: [AuthModule, JobsModule],
  controllers: [RemoteWorkspaceController],
  providers: [
    RemoteWorkspaceService,
    RemoteAgentManager,
    RemoteWorkspacePlugin,
    RemoteBindingStateService,
    WorkspaceToolRouter,
  ],
  exports: [
    RemoteWorkspaceService,
    RemoteAgentManager,
    RemoteBindingStateService,
    WorkspaceToolRouter,
  ],
})
export class RemoteWorkspaceModule implements OnModuleInit {
  private readonly logger = new Logger(RemoteWorkspaceModule.name);

  constructor(
    private readonly pluginManager: PluginManager,
    private readonly remoteWorkspacePlugin: RemoteWorkspacePlugin,
  ) {}

  async onModuleInit() {
    await this.pluginManager.registerPlugin(this.remoteWorkspacePlugin);
    this.logger.log("RemoteWorkspacePlugin 已注册");
  }
  // 远端连接与定时器的释放由 RemoteAgentManager.onModuleDestroy 自动完成
}
