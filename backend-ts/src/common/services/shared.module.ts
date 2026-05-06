import { Global, Module } from "@nestjs/common";
import { ConfigModule } from '@nestjs/config';
import { UploadPathService } from "./upload-path.service";
import { UrlService } from "./url.service";
import { SettingsStorage } from "../utils/settings-storage.util";
import { WorkspaceService } from "./workspace.service";
import { TokenCacheService } from "../utils/token-cache.service";

/**
 * 共享服务模块
 * 提供全局可用的工具服务
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [UploadPathService, UrlService, SettingsStorage, WorkspaceService, TokenCacheService],
  exports: [UploadPathService, UrlService, SettingsStorage, WorkspaceService, TokenCacheService],
})
export class SharedModule {}
