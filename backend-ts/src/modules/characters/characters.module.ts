import { Module, OnModuleInit, Logger } from "@nestjs/common";
import { CharactersController } from "./characters.controller";
import { CharacterService } from "./character.service";
import { CharacterSeedService } from "./character-seed.service";
import { AuthModule } from "../auth/auth.module";
import { ToolsModule } from "../tools/tools.module";
import { PluginManager } from "../plugins/plugin.manager";
import { CharacterPlugin } from "./character.plugin";

@Module({
  imports: [AuthModule, ToolsModule],
  controllers: [CharactersController],
  providers: [
    CharacterService,
    CharacterSeedService,
    CharacterPlugin,
  ],
})
export class CharactersModule implements OnModuleInit {
  private readonly logger = new Logger(CharactersModule.name);

  constructor(
    private readonly pluginManager: PluginManager,
    private readonly characterPlugin: CharacterPlugin,
  ) {}

  async onModuleInit() {
    await this.pluginManager.registerPlugin(this.characterPlugin);
    this.logger.log("CharacterPlugin 已注册");
  }
}
