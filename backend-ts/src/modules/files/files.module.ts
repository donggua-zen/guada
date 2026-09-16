import { Module } from "@nestjs/common";
import { MulterModule } from "@nestjs/platform-express";
import { HttpModule } from "@nestjs/axios";
import { FilesController } from "./files.controller";
import { FileService } from "./file.service";
import { AuthModule } from "../auth/auth.module";
import { getChatUploadMaxBytes } from "./upload-limits";

import * as multer from "multer";

@Module({
  imports: [
    AuthModule,
    HttpModule,
    MulterModule.register({
      // 内存存储：图片需要完整 buffer 交给 sharp。上限由 upload-limits 统一控制，
      // 在进入 handler 之前就拒绝超限请求，避免无效请求占用内存。
      storage: multer.memoryStorage(),
      limits: {
        fileSize: getChatUploadMaxBytes(),
      },
      // 刻意不做类型/扩展名过滤：普通文件对模型只是一个路径引用，
      // 接受哪些格式由 FileService 按「是不是位图」二分决定，没有白名单。
    }),
  ],
  controllers: [FilesController],
  providers: [FileService],
  exports: [FileService], // 导出供其他模块使用
})
export class FilesModule { }
