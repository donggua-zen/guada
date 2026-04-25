import { Global, Module } from "@nestjs/common";
import { ConfigModule } from '@nestjs/config';
import { UploadPathService } from "./upload-path.service";
import { UrlService } from "./url.service";
import { SettingsStorage } from "../utils/settings-storage.util";

/**
 * 共享服务模块
 * 提供全局可用的工具服务
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [UploadPathService, UrlService, SettingsStorage],
  exports: [UploadPathService, UrlService, SettingsStorage],
})
export class SharedModule {}
