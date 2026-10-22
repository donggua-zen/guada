/**
 * 会话图片落盘（单一副本 + 前端缩略图）
 *
 * 设计边界：
 * - **一份原图副本**落在 `sessions/<id>/images/<YYYYMMDD>/`，是模型请求、`image_view`、
 *   前端原图查看共用的唯一来源；`previews/` 只是给列表渲染的缩略图（~6KB），不是第二份原图。
 * - 转码预算与引擎物化一致（工具图 150KB / 最长边 1920 / 恒为 JPEG），保证上游请求体可控。
 * - 由 browser-script（截图字节直达）与 AgentEngine（MCP/image_view 的 base64 兜底）
 *   共用，避免两处各写一套转码 + 命名 + 落盘逻辑。
 *
 * 生命周期：图片随会话目录删除（删会话 = 整目录 rm -rf），无需删除钩子。
 */
import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { FileRef } from '../types/conversation.types';
import { getSessionDir } from '../utils/session-path.util';
import {
  getToolImageTargetBytes,
  transcodeImage,
  transcodePreview,
} from '../utils/image-transcode.util';
import { FileNamingService } from './file-naming.service';

export interface SessionImageSaveOptions {
  /** 文件名主干（不含扩展名）；缺省 tool-image */
  baseName?: string;
}

export interface SessionImageSaveResult {
  /** 持久化用的路径指针（refType='session'，自包含 sessions/<id>/...） */
  ref: FileRef;
  /** 原图副本的物理绝对路径（模型工具可直接读；日志/排障用） */
  absolutePath: string;
}

@Injectable()
export class SessionImageStore {
  constructor(private readonly fileNaming: FileNamingService) {}

  /**
   * 字节 → 转码（工具图预算）→ 写 `images/` 与 `previews/` → 返回 session 引用。
   * 调用方负责传入会话 id（不得跨会话写入）。
   */
  async save(
    sessionId: string,
    buffer: Buffer,
    opts: SessionImageSaveOptions = {},
  ): Promise<SessionImageSaveResult> {
    const sessionDir = getSessionDir(sessionId);
    const stem =
      (opts.baseName ?? 'tool-image').replace(/\.[^.]+$/, '') || 'tool-image';

    // 先完成两次转码再落盘：避免只写了一半（原图已写、缩略图失败）
    const image = await transcodeImage(buffer, {
      targetBytes: getToolImageTargetBytes(),
    });
    const preview = await transcodePreview(buffer);

    const imageRes = await this.fileNaming.generateFilePathWithDate(
      path.join(sessionDir, 'images'),
      `${stem}.jpg`,
    );
    const previewRes = await this.fileNaming.generateFilePathWithDate(
      path.join(sessionDir, 'previews'),
      `${stem}.jpg`,
    );

    await fs.writeFile(imageRes.filePath, image.data);
    await fs.writeFile(previewRes.filePath, preview.data);

    return {
      ref: {
        mediaType: 'image/jpeg',
        bytes: image.data.byteLength,
        name: imageRes.fileName,
        url: `sessions/${sessionId}/images/${imageRes.relativePath}`,
        previewUrl: `sessions/${sessionId}/previews/${previewRes.relativePath}`,
        fileExtension: 'jpg',
        refType: 'session',
      },
      absolutePath: imageRes.filePath,
    };
  }
}
