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
   * 上传会话文件
   *
   * 只做落盘与引用返回，不做任何内容解析：位图落全局附件目录（refType='store'），
   * 其余落会话工作目录下的附件子目录（refType='workspace'，url 为相对工作目录的引用）。
   * 前端发消息时原样携带该 FileRef，随事件写进 JSONL；模型侧按扩展名自行选工具读取内容。
   * 不再有 DB 记录，故也没有配套的「复制/删除」路由。
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
