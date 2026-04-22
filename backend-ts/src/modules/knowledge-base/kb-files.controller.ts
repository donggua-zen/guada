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
import { RenameFileDto } from "./dto/rename-file.dto";
import { MoveFileDto } from "./dto/move-file.dto";
import { CreateFolderDto } from "./dto/create-folder.dto";

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
    @Body("relativePath") relativePath?: string,
  ) {
    return await this.kbFileService.uploadFile(kbId, user.sub, file, relativePath);
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

  @Get("by-parent")
  async getFilesByParent(
    @Param("kb_id") kbId: string,
    @CurrentUser() user: any,
    @Query("parentFolderId") parentFolderId?: string,  // null或undefined表示根目录
    @Query("skip") skip = 0,
    @Query("limit") limit = 50,
  ) {
    // 将字符串 'null' 或空字符串转换为真正的 null
    const parentId = parentFolderId && parentFolderId !== 'null' ? parentFolderId : null;
    
    return await this.kbFileService.getFilesByParent(
      kbId,
      user.sub,
      parentId,
      Number(skip),
      Number(limit),
    );
  }

  @Get("by-path")
  async getFilesByPath(
    @Param("kb_id") kbId: string,
    @CurrentUser() user: any,
    @Query("path") path?: string,  // 相对路径，为空表示根目录
    @Query("skip") skip = 0,
    @Query("limit") limit = 50,
  ) {
    // 将空字符串转换为 null
    const relativePath = path && path !== '' ? path : null;
    
    return await this.kbFileService.getFilesByRelativePath(
      kbId,
      user.sub,
      relativePath,
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
    @Body("fileIds") fileIds: string[],
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

  @Post(":file_id/rename")
  async renameFile(
    @Param("kb_id") kbId: string,
    @Param("file_id") fileId: string,
    @Body() dto: RenameFileDto,
    @CurrentUser() user: any,
  ) {
    return await this.kbFileService.renameFile(
      fileId,
      kbId,
      user.sub,
      dto.newName,
    );
  }

  @Post(":file_id/move")
  async moveFile(
    @Param("kb_id") kbId: string,
    @Param("file_id") fileId: string,
    @Body() dto: MoveFileDto,
    @CurrentUser() user: any,
  ) {
    return await this.kbFileService.moveFile(
      fileId,
      kbId,
      user.sub,
      dto.targetParentFolderId,
    );
  }

  @Post("folder")
  async createFolder(
    @Param("kb_id") kbId: string,
    @Body() dto: CreateFolderDto,
    @CurrentUser() user: any,
  ) {
    return await this.kbFileService.createFolder(
      kbId,
      user.sub,
      dto.folderName,
      dto.parentFolderId || null,
    );
  }
}
