import { Global, Module, OnModuleInit, forwardRef } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { WorkspaceProviderResolver } from "./workspace-provider.resolver";
import { LocalWorkspaceProvider } from "./local-workspace-provider";
import { ProcessManagerService } from "../../modules/shell/process-manager.service";

/**
 * WorkspaceModule — global provider for WorkspaceProvider abstraction.
 *
 * Exports WorkspaceProviderResolver for injection into controllers/services
 * that need to perform file/process operations on a session's workspace.
 *
 * Phase 1: interface + LocalWorkspaceProvider + Resolver. No existing call sites
 * are modified yet — migration happens in Phase 3+.
 */
@Global()
@Module({
  providers: [WorkspaceProviderResolver, LocalWorkspaceProvider],
  exports: [WorkspaceProviderResolver, LocalWorkspaceProvider],
})
export class WorkspaceModule implements OnModuleInit {
  constructor(
    private readonly localProvider: LocalWorkspaceProvider,
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * Lazily wire ProcessManagerService into LocalWorkspaceProvider.
   *
   * ProcessManagerService lives in ShellModule which may load after WorkspaceModule.
   * Using ModuleRef.get() at onModuleInit guarantees all providers are instantiated.
   */
  onModuleInit() {
    try {
      const pm = this.moduleRef.get(ProcessManagerService);
      if (pm) {
        this.localProvider.setProcessManager(pm);
      }
    } catch {
      // ProcessManagerService not yet available — will be wired when ShellModule loads
      // This is acceptable for Phase 1 (process execution migration is Phase 4)
    }
  }
}
