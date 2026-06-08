import { Module, OnModuleInit } from '@nestjs/common';
import { SkillOrchestrator } from './core/skill-orchestrator.service';
import { SkillRegistry } from './core/skill-registry.service';
import { SkillDiscoveryService } from './core/skill-discovery.service';
import { SkillLoaderService } from './core/skill-loader.service';
import { SkillVersionManager } from './core/skill-version-manager.service';
import { SkillWatcherService } from './core/skill-watcher.service';
import { SkillScriptExecutor } from './execution/skill-script-executor.service';
import { SkillBundledService } from './core/skill-bundled.service';
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
    SkillBundledService,
  ],
  exports: [
    SkillOrchestrator,
  ],
})
export class SkillsModule implements OnModuleInit {
  constructor(
    private orchestrator: SkillOrchestrator,
    private watcher: SkillWatcherService,
    private bundledService: SkillBundledService,
  ) {}

  async onModuleInit() {
    // 1. 先同步内置技能到 .system 目录
    await this.bundledService.syncBundledSkills();

    // 2. SkillOrchestrator 扫描所有技能（包含 .system）
    await this.orchestrator.onModuleInit();

    // SkillWatcherService 的 onModuleInit 会自动启动文件监听
  }
}
