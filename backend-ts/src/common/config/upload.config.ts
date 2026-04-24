import { registerAs } from "@nestjs/config";
import * as path from "path";

export default registerAs("upload", () => {
  const staticDir = process.env.STATIC_DIR || "./static";
  const staticUrl = process.env.STATIC_URL || "/static";
  const baseSubDir = process.env.UPLOAD_BASE_DIR || "file_stores";

  return {
    // 物理存储根目录 (例如: ./static/file_stores)
    physicalRoot: path.join(staticDir, baseSubDir),
    // Web 访问前缀 (例如: /static/file_stores)
    publicPrefix: `${staticUrl}/${baseSubDir}`,
    // 各类文件的子目录配置
    subDirs: {
      avatar: process.env.UPLOAD_AVATAR_SUBDIR || "avatars",
      image: process.env.UPLOAD_IMAGE_SUBDIR || "images",
      preview: process.env.UPLOAD_PREVIEW_SUBDIR || "previews",
      file: process.env.UPLOAD_FILE_SUBDIR || "files",
      kb: process.env.UPLOAD_KB_SUBDIR || "knowledge-base",
    },
  };
});
