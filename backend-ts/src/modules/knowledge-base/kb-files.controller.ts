import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  UseGuards,
  UploadedFile,
  UseInterceptors,
  Body,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { KbFileService } from "./kb-file.service";

@Controller("knowledge-bases/:kb_id/files")
@UseGuards(AuthGuard)
export class KbFilesController {
  constructor(private kbFileService: KbFileService) {}

  @Post("upload")
  @UseInterceptors(FileInterceptor("file"))
  async uploadFile(
    @Param("kb_id") kbId: string,
    @UploadedFile() file: any,
    @CurrentUser() user: any,
  ) {
    return await this.kbFileService.uploadFile(kbId, user.sub, file);
  }

  @Get()
  async listFiles(
    @Param("kb_id") kbId: string,
    @Query("skip") skip = 0,
    @Query("limit") limit = 50,
    @CurrentUser() user: any,
  ) {
    return await this.kbFileService.listFiles(
      kbId,
      user.sub,
      Number(skip),
      Number(limit),
    );
  }

  @Get(":file_id")
  async getFile(
    @Param("kb_id") kbId: string,
    @Param("file_id") fileId: string,
    @CurrentUser() user: any,
  ) {
    return await this.kbFileService.getFile(fileId, kbId, user.sub);
  }

  @Get(":file_id/status")
  async getFileStatus(
    @Param("kb_id") kbId: string,
    @Param("file_id") fileId: string,
    @CurrentUser() user: any,
  ) {
    return await this.kbFileService.getFileStatus(fileId, kbId, user.sub);
  }

  @Post("status/batch")
  async batchGetFileStatus(
    @Param("kb_id") kbId: string,
    @Body("file_ids") fileIds: string[],
    @CurrentUser() user: any,
  ) {
    return await this.kbFileService.batchGetFileStatus(fileIds, kbId, user.sub);
  }

  @Delete(":file_id")
  async deleteFile(
    @Param("kb_id") kbId: string,
    @Param("file_id") fileId: string,
    @CurrentUser() user: any,
  ) {
    const success = await this.kbFileService.deleteFileAndChunks(
      fileId,
      kbId,
      user.sub,
    );
    if (success) {
      return { message: "文件已删除", success: true };
    } else {
      throw new Error("删除失败");
    }
  }

  @Post(":file_id/retry")
  async retryFileProcessing(
    @Param("kb_id") kbId: string,
    @Param("file_id") fileId: string,
    @CurrentUser() user: any,
  ) {
    return await this.kbFileService.retryFileProcessing(fileId, kbId, user.sub);
  }

  @Get(":file_id/chunks")
  async getFileChunks(
    @Param("kb_id") kbId: string,
    @Param("file_id") fileId: string,
    @Query("skip") skip = 0,
    @Query("limit") limit = 10,
    @CurrentUser() user: any,
  ) {
    return await this.kbFileService.getFileChunks(
      fileId,
      kbId,
      user.sub,
      Number(skip),
      Number(limit),
    );
  }
}
