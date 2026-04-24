import { Global, Module } from "@nestjs/common";
import { UploadPathService } from "./upload-path.service";
import { UrlService } from "./url.service";

/**
 * 共享服务模块
 * 提供全局可用的工具服务
 */
@Global()
@Module({
  providers: [UploadPathService, UrlService],
  exports: [UploadPathService, UrlService],
})
export class SharedModule {}
