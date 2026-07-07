import { Module, Global } from "@nestjs/common";
import { CommandProviderRegistry } from "./command-provider-registry.service";
import { CommandsController } from "./commands.controller";

@Global()
@Module({
  controllers: [CommandsController],
  providers: [CommandProviderRegistry],
  exports: [CommandProviderRegistry],
})
export class CommandsModule {}
