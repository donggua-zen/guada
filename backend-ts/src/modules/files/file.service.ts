import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import { SessionMetaStore } from "../chat/session-meta.store";
import { WorkspaceService } from "../../common/services/workspace.service";
import { FileNamingService } from "../../common/services/file-naming.service";
import { FileRef } from "../../common/types/conversation.types";
import {
  isRasterImageExtension,
  mimeFromExtension,
} from "../../common/utils/media-type.util";
import { getSessionDir } from "../../common/utils/session-path.util";
import {
  transcodeImage,
  transcodePreview,
} from "../../common/utils/image-transcode.util";
import { getChatUploadMaxBytes, getChatUploadMaxMb } from "./upload-limits";

@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);

  constructor(
    private fileNamingService: FileNamingService,
    private sessionStore: SessionMetaStore,
    private workspaceService: WorkspaceService,
  ) { }

  /** 会话存在性校验（单账户：无归属校验） */
  private async assertSessionExists(sessionId: string) {
    const session = this.sessionStore.get(sessionId);
    if (!session) {
      throw new HttpException("Session not found", HttpStatus.NOT_FOUND);
    }
    return session;
  }

  /**
   * 上传文件的统一入口方法。
   *
   * 落点只有两种（见 FileRef.refType），判定依据只有一条——**是不是位图**：
   * - 位图 → 会话数据目录（<sessionsBase>/<id>/images + previews），refType='session'；
   *   图片需要缩放/缩略图，故必须经 sharp 转码；字节随会话目录删除，无孤儿、不占
   *   全局目录、不碰用户工作目录。
   * - 其余全部 → 会话工作目录下的附件子目录，refType='workspace'。
   *   一律原样落盘，不解析、不解码、不注入文本内容——模型拿到的是路径引用，
   *   需要内容时由它自己按扩展名选工具（read / document.doc_parse）。
   *
   * 没有任何扩展名白名单：普通文件既是路径引用，限制可附格式就没有意义。
   */
  async uploadFile(sessionId: string, file: any): Promise<FileRef> {
    try {
      const session = await this.assertSessionExists(sessionId);

      // 1. 验证文件
      this.validateFile(file);

      // 2. 提取文件信息（含 Windows 中文名乱码修复）
      const fileInfo = this.extractFileInfo(file);

      // 3. 按「是否位图」二分派
      if (isRasterImageExtension(fileInfo.fileExt)) {
        return await this.uploadImageFile(session, file, fileInfo);
      }
      return await this.uploadWorkspaceFile(session, file, fileInfo);
    } catch (error: any) {
      this.logger.error(`文件上传失败：${error.message}`);
      throw error;
    }
  }

  /**
   * 验证文件（文件名 / 大小）
   *
   * 刻意**不校验扩展名**：普通文件对模型只是一个路径引用，接受哪些格式不该有白名单，
   * 没有扩展名的文件（Makefile、LICENSE）同样可以附上并落盘。
   * 唯一的类型判定是「是不是位图」，它决定走哪个通道，不是准入条件。
   */
  private validateFile(file: any): void {
    if (!file) {
      throw new Error("未收到文件");
    }
    if (!file.originalname || file.originalname.trim() === "") {
      throw new Error("文件名为空");
    }

    const fileSize = file.size ?? file.buffer?.length ?? 0;
    if (!fileSize) {
      throw new Error("文件大小为 0");
    }

    const maxBytes = getChatUploadMaxBytes();
    if (fileSize > maxBytes) {
      throw new Error(
        `文件大小超出限制（最大 ${getChatUploadMaxMb()}MB，当前 ${Math.ceil(fileSize / 1024 / 1024)}MB）`,
      );
    }
  }

  /**
   * 提取文件基本信息
   */
  private extractFileInfo(file: any): {
    fileName: string;
    fileExt: string;
    fileSize: number;
  } {
    const fileName = this.repairFileNameEncoding(file.originalname);

    this.logger.debug(`Processing file originalname: ${fileName}`);

    return {
      fileName,
      fileExt: this.getFileExtension(fileName).toLowerCase(),
      fileSize: file.size ?? file.buffer?.length ?? 0,
    };
  }

  /**
   * 修复文件名乱码（Windows / multer 场景）。
   *
   * 背景：busboy 默认按 latin1 解析 Content-Disposition 里的 filename，
   * 于是 UTF-8 文件名会变成「å­£åº¦æŠ¥å'Š.pdf」这种 mojibake，
   * 把 latin1 字节还原回 UTF-8 即可修复。
   *
   * 但**不能无条件修复**：如果上游已经给出了正确的 UTF-8 文件名（换了解析器、
   * 或调用方直接传字符串），再按 latin1 编一次会把每个汉字拆成低位字节，
   * 得到一堆 U+FFFD（实测 "季度报告.pdf" → "c��J.pdf"）。
   * 判据：还原结果是合法 UTF-8 时才会没有替换字符，据此决定是否采用。
   */
  private repairFileNameEncoding(originalName: string): string {
    if (!/[^\x00-\x7F]/.test(originalName)) return originalName;
    try {
      const repaired = Buffer.from(originalName, "latin1").toString("utf-8");
      // 含替换字符说明原始字节不是合法 UTF-8 —— 名字本来就没问题，保持原样
      if (repaired.includes("\uFFFD")) return originalName;
      return repaired;
    } catch (e) {
      this.logger.warn(`Failed to fix filename encoding for: ${originalName}`);
      return originalName;
    }
  }

  /**
   * 获取文件扩展名（不含点；无扩展名返回空串）
   */
  private getFileExtension(fileName: string): string {
    const match = fileName.match(/\.([^.]+)$/);
    return match ? match[1] : "";
  }

  /** 替换文件名的扩展名（用于图片转码后让声明与字节一致） */
  private replaceExtension(fileName: string, newExt: string): string {
    const base = fileName.replace(/\.[^.]+$/, "");
    return `${base || "image"}.${newExt}`;
  }

  /**
   * 上传位图：落会话数据目录（<sessionsBase>/<id>/images + previews），refType = 'session'。
   *
   * 图片字节随会话目录一起被删除（删除/清空会话都是对会话目录的整目录 rm -rf），
   * 不再产生孤儿文件，也不占用全局上传目录与用户工作目录。
   * url 是**自包含**引用：内嵌 sessionId（sessions/<id>/images/...），解析端可直接
   * 反推会话目录，任何渲染/内联点都不需要额外上下文。
   *
   * 转码统一交给 image-transcode.util（「体积优先」的自适应质量阶梯）：目标约束是
   * **输出体积**而非最长边，避免大图产出数百 KB 直接变成模型的图片 token 成本。
   * 输出恒为 JPEG，因此 `name`/`fileExtension`/`mediaType` 必须跟着改成
   * jpg / image/jpeg —— 否则会出现「文件名 .png、声明 image/png、实际字节是 JPEG」
   * 的三方不一致，视觉模型按声明校验时会拒绝。
   *
   * 已知取舍：GIF 的动画帧会在统一 JPEG 这一步丢失（既有行为，本次未改）。
   * `bytes` 报的是**转码后实际落盘的字节数**，不是上传的原始大小——原样上报会让
   * 下游（模型侧预算、UI 展示）以为附件比实际大得多。
   */
  private async uploadImageFile(
    session: any,
    file: any,
    fileInfo: {
      fileName: string;
      fileExt: string;
      fileSize: number;
    },
  ): Promise<FileRef> {
    const outputFileName = this.replaceExtension(fileInfo.fileName, "jpg");
    let url: string;
    let previewUrl: string;
    let storedBytes: number;
    try {
      const saved = await this.saveImageWithMetadata(session, file, outputFileName);
      url = saved.url;
      previewUrl = saved.previewUrl;
      storedBytes = saved.bytes;
    } catch (error: any) {
      throw new Error(`图片上传失败：${error.message}`);
    }

    return {
      mediaType: "image/jpeg",
      bytes: storedBytes,
      name: outputFileName,
      url,
      previewUrl,
      fileExtension: "jpg",
      refType: "session",
    };
  }

  /**
   * 上传非图片附件：落会话工作目录下的附件子目录，refType = 'workspace'。
   *
   * url 存的是相对工作目录的引用（如 uploads/20260915/报告_1430_ab12cd.pdf），
   * 由请求组装阶段桥接为绝对路径（见 message-transform.pipeline 的 file-path-annotation）。
   * 文件字节原样落盘：不做文本解码、不做文档解析、不看内容。
   */
  private async uploadWorkspaceFile(
    session: any,
    file: any,
    fileInfo: { fileName: string; fileExt: string; fileSize: number },
  ): Promise<FileRef> {
    const workspaceDir = await this.workspaceService.resolveSessionWorkspaceDir(session);
    const attachDir = await this.workspaceService.resolveAttachmentDir(session);

    const pathResult = await this.fileNamingService.generateFilePathWithDate(
      attachDir,
      fileInfo.fileName,
    );
    await fs.promises.writeFile(pathResult.filePath, file.buffer);

    return {
      mediaType: mimeFromExtension(fileInfo.fileExt),
      bytes: fileInfo.fileSize,
      name: fileInfo.fileName,
      url: this.workspaceService.toWorkspaceRelativeRef(pathResult.filePath, workspaceDir),
      ...(fileInfo.fileExt ? { fileExtension: fileInfo.fileExt } : {}),
      refType: "workspace",
    };
  }

  /**
   * 保存图片并生成缩略图（输出统一为 JPEG），落会话数据目录。
   *
   * 两张图的转码都走 image-transcode.util（体积优先的自适应阶梯 + EXIF 旋转 +
   * alpha 拍平 + 解压炸弹防护 + 内部串行化），这里只负责落盘与拼引用。
   *
   * @param session 会话对象（决定 <sessionsBase>/<id>/ 前缀，url 内嵌 id 使其自包含）
   * @returns url/previewUrl 自包含引用；bytes 为**转码后原图实际落盘字节数**
   */
  private async saveImageWithMetadata(
    session: any,
    file: any,
    outputFileName: string,
  ): Promise<{ url: string; previewUrl: string; bytes: number }> {
    try {
      // 会话目录（含 id 合法性校验）；images/ 与 previews/ 是随会话删除的子目录
      const sessionDir = getSessionDir(session.id);

      // 生成带日期的文件路径（扩展名已与输出格式对齐）
      const imagePathResult = await this.fileNamingService.generateFilePathWithDate(
        path.join(sessionDir, "images"),
        outputFileName,
      );
      const previewPathResult = await this.fileNamingService.generateFilePathWithDate(
        path.join(sessionDir, "previews"),
        outputFileName,
      );

      // 1. 原图：≤ 目标体积（默认 384KB，CHAT_IMAGE_TARGET_KB 可配），最长边 ≤ 1920px
      const image = await transcodeImage(file.buffer);
      // 2. 缩略图：固定 256px / 64KB 预算，供列表与附件卡片展示
      const preview = await transcodePreview(file.buffer);

      await fs.promises.writeFile(imagePathResult.filePath, image.data);
      await fs.promises.writeFile(previewPathResult.filePath, preview.data);

      this.logger.debug(
        `图片转码：${image.width}x${image.height} → ${image.data.byteLength}B` +
          `（编码 ${image.encodes} 次${image.passthrough ? "，快速通道未重编码" : ""}` +
          `${image.overBudget ? "，已到最小档仍超目标体积" : ""}）`,
      );

      // 自包含引用：sessions/<id>/images/<相对路径>（前端展示经 toResourceUrl 识别，
      // 后端字节内联经 resolveRefPhysicalPath 的 'session' 分支反推会话目录）
      return {
        url: `sessions/${session.id}/images/${imagePathResult.relativePath}`,
        previewUrl: `sessions/${session.id}/previews/${previewPathResult.relativePath}`,
        bytes: image.data.byteLength,
      };
    } catch (error: any) {
      throw new Error(`图片处理失败: ${error.message}`);
    }
  }
}
