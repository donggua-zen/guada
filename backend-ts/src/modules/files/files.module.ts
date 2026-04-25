import { Module } from "@nestjs/common";
import { MulterModule } from "@nestjs/platform-express";
import { FilesController } from "./files.controller";
import { FileService } from "./file.service";
import { FileRepository } from "../../common/database/file.repository";
import { PrismaService } from "../../common/database/prisma.service";
import { AuthModule } from "../auth/auth.module";
import { FileParserService } from "../knowledge-base/file-parser.service";
import * as multer from "multer";

@Module({
  imports: [
    AuthModule,
    MulterModule.register({
      storage: multer.memoryStorage(),
      limits: {
        fileSize: 50 * 1024 * 1024, // 50MB
      },
      fileFilter: (req, file, cb) => {
        // 确保文件名编码正确
        if (file.originalname) {
          // 尝试处理可能的编码问题，虽然 Multer 默认通常能处理好 UTF-8
          // 在某些 Windows 环境下可能需要 iconv-lite 等库进行转换，但先观察日志
        }
        cb(null, true);
      },
    }),
  ],
  controllers: [FilesController],
  providers: [FileService, FileRepository, PrismaService, FileParserService],
  exports: [FileService], // 导出 FileService 供其他模块使用
})
export class FilesModule { }
