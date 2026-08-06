import { Logger, Injectable } from "@nestjs/common";
import { promises as fs } from "fs";
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
import { PluginApi, ImageContent } from "../api/plugin-api";
import { z } from "zod";
import {
  supportsMultimodal,
  ensureWithinPixelLimit,
} from "../utils/vision-utils";

const DEFAULT_PROMPT =
  "Describe the content of this image in detail, including but not limited to: the main subject, people, objects, scenes, text (if any), colors, and composition.";

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
    name: "图像识别",
    description: "图像内容识别工具",
    version: "1.1.0",
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
    // ── Toolkit 1: image_recognize (text-only models) ──
    // Loads only when the current model does NOT support multimodal input.
    // Calls a separate vision model to produce a text description.
    api.registerToolKit({
      id: "image_recognition",
      name: "Image Recognition",
      loadMode: "eager",
      activator:
        "Use this toolkit when you need to recognize image content from a user-provided image ID or image path and return a detailed description.",
      handler: (ctx) => ({
        loadMode: supportsMultimodal(ctx)
          ? ("none" as const)
          : ("eager" as const),
      }),
      onLoad: (toolkit) => {
        toolkit.registerTool({
          name: "image_recognize",
          description:
            "Recognize image content and return a detailed text description. Pass image_id for an uploaded file, or image_path for a file system path.",
          inputSchema: z.object({
            image_id: z
              .string()
              .optional()
              .describe(
                "Uploaded image file ID, usually obtained from the message context",
              ),
            image_path: z
              .string()
              .optional()
              .describe(
                "Path to the image file. Can be an absolute path or a path relative to the working directory",
              ),
            prompt: z
              .string()
              .optional()
              .describe(
                "Custom prompt to guide the image recognition, e.g. 'What text is shown in this image?' or 'Describe the layout of this UI screenshot.' If not provided, a default detailed-description prompt is used.",
              ),
          }),
          execute: async (args, ctx, abortSignal) => {
            const { image_id, image_path, prompt } = args;
            const physicalPath = await this.resolveImagePath(
              image_id,
              image_path,
              ctx,
            );
            return this.recognizeImageViaVisionModel(
              physicalPath,
              prompt,
              abortSignal,
            );
          },
          display: {
            actionType: "recognize",
            argsKey: "image_id",
            icon: "vision",
          },
        });
      },
    });

    // ── Toolkit 2: image_view (multimodal models) ──
    // Loads only when the current model supports multimodal input.
    // Returns the image as base64 via the structured ToolResult protocol,
    // letting the LLM see the image directly without a separate vision model call.
    api.registerToolKit({
      id: "image_view",
      name: "Image View",
      loadMode: "eager",
      activator:
        "Use this toolkit when you need to view or analyze an image from a image path. The image will be returned to you directly for visual analysis.",
      handler: (ctx) => ({
        loadMode: supportsMultimodal(ctx)
          ? ("eager" as const)
          : ("none" as const),
      }),
      onLoad: (toolkit) => {
        toolkit.registerTool({
          name: "image_view",
          description:
            'View an image file from the file system and return it for visual analysis.',
          inputSchema: z.object({
            image_path: z
              .string()
              .describe(
                "Path to the image file. Can be an absolute path or a path relative to the working directory",
              ),
          }),
          execute: async (args, ctx) => {
            const { image_path } = args;
            const physicalPath = this.workspaceService.resolveFilePath(
              image_path,
              ctx?.session.workspacePath,
            );

            let imageBuffer: Buffer = await fs.readFile(physicalPath);
            imageBuffer = await ensureWithinPixelLimit(imageBuffer);
            const base64Data = imageBuffer.toString("base64");
            const ext = path
              .extname(physicalPath)
              .toLowerCase()
              .replace(".", "");
            const mimeType = MIME_TYPES[ext] ?? `image/${ext}`;

            return {
              content: "Image loaded successfully. It will be injected as a subsequent user message in the current conversation for your visual analysis.",
              images: [{ media_type: mimeType, data: base64Data }],
            };
          },
          display: {
            actionType: "view",
            argsKey: "image_path",
            icon: "vision",
          },
        });
      },
    });
  }

  /** Resolve image source to a physical file path. */
  private async resolveImagePath(
    imageId: string | undefined,
    imagePath: string | undefined,
    ctx: PluginContext | undefined,
  ): Promise<string> {
    if (imageId) {
      const file = await this.fileRepo.findById(imageId);
      if (!file || file.fileType !== "image")
        throw new Error(
          `Invalid image ID or file type is not an image: ${imageId}`,
        );
      return this.uploadPathService.toPhysicalPath(file.url);
    }
    if (imagePath) {
      return this.workspaceService.resolveFilePath(
        imagePath,
        ctx?.session.workspacePath,
      );
    }
    throw new Error("Either image_id or image_path must be provided");
  }

  /** Call a separate vision model to recognize the image (text-only model path). */
  private async recognizeImageViaVisionModel(
    physicalPath: string,
    prompt?: string,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    try {
      const visualModelId = await this.settingsStorage.getSettingValue(
        "models",
        SK_MOD_VISUAL,
      );
      if (!visualModelId) {
        throw new Error(
          "Please configure a visual assistant model in system settings (defaultVisualAssistantModelId)",
        );
      }

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

      let imageBuffer: Buffer = await fs.readFile(physicalPath);
      imageBuffer = await ensureWithinPixelLimit(imageBuffer);
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
