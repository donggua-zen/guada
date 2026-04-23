import { Module } from "@nestjs/common";
import { SettingsController } from "./settings.controller";
import { SettingsService } from "./settings.service";
import { GlobalSettingRepository } from "../../common/database/global-setting.repository";
import { PrismaService } from "../../common/database/prisma.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule],
  controllers: [SettingsController],
  providers: [SettingsService, GlobalSettingRepository, PrismaService],
  exports: [SettingsService],
})
export class SettingsModule {}
