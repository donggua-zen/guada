import { Module, Global, OnModuleInit } from "@nestjs/common";
import { CommandProviderRegistry } from "./command-provider-registry.service";
import { CommandsController } from "./commands.controller";
import { AuthModule } from "../auth/auth.module";
import { SnipCommandProvider } from "./providers/snip.provider";

@Global()
@Module({
  imports: [AuthModule],
  controllers: [CommandsController],
  providers: [CommandProviderRegistry, SnipCommandProvider],
  exports: [CommandProviderRegistry],
})
export class CommandsModule implements OnModuleInit {
  constructor(
    private readonly registry: CommandProviderRegistry,
    private readonly snipProvider: SnipCommandProvider,
  ) {}

  onModuleInit() {
    this.registry.register(this.snipProvider);
  }
}
