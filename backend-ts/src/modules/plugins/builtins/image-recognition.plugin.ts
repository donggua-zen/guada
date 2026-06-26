import { Logger, Injectable } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import { PluginBase } from "../base-plugin";
import { PluginContext } from "../types/plugin.types";
import { FileRepository } from "../../../common/database/file.repository";
import { UploadPathService } from "../../../common/services/upload-path.service";
import { LLMService } from "../../llm-core/llm.service";
import { PrismaService } from "../../../common/database/prisma.service";
import { SettingsStorage } from "../../../common/utils/settings-storage.util";
import { WorkspaceService } from "../../../common/services/workspace.service";
import { SK_MOD_VISUAL } from "../../../constants/settings.constants";
import { resolveThinkingEffort } from "../../llm-core/utils/model-config.helper";
import { PluginApi } from "../api/plugin-api";
import { z } from "zod";

@Injectable()
export class ImageRecognitionPlugin extends PluginBase {
  private readonly logger = new Logger(ImageRecognitionPlugin.name);

  manifest = {
    id: "image_recognition",
    name: "图像识别",
    description: "图片内容识别工具",
    version: "1.0.0",
    category: "core" as const,
  };

  constructor(
    private fileRepo: FileRepository,
    private uploadPathService: UploadPathService,
    private llmService: LLMService,
    private prisma: PrismaService,
    private settingsStorage: SettingsStorage,
    private workspaceService: WorkspaceService,
  ) {
    super();
  }

  async onLoad(api: PluginApi) {
    api.registerToolSet({
      loadMode: "lazy",
      name: "image_recognition",
      activator:
        "当需要识别用户提供图片ID或图片路径时，使用此工具集识别图片内容并返回详细描述。",
    });

    api.registerTool({
      name: "image_recognize",
      toolSet: "image_recognition",
      description:
        "识别图片内容并返回详细的文本描述。当用户询问关于上传图片的内容时使用此工具。",
      inputSchema: z.object({
        image_id: z
          .string()
          .describe("上传的图片文件 ID，通常从消息上下文中获取"),
      }),
      execute: async (args, _ctx, abortSignal) => {
        const { image_id } = args;
        if (!image_id) throw new Error("缺少参数：image_id");
        const file = await this.fileRepo.findById(image_id);
        if (!file || file.fileType !== "image")
          throw new Error(`无效的图片 ID 或文件类型不是图片：${image_id}`);
        const physicalPath = this.uploadPathService.toPhysicalPath(file.url);
        if (!fs.existsSync(physicalPath))
          throw new Error(`图片文件不存在: ${physicalPath}`);
        return this.recognizeImage(physicalPath, abortSignal);
      },
      display: { action: "识别图片", argsKey: "image_id", icon: "vision" },
    });

    api.registerTool({
      name: "image_recognize_by_path",
      toolSet: "image_recognition",
      description:
        "根据图片文件路径识别图片内容并返回详细的文本描述。当用户提供图片的绝对路径或相对路径时使用此工具。",
      inputSchema: z.object({
        image_path: z
          .string()
          .describe("图片文件的路径，可以是绝对路径或相对工作目录的相对路径"),
      }),
      execute: async (args, ctx, abortSignal) => {
        const { image_path } = args;
        if (!image_path) throw new Error("图片路径不能为空");
        let physicalPath = this.workspaceService.resolveFilePath(
          image_path,
          ctx?.workspacePath,
        );
        if (!fs.existsSync(physicalPath))
          throw new Error(`图片文件不存在：${physicalPath}`);
        return this.recognizeImage(physicalPath, abortSignal);
      },
      display: { action: "识别图片", argsKey: "image_path", icon: "vision" },
    });
  }

  private async recognizeImage(
    physicalPath: string,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    try {
      // 1. 从 settings 读取视觉模型 ID
      const visualModelId = await this.settingsStorage.getSettingValue(
        "models",
        SK_MOD_VISUAL,
      );
      if (!visualModelId) {
        throw new Error(
          "请在系统设置中配置视觉辅助模型 (defaultVisualAssistantModelId)",
        );
      }

      // 2. 从数据库查询模型完整配置（含 provider）
      const visualModelConfig = await this.prisma.model.findUnique({
        where: { id: visualModelId },
        include: { provider: true },
      });
      if (!visualModelConfig) {
        throw new Error(
          `配置的视觉辅助模型 (ID: ${visualModelId}) 不存在，请检查系统设置`,
        );
      }

      const model = visualModelConfig.modelName;
      const thinkingEffort = resolveThinkingEffort(visualModelConfig, "off");

      // 读取图片并转为 base64
      const imageBuffer = fs.readFileSync(physicalPath);
      const base64Image = imageBuffer.toString("base64");
      const ext = path.extname(physicalPath).toLowerCase().replace(".", "");
      const mimeType =
        ext === "jpg" || ext === "jpeg"
          ? "image/jpeg"
          : ext === "png"
            ? "image/png"
            : ext === "gif"
              ? "image/gif"
              : ext === "webp"
                ? "image/webp"
                : `image/${ext}`;

      const messages = [
        {
          role: "user" as const,
          content: [
            {
              type: "text" as const,
              text: "请详细描述这张图片的内容，包括但不限于：画面中的主体、人物、物体、场景、文字信息（如果有）、颜色、构图等。",
            },
            {
              type: "image_url" as const,
              image_url: { url: `data:${mimeType};base64,${base64Image}` },
            },
          ],
        },
      ];

      let result = "";
      const stream = (await this.llmService.completions({
        model,
        messages,
        stream: true,
        providerConfig: visualModelConfig.provider,
        thinkingEffort,
        abortSignal,
      })) as AsyncGenerator<any, void, unknown>;

      for await (const chunk of stream) {
        if (chunk.type === "text" && chunk.content) {
          result += chunk.content;
        }
      }
      return result || "无法识别图片内容";
    } catch (error: any) {
      this.logger.error(`图片识别失败: ${error.message}`);
      throw new Error(`图片识别失败: ${error.message}`);
    }
  }
}
