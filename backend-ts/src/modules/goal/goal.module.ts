/**
 * 会话目标模块。
 *
 * 依赖方向：GoalModule → ChatModule（拿 SessionService / ChatRunnerService /
 * LocalSlashCommandRegistry）。ChatModule **不** import GoalModule，
 * 通过注册表和事件总线解耦，避免循环依赖。
 *
 * 事实源：JSONL 事件日志（goal/change），零 _meta.db 改动。
 */
import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { PluginManager } from '../plugins/plugin.manager';
import { LocalSlashCommandRegistry } from '../chat/commands/local-slash-command.registry';
import { GoalController } from './goal.controller';
import { GoalService } from './goal.service';
import { GoalVerifierService } from './goal-verifier.service';
import { GoalCommandHandler } from './goal-command.handler';
import { GoalPlugin } from './goal.plugin';

@Module({
  imports: [AuthModule, ChatModule],
  controllers: [GoalController],
  providers: [
    GoalService,
    GoalVerifierService,
    GoalCommandHandler,
    GoalPlugin,
  ],
  exports: [GoalService],
})
export class GoalModule implements OnModuleInit {
  private readonly logger = new Logger(GoalModule.name);

  constructor(
    private readonly pluginManager: PluginManager,
    private readonly goalPlugin: GoalPlugin,
    private readonly registry: LocalSlashCommandRegistry,
    private readonly commandHandler: GoalCommandHandler,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.pluginManager.registerPlugin(this.goalPlugin);
    this.registry.register('goal', (ctx) => this.commandHandler.handle(ctx));
    this.logger.log('GoalPlugin 与 /goal 命令已注册');
  }
}
