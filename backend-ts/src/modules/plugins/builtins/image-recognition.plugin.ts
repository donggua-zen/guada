import { Logger, Injectable } from "@nestjs/common";
import { promises as fs } from "fs";
import * as path from "path";
import { PluginBase } from "../base-plugin";
import { PluginContext } from "../types/plugin.types";
import { LLMService } from "../../llm-core/llm.service";
import { PrismaService } from "../../../common/database/prisma.service";
import { SettingsStorage } from "../../../common/utils/settings-storage.util";
import type { Message } from "../../../common/types/conversation.types";
import { WorkspaceService } from "../../../common/services/workspace.service";
import { SK_MOD_VISUAL } from "../../../constants/settings.constants";
import { resolveThinkingEffort } from "../../llm-core/utils/model-config.helper";
import { PluginApi, ImageContent } from "../api/plugin-api";
import { z } from "zod";
import {
  supportsMultimodal,
  ensureWithinPixelLimit,
} from "../utils/vision-utils";
import langZh from "./image-recognition.lang.zh.json";
import langEn from "./image-recognition.lang.en.json";

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
    name: "%imageRecognition.name%",
    description: "%imageRecognition.description%",
    version: "1.1.0",
    category: "core" as const,
  };

  constructor(
    private llmService: LLMService,
    private prisma: PrismaService,
    private settingsStorage: SettingsStorage,
    private workspaceService: WorkspaceService,
  ) {
    super();
  }

  async onLoad(api: PluginApi) {
    api.registerNls("zh", langZh);
    api.registerNls("en", langEn);
    // ── Toolkit 1: image_recognize (text-only models) ──
    // Loads only when the current model does NOT support multimodal input.
    // Calls a separate vision model to produce a text description.
    api.registerToolKit({
      id: "image_recognition",
      name: "%imageRecognition.toolkitName%",
      description: "%imageRecognition.toolkitDescription%",
      loadMode: "eager",
      activator:
        "Use this toolkit when you need to recognize image content from a user-provided image path and return a detailed description.",
      handler: (ctx) => ({
        loadMode: supportsMultimodal(ctx)
          ? ("none" as const)
          : ("eager" as const),
      }),
      onLoad: (toolkit) => {
        toolkit.registerTool({
          name: "image_recognize",
          description:
            "Recognize image content and return a detailed text description. Pass image_path for the image file (absolute path, or a path relative to the session workspace).",
          inputSchema: z.object({
            image_path: z
              .string()
              .describe(
                "Path to the image file. Can be an absolute path, or a path relative to the session workspace",
              ),
            prompt: z
              .string()
              .optional()
              .describe(
                "Custom prompt to guide the image recognition, e.g. 'What text is shown in this image?' or 'Describe the layout of this UI screenshot.' If not provided, a default detailed-description prompt is used.",
              ),
          }),
          execute: async (args, ctx, abortSignal) => {
            const { image_path, prompt } = args;
            const physicalPath = await this.resolveImagePath(
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
            text: { executing: "%image_recognize.executing%", completed: "%image_recognize.completed%" },
            aggregate: { executing: "%image_recognize.aggregate.executing%", completed: "%image_recognize.aggregate.completed%" },
            argsKey: "image_path",
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
      name: "%imageRecognition.imageViewName%",
      description: "%imageRecognition.imageViewDescription%",
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
                "Path to the image file. Can be an absolute path, or a path relative to the session workspace",
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
            text: { executing: "%image_view.executing%", completed: "%image_view.completed%" },
            aggregate: { executing: "%image_view.aggregate.executing%", completed: "%image_view.aggregate.completed%" },
            argsKey: "image_path",
            icon: "vision",
          },
        });
      },
    });
  }

  /** Resolve image path to a physical file path (path-based only, no id lookup). */
  private async resolveImagePath(
    imagePath: string | undefined,
    ctx: PluginContext | undefined,
  ): Promise<string> {
    if (!imagePath) {
      throw new Error("image_path must be provided");
    }
    return this.workspaceService.resolveFilePath(
      imagePath,
      ctx?.session.workspacePath,
    );
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

      const messages: Message[] = [
        {
          id: "image_user",
          role: "user",
          kind: "user",
          source: { kind: "user" },
          metadata: {},
          content: [
            { type: "text", text: userPrompt },
            {
              type: "image",
              attachment: {
                mediaType: mimeType,
                bytes: 0,
                url: `data:${mimeType};base64,${base64Image}`,
              },
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
