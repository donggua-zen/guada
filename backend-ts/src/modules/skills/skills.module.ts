import { Module, OnModuleInit } from '@nestjs/common';
import { SkillOrchestrator } from './core/skill-orchestrator.service';
import { SkillRegistry } from './core/skill-registry.service';
import { SkillDiscoveryService } from './core/skill-discovery.service';
import { SkillLoaderService } from './core/skill-loader.service';
import { SkillVersionManager } from './core/skill-version-manager.service';
import { SkillWatcherService } from './core/skill-watcher.service';
import { SkillScriptExecutor } from './execution/skill-script-executor.service';
import { SkillsController } from './api/skills.controller';

@Module({
  controllers: [SkillsController],
  providers: [
    SkillOrchestrator,
    SkillRegistry,
    SkillDiscoveryService,
    SkillLoaderService,
    SkillVersionManager,
    SkillWatcherService,
    SkillScriptExecutor,
  ],
  exports: [
    SkillOrchestrator,
  ],
})
export class SkillsModule implements OnModuleInit {
  constructor(
    private orchestrator: SkillOrchestrator,
    private watcher: SkillWatcherService,
  ) {}

  async onModuleInit() {
    // SkillOrchestrator 的 onModuleInit 会自动调用 scan
    // SkillWatcherService 的 onModuleInit 会自动启动文件监听
  }
}
