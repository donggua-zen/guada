import { Module, OnModuleInit } from '@nestjs/common';
import { SkillOrchestrator } from './core/skill-orchestrator.service';
import { SkillRegistry } from './core/skill-registry.service';
import { SkillDiscoveryService } from './core/skill-discovery.service';
import { SkillLoaderService } from './core/skill-loader.service';
import { SkillVersionManager } from './core/skill-version-manager.service';
import { SkillWatcherService } from './core/skill-watcher.service';
import { SkillBundledService } from './core/skill-bundled.service';
import { SkillsController } from './api/skills.controller';
import { ToolsModule } from '../tools/tools.module';
import { PluginManager } from '../plugins';
import { SkillPlugin } from './plugins/skill.plugin';

@Module({
  imports: [ToolsModule],
  controllers: [SkillsController],
  providers: [
    SkillOrchestrator, SkillRegistry, SkillDiscoveryService,
    SkillLoaderService, SkillVersionManager, SkillWatcherService,
    SkillBundledService, SkillPlugin,
  ],
  exports: [SkillOrchestrator],
})
export class SkillsModule implements OnModuleInit {
  constructor(
    private orchestrator: SkillOrchestrator,
    private watcher: SkillWatcherService,
    private bundledService: SkillBundledService,
    private pluginManager: PluginManager,
    private skillPlugin: SkillPlugin,
  ) {}

  async onModuleInit() {
    await this.pluginManager.registerPlugin(this.skillPlugin);
    await this.bundledService.syncBundledSkills();
    await this.orchestrator.onModuleInit();
  }
}
