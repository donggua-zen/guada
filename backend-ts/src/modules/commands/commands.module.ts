import { Module, Global } from "@nestjs/common";
import { CommandProviderRegistry } from "./command-provider-registry.service";
import { CommandsController } from "./commands.controller";
import { AuthModule } from "../auth/auth.module";

@Global()
@Module({
  imports: [AuthModule],
  controllers: [CommandsController],
  providers: [CommandProviderRegistry],
  exports: [CommandProviderRegistry],
})
export class CommandsModule {}
