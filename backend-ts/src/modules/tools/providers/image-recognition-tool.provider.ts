import { Injectable, Logger } from "@nestjs/common";
import {
  IToolProvider,
  ToolCallRequest,
  ToolCallResponse,
  ToolProviderMetadata,
} from "../interfaces/tool-provider.interface";
import { FileRepository } from "../../../common/database/file.repository";
import { UploadPathService } from "../../../common/services/upload-path.service";
import { LLMService } from "../../llm-core/llm.service";
import { PrismaService } from "../../../common/database/prisma.service";
import { SettingsStorage } from "../../../common/utils/settings-storage.util";
import { SK_MOD_VISUAL } from "../../../constants/settings.constants";
import * as fs from "fs";
import * as path from "path";

@Injectable()
export class ImageRecognitionToolProvider implements IToolProvider {
  private readonly logger = new Logger(ImageRecognitionToolProvider.name);
  namespace = "image_recognition";

  constructor(
    private fileRepo: FileRepository,
    private uploadPathService: UploadPathService,
    private llmService: LLMService,
    private prisma: PrismaService,
    private settingsStorage: SettingsStorage,
  ) { }

  async getTools(enabled?: boolean | string[]): Promise<any[]> {
    const toolsConfig = [
      {
        name: "recognize",
        description: "识别图片内容并返回详细的文本描述。当用户询问关于上传图片的内容时使用此工具。",
        parameters: {
          type: "object",
          properties: {
            image_id: {
              type: "string",
              description: "要识别的图片文件 ID",
            },
          },
          required: ["image_id"],
        },
      },
    ];
    
    if (enabled === false) return [];
    
    // 如果是数组，只返回数组中指定的工具
    if (Array.isArray(enabled)) {
      return toolsConfig.filter(tool => enabled.includes(tool.name));
    }
    
    // true 或未指定：返回所有工具
    return toolsConfig;
  }

  async execute(request: ToolCallRequest, context?: Record<string, any>): Promise<string> {
    if (request.name === "recognize") {
      return this.handleRecognize(request);
    }

    throw new Error(`未知工具：${request.name}`);
  }

  async getPrompt(context?: Record<string, any>): Promise<string> {
    return `【图片识别工具使用说明】
你可以使用 \`recognize\` 工具来识别用户上传的图片内容。
当用户提到“这张图”、“图片里有什么”或上传了图片并询问相关内容时，请调用此工具。
工具会返回图片的详细文本描述，你可以基于该描述回答用户的问题。`;
  }

  async getBriefDescription(): Promise<string> {
    return "识别用户上传的图片内容并返回详细描述";
  }

  getMetadata(): ToolProviderMetadata {
    return {
      namespace: this.namespace,
      displayName: "图像识别",
      description: "图片内容识别工具",
      isMcp: false,
      loadMode: "eager",
    };
  }

  private async handleRecognize(request: ToolCallRequest): Promise<string> {
    const args = request.arguments;
    const { image_id } = args;
    if (!image_id) {
      throw new Error("缺少参数：image_id");
    }

    const file = await this.fileRepo.findById(image_id);
    if (!file || file.fileType !== "image") {
      throw new Error(`无效的图片 ID 或文件类型不是图片：${image_id}`);
    }

    const physicalPath = this.uploadPathService.toPhysicalPath(file.url);
    if (!fs.existsSync(physicalPath)) {
      throw new Error(`图片文件不存在：${physicalPath}`);
    }

    // 异步读取图片文件，避免阻塞事件循环（图片可能很大）
    const imageBuffer = await fs.promises.readFile(physicalPath);
    const base64Data = imageBuffer.toString("base64");
    const ext = path.extname(physicalPath).toLowerCase();
    let mimeType = "image/jpeg";
    if (ext === ".png") mimeType = "image/png";
    else if (ext === ".gif") mimeType = "image/gif";
    else if (ext === ".webp") mimeType = "image/webp";

    const dataUri = `data:${mimeType};base64,${base64Data}`;

    const visualModelId = await this.settingsStorage.getSettingValue('models', SK_MOD_VISUAL);

    if (!visualModelId) {
      throw new Error("请在系统设置中配置视觉辅助模型 (defaultVisualAssistantModelId)");
    }

    const visualModelConfig = await this.prisma.model.findUnique({
      where: { id: visualModelId },
      include: { provider: true },
    });

    if (!visualModelConfig) {
      throw new Error(`配置的视觉辅助模型 (ID: ${visualModelId}) 不存在，请检查系统设置`);
    }

    const messages = [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: "请详细描述这张图片的内容。" },
          { type: "image_url" as const, image_url: { url: dataUri } },
        ],
      },
    ];

    const stream = this.llmService.completions({
      model: visualModelConfig.modelName,
      messages,
      providerConfig: visualModelConfig.provider,
      stream: false,
      thinkingEnabled: false,
      timeout: 60,
    }) as Promise<any>;

    const result = await stream;
    const description = result?.content || "无法识别图片内容";

    return description;
  }
}
