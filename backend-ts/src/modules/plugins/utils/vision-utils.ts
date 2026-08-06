import sharp from "sharp";
import { Logger } from "@nestjs/common";
import { PluginContext } from "../types/plugin.types";

/** Maximum total pixel count (width × height) allowed for an image sent to a vision model. */
export const MAX_TOTAL_PIXELS = 1024 * 1024; // 1,048,576 pixels

const logger = new Logger("VisionUtils");

/** Check if the current session's model supports multimodal image input. */
export function supportsMultimodal(ctx: PluginContext | undefined): boolean {
  if (!ctx?.session) return false;
  const config = ctx.session.getModelConfig();
  return (
    config.config.inputCapabilities?.includes("image") ||
    ctx.session.supportsFeature("vision")
  );
}

/**
 * If the image's total pixel count (width × height) exceeds MAX_TOTAL_PIXELS,
 * scale it down proportionally so that the total pixel count stays within the limit.
 */
export async function ensureWithinPixelLimit(
  imageBuffer: Buffer,
): Promise<Buffer> {
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

  logger.debug(
    `Resizing image from ${width}x${height} (${totalPixels} px) to ${newWidth}x${newHeight} (${newWidth * newHeight} px)`,
  );

  return sharp(imageBuffer)
    .resize(newWidth, newHeight, { fit: "inside", withoutEnlargement: true })
    .toBuffer();
}
