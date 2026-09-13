import {
  Controller,
  Post,
  Param,
  UseInterceptors,
  UploadedFile,
  UseGuards,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AuthGuard } from "../auth/auth.guard";
import { FileService } from "./file.service";

@Controller()
@UseGuards(AuthGuard)
export class FilesController {
  constructor(private readonly fileService: FileService) {}

  /**
   * 上传会话文件（支持图片、PDF、文本）
   *
   * 只做上传：落盘后返回内联 FileRef（`url` 为相对存储路径），由前端
   * 发消息时原样携带、随事件写进 JSONL。不再有 DB 记录，故也没有配套的
   * 「复制/删除」路由。
   */
  @Post("sessions/:sessionId/files")
  @UseInterceptors(FileInterceptor("file"))
  async uploadMessageFile(
    @Param("sessionId") sessionId: string,
    @UploadedFile() file: any,
  ) {
    if (!file) {
      throw new Error("No file provided");
    }
    return this.fileService.uploadFile(sessionId, file);
  }
}
