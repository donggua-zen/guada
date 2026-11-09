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
  Res,
  NotFoundException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { KbFileService, OnDuplicateMode } from "./kb-file.service";
import { RenameFileDto } from "./dto/rename-file.dto";
import { MoveFileDto } from "./dto/move-file.dto";
import { CreateFolderDto } from "./dto/create-folder.dto";
import {
  resolveServingMimeType,
  isKnownExtension,
} from "../../common/utils/media-type.util";
import { sniffFileHead } from "../../common/utils/file-sniff.util";
import * as fs from "fs";
import * as path from "path";

@Controller("knowledge-bases/:kb_id/files")
@UseGuards(AuthGuard)
export class KbFilesController {
  constructor(private kbFileService: KbFileService) {}

  @Post("upload")
  @UseInterceptors(FileInterceptor("file"))
  async uploadFile(
    @Param("kb_id") kbId: string,
    @UploadedFile() file: any,
    @Body("relativePath") relativePath?: string,
    /**
     * 内容重复时的策略：`keep-both`（默认，照常新建并回报 `duplicateOf`）/
     * `skip`（不新建，返回已存在的那条）/ `overwrite`（先删旧的再新建）。
     * 默认保持原行为，调用方按需显式传入。
     */
    @Body("onDuplicate") onDuplicate?: OnDuplicateMode,
  ) {
    return await this.kbFileService.uploadFile(
      kbId,
      file,
      relativePath,
      onDuplicate,
    );
  }

  @Get()
  async listFiles(
    @Param("kb_id") kbId: string,
    @Query("skip") skip = 0,
    @Query("limit") limit = 50,
  ) {
    return await this.kbFileService.listFiles(kbId, Number(skip), Number(limit));
  }

  @Get("by-parent")
  async getFilesByParent(
    @Param("kb_id") kbId: string,
    @Query("parentFolderId") parentFolderId?: string,  // null或undefined表示根目录
    @Query("skip") skip = 0,
    @Query("limit") limit = 50,
  ) {
    // 将字符串 'null' 或空字符串转换为真正的 null
    const parentId = parentFolderId && parentFolderId !== 'null' ? parentFolderId : null;
    
    return await this.kbFileService.getFilesByParent(
      kbId,
      parentId,
      Number(skip),
      Number(limit),
    );
  }

  @Get("by-path")
  async getFilesByPath(
    @Param("kb_id") kbId: string,
    @Query("path") path?: string,  // 相对路径，为空表示根目录
    @Query("skip") skip = 0,
    @Query("limit") limit = 50,
  ) {
    // 将空字符串转换为 null
    const relativePath = path && path !== '' ? path : null;
    
    return await this.kbFileService.getFilesByRelativePath(
      kbId,
      relativePath,
      Number(skip),
      Number(limit),
    );
  }

  @Get(":file_id")
  async getFile(
    @Param("kb_id") kbId: string,
    @Param("file_id") fileId: string,
  ) {
    return await this.kbFileService.getFile(fileId, kbId);
  }

  @Get(":file_id/status")
  async getFileStatus(
    @Param("kb_id") kbId: string,
    @Param("file_id") fileId: string,
  ) {
    return await this.kbFileService.getFileStatus(fileId, kbId);
  }

  @Post("status/batch")
  async batchGetFileStatus(
    @Param("kb_id") kbId: string,
    @Body("fileIds") fileIds: string[],
  ) {
    return await this.kbFileService.batchGetFileStatus(fileIds, kbId);
  }

  @Delete(":file_id")
  async deleteFile(
    @Param("kb_id") kbId: string,
    @Param("file_id") fileId: string,
  ) {
    const success = await this.kbFileService.deleteFileAndChunks(fileId, kbId);
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
  ) {
    return await this.kbFileService.retryFileProcessing(fileId, kbId);
  }

  @Get(":file_id/chunks")
  async getFileChunks(
    @Param("kb_id") kbId: string,
    @Param("file_id") fileId: string,
    @Query("skip") skip = 0,
    @Query("limit") limit = 10,
  ) {
    return await this.kbFileService.getFileChunks(
      fileId,
      kbId,
      Number(skip),
      Number(limit),
    );
  }

  /**
   * 原件直出（前端原文预览 Tab 的 iframe/<img>/fetch 数据源）。
   *
   * `<img>`/iframe 无法带 Authorization 头，走 query `?token=` 通道（auth.guard
   * 已支持，workspace raw-file 同款）。路径来自库内落盘记录，无用户可控路径。
   * 用 sendFile 而非 pipe：自带 Range/206/ETag，PDF 翻页/大文件按需加载依赖它。
   */
  @Get(":file_id/raw")
  async getRawFile(
    @Param("kb_id") kbId: string,
    @Param("file_id") fileId: string,
    @Res() res: Response,
  ) {
    const raw = await this.kbFileService.getRawFileForPreview(kbId, fileId);
    if (!raw) throw new NotFoundException("原件不存在");

    const ext = path.extname(raw.rawName).toLowerCase();
    let mimeType = resolveServingMimeType(ext);
    // 后缀未登记 → 嗅探文件头，避免真实格式被发成 octet-stream
    if (!isKnownExtension(ext)) {
      const sniff = await sniffFileHead(raw.absolutePath);
      if (sniff.mimeType) mimeType = sniff.mimeType;
    }
    res.setHeader("Content-Type", mimeType);
    // inline：预览语义；RFC 5987 编码文件名支持中文
    const asciiName = raw.rawName.replace(/[^\x20-\x7e]/g, "_");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(raw.rawName)}`,
    );

    res.sendFile(raw.absolutePath, { dotfiles: "allow" }, (err) => {
      if (!err || res.headersSent) return;
      const status = (err as any).status || ((err as any).code === "ENOENT" ? 404 : undefined);
      if (status === 404) {
        res.status(404).json({ message: "原件不存在" });
      } else {
        console.error(`[kb raw] sendFile failed: ${raw.absolutePath}: ${err.message}`);
        res.status(500).json({ message: "原件读取失败" });
      }
    });
  }

  /**
   * 去重叠解析全文（docx/xlsx/OCR 图片等无原版面可直出的格式的回退预览数据源）。
   */
  @Get(":file_id/preview-text")
  async getPreviewText(
    @Param("kb_id") kbId: string,
    @Param("file_id") fileId: string,
  ) {
    return await this.kbFileService.getDeoverlappedPreviewText(kbId, fileId);
  }

  @Post(":file_id/rename")
  async renameFile(
    @Param("kb_id") kbId: string,
    @Param("file_id") fileId: string,
    @Body() dto: RenameFileDto,
  ) {
    return await this.kbFileService.renameFile(fileId, kbId, dto.newName);
  }

  @Post(":file_id/move")
  async moveFile(
    @Param("kb_id") kbId: string,
    @Param("file_id") fileId: string,
    @Body() dto: MoveFileDto,
  ) {
    return await this.kbFileService.moveFile(
      fileId,
      kbId,
      dto.targetParentFolderId,
    );
  }

  @Post("folder")
  async createFolder(
    @Param("kb_id") kbId: string,
    @Body() dto: CreateFolderDto,
  ) {
    return await this.kbFileService.createFolder(
      kbId,
      dto.folderName,
      dto.parentFolderId || null,
    );
  }
}
