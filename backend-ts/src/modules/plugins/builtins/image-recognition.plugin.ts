import { Logger, Injectable } from "@nestjs/common";
import { promises as fs } from "fs";
import * as path from "path";
import sharp from "sharp";
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

const DEFAULT_PROMPT =
  "Describe the content of this image in detail, including but not limited to: the main subject, people, objects, scenes, text (if any), colors, and composition.";

/** Maximum total pixel count (width × height) allowed for an image sent to the vision model. */
const MAX_TOTAL_PIXELS = 1024 * 1024; // 1,048,576 pixels

const MIME_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  tiff: "image/tiff",
};

@Injectable()
export class ImageRecognitionPlugin extends PluginBase {
  private readonly logger = new Logger(ImageRecognitionPlugin.name);

  manifest = {
    id: "image_recognition",
    name: "Image Recognition",
    description: "Image content recognition tool",
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
    api.registerToolKit({
      id: "image_recognition",
      name: "Image Recognition",
      loadMode: "lazy",
      activator:
        "Use this toolkit when you need to recognize image content from a user-provided image ID or image path and return a detailed description.",
      onLoad: (toolkit) => {
        toolkit.registerTool({
          name: "image_recognize",
          description:
            "Recognize image content and return a detailed text description. Use this tool when the user asks about an uploaded image.",
          inputSchema: z.object({
            image_id: z
              .string()
              .describe("Uploaded image file ID, usually obtained from the message context"),
            prompt: z
              .string()
              .optional()
              .describe(
                "Custom prompt to guide the image recognition, e.g. 'What text is shown in this image?' or 'Describe the layout of this UI screenshot.' If not provided, a default detailed-description prompt is used.",
              ),
          }),
          execute: async (args, _ctx, abortSignal) => {
            const { image_id, prompt } = args;
            if (!image_id) throw new Error("Missing parameter: image_id");
            const file = await this.fileRepo.findById(image_id);
            if (!file || file.fileType !== "image")
              throw new Error(`Invalid image ID or file type is not an image: ${image_id}`);
            const physicalPath = this.uploadPathService.toPhysicalPath(file.url);
            try {
              await fs.access(physicalPath);
            } catch {
              throw new Error(`Image file not found: ${physicalPath}`);
            }
            return this.recognizeImage(physicalPath, prompt, abortSignal);
          },
          display: { action: "Recognize image", argsKey: "image_id", icon: "vision" },
        });

        toolkit.registerTool({
          name: "image_recognize_by_path",
          description:
            "Recognize image content from a file path and return a detailed text description. Use this tool when the user provides an absolute or relative image path.",
          inputSchema: z.object({
            image_path: z
              .string()
              .describe("Path to the image file, can be an absolute path or a relative path relative to the working directory"),
            prompt: z
              .string()
              .optional()
              .describe(
                "Custom prompt to guide the image recognition, e.g. 'What text is shown in this image?' or 'Describe the layout of this UI screenshot.' If not provided, a default detailed-description prompt is used.",
              ),
          }),
          execute: async (args, ctx, abortSignal) => {
            const { image_path, prompt } = args;
            if (!image_path) throw new Error("Image path cannot be empty");
            const physicalPath = this.workspaceService.resolveFilePath(
              image_path,
              ctx?.session.workspacePath,
            );
            try {
              await fs.access(physicalPath);
            } catch {
              throw new Error(`Image file not found: ${physicalPath}`);
            }
            return this.recognizeImage(physicalPath, prompt, abortSignal);
          },
          display: { action: "Recognize image", argsKey: "image_path", icon: "vision" },
        });
      },
    });
  }

  /**
   * If the image's total pixel count (width × height) exceeds MAX_TOTAL_PIXELS,
   * scale it down proportionally so that the total pixel count stays within the limit.
   *
   * The scale factor is derived from:  scale = sqrt(MAX / (w * h))
   * so that  newW * newH = (w * scale) * (h * scale) = scale² * w * h = MAX.
   * Math.floor on both dimensions guarantees we never exceed the limit.
   */
  private async ensureWithinPixelLimit(imageBuffer: Buffer): Promise<Buffer> {
    const metadata = await sharp(imageBuffer).metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;
    const totalPixels = width * height;

    if (totalPixels === 0 || totalPixels <= MAX_TOTAL_PIXELS) {
      return imageBuffer;
    }

    const scale = Math.sqrt(MAX_TOTAL_PIXELS / totalPixels);
    const newWidth = Math.floor(width * scale);
    const newHeight = Math.floor(height * scale);

    this.logger.debug(
      `Resizing image from ${width}x${height} (${totalPixels} px) to ${newWidth}x${newHeight} (${newWidth * newHeight} px)`,
    );

    return sharp(imageBuffer)
      .resize(newWidth, newHeight, { fit: "inside", withoutEnlargement: true })
      .toBuffer();
  }

  private async recognizeImage(
    physicalPath: string,
    prompt?: string,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    try {
      // 1. Read the visual model ID from settings
      const visualModelId = await this.settingsStorage.getSettingValue(
        "models",
        SK_MOD_VISUAL,
      );
      if (!visualModelId) {
        throw new Error(
          "Please configure a visual assistant model in system settings (defaultVisualAssistantModelId)",
        );
      }

      // 2. Query the full model configuration (including provider) from the database
      const visualModelConfig = await this.prisma.model.findUnique({
        where: { id: visualModelId },
        include: { provider: true },
      });
      if (!visualModelConfig) {
        throw new Error(
          `The configured visual assistant model (ID: ${visualModelId}) does not exist, please check system settings`,
        );
      }

      const model = visualModelConfig.modelName;
      const thinkingEffort = resolveThinkingEffort(visualModelConfig, "none");

      // Read image, resize if total pixels exceed the limit, then convert to base64
      let imageBuffer: Buffer = await fs.readFile(physicalPath);
      imageBuffer = await this.ensureWithinPixelLimit(imageBuffer);
      const base64Image = imageBuffer.toString("base64");
      const ext = path.extname(physicalPath).toLowerCase().replace(".", "");
      const mimeType = MIME_TYPES[ext] ?? `image/${ext}`;

      const userPrompt = prompt?.trim() || DEFAULT_PROMPT;

      const messages = [
        {
          role: "user" as const,
          content: [
            { type: "text" as const, text: userPrompt },
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
      return result || "Unable to recognize image content";
    } catch (error: any) {
      this.logger.error(`Image recognition failed: ${error.message}`);
      throw new Error(`Image recognition failed: ${error.message}`);
    }
  }
}
