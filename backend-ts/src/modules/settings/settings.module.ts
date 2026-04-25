import { Module } from "@nestjs/common";
import { SettingsController } from "./settings.controller";
import { SettingsService } from "./settings.service";
import { AuthModule } from "../auth/auth.module";
import { ToolsModule } from "../tools/tools.module";

@Module({
  imports: [AuthModule, ToolsModule],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
