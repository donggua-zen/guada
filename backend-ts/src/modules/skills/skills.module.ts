import { Module, OnModuleInit } from '@nestjs/common';
import { SkillOrchestrator } from './core/skill-orchestrator.service';
import { SkillRegistry } from './core/skill-registry.service';
import { SkillSourceManager } from './core/skill-source.manager';
import { SkillLoaderService } from './core/skill-loader.service';
import { SkillVersionManager } from './core/skill-version-manager.service';
import { SkillWatcherService } from './core/skill-watcher.service';
import { SkillsController } from './api/skills.controller';
import { ToolsModule } from '../tools/tools.module';
import { PluginManager } from '../plugins';
import { SkillPlugin } from './plugins/skill.plugin';
import { SkillBundledPlugin } from './plugins/skill-bundled.plugin';

@Module({
  imports: [ToolsModule],
  controllers: [SkillsController],
  providers: [
    SkillOrchestrator, SkillRegistry, SkillSourceManager,
    SkillLoaderService, SkillVersionManager, SkillWatcherService,
    SkillPlugin, SkillBundledPlugin,
  ],
  exports: [SkillOrchestrator],
})
export class SkillsModule implements OnModuleInit {
  constructor(
    private orchestrator: SkillOrchestrator,
    private watcher: SkillWatcherService,
    private sourceManager: SkillSourceManager,
    private pluginManager: PluginManager,
    private skillPlugin: SkillPlugin,
    private skillBundledPlugin: SkillBundledPlugin,
  ) {}

  async onModuleInit() {
    await this.pluginManager.registerPlugin(this.skillPlugin);
    // 内置技能作为独立插件注册（可单独启用/停用）
    await this.pluginManager.registerPlugin(this.skillBundledPlugin);

    // watcher 不传初始路径，所有路径由 SkillSourceManager 的 addWatch 添加
    await this.watcher.start();
    // 注册 system + global 来源，扫描技能
    await this.sourceManager.start();
    await this.orchestrator.onModuleInit();
  }
}
