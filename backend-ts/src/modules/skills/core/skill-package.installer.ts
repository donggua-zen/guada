/**
 * 技能包安装器（纯函数，无 Nest 依赖）。
 *
 * 从 SkillsController 里抽出来，供「上传 ZIP / 从 URL 安装 / 市场安装」共用：
 * - 统一 SKILL.md 解析（js-yaml，支持 `description: |` 块与引号）；
 * - 统一 ZIP 解压安全校验（路径穿越、zip bomb）；
 * - 统一来源 sidecar 写入（.skill-origin.json）。
 *
 * 刻意不依赖任何 DI 容器：控制器与市场服务都直接调用，测试也无需装配模块。
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import AdmZip from 'adm-zip';
import * as yaml from 'js-yaml';
import { SkillMetadataValidator } from '../common/skill-metadata.validator';
import { SkillOrigin } from '../interfaces/skill-manifest.interface';

/** 来源 sidecar 文件名（放在技能目录内，随目录一起删除） */
export const SKILL_ORIGIN_FILE = '.skill-origin.json';

/** 解压后总大小上限（防 zip bomb） */
const MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
/** 单包文件数上限 */
const MAX_ZIP_ENTRIES = 5000;

export interface SkillInstallOptions {
  force?: boolean;
  /** 市场来源；仅在市场安装时传入，手动上传/ Git 安装不写 */
  origin?: SkillOrigin;
}

export interface SkillInstallResult {
  installed: Array<{ skillId: string }>;
  errors: Array<{ skillId: string; error: string }>;
}

interface ParsedSkillMetadata {
  name: string;
  description: string;
  version?: string;
}

/**
 * 判断 ZIP 条目路径是否安全。
 *
 * 拒绝：绝对路径、Windows 盘符路径、任何 `..` 段、空段（`a//b`）。
 * 空字符串单独交给调用方跳过（目录条目）。
 */
export function isSafeZipEntryPath(raw: string): boolean {
  const name = String(raw ?? "").replace(/\\/g, "/");
  if (!name) return false;

  // 目录条目以 "/" 结尾是合法的（如 "skill/"），先去掉再判空段
  const withoutTrailingSlash = name.endsWith("/") ? name.slice(0, -1) : name;
  if (!withoutTrailingSlash) return false;
  if (withoutTrailingSlash.startsWith("/") || /^[a-zA-Z]:/.test(withoutTrailingSlash)) {
    return false;
  }
  return !withoutTrailingSlash
    .split("/")
    .some((segment) => segment === ".." || segment === "");
}

/**
 * 解压 ZIP 到目标目录，并做两道防护：
 * 1. 拒绝绝对路径、盘符路径与 `..` 段（zip slip）；
 * 2. 限制解压后总大小与文件数（zip bomb）。
 */
export function extractZipSafely(
  zip: AdmZip | Buffer | string,
  destDir: string,
): void {
  // 不依赖 instanceof：Jest/不同模块解析路径下 adm-zip 可能出现两份类实例，
  // 鸭子类型判断更稳，也不影响生产环境的唯一实例。
  const archive = isAdmZipLike(zip) ? zip : new AdmZip(zip as Buffer | string);
  const entries = archive.getEntries();

  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new Error(
      `ZIP contains too many entries (${entries.length} > ${MAX_ZIP_ENTRIES})`,
    );
  }

  let uncompressedBytes = 0;
  for (const entry of entries) {
    const name = String(entry.entryName ?? "").replace(/\\/g, "/");
    if (!name) continue;

    if (!isSafeZipEntryPath(name)) {
      throw new Error(`Unsafe path in ZIP: ${entry.entryName}`);
    }

    uncompressedBytes += Number(entry.header?.size) || 0;
    if (uncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
      throw new Error(
        `ZIP is too large after extraction (> ${MAX_UNCOMPRESSED_BYTES} bytes)`,
      );
    }
  }

  archive.extractAllTo(destDir, true);
}

/**
 * 从已解压目录安装所有技能（支持一个包内多技能）。
 *
 * 目标目录固定为 `<skillsDir>/<manifest.name>`；已存在且 force=false 时记为该技能的错误，
 * 不影响同包内其他技能。
 */
export async function installSkillsFromDirectory(
  sourceDir: string,
  skillsDir: string,
  options: SkillInstallOptions = {},
): Promise<SkillInstallResult> {
  const result: SkillInstallResult = { installed: [], errors: [] };
  const force = options.force === true;

  const skillMdFiles = await findSkillMdFiles(sourceDir);
  if (skillMdFiles.length === 0) {
    return result;
  }

  for (const skillMdPath of skillMdFiles) {
    const skillDir = path.dirname(skillMdPath);

    const metadata = await parseSkillMetadata(skillMdPath);
    if (!metadata) {
      result.errors.push({
        skillId: path.basename(skillDir),
        error: 'Skill name not found in SKILL.md frontmatter',
      });
      continue;
    }

    const { name: manifestName, description } = metadata;

    const validationResult = SkillMetadataValidator.validateMetadata(
      manifestName,
      description,
      manifestName,
    );
    if (!validationResult.isValid) {
      result.errors.push({
        skillId: manifestName,
        error: validationResult.errors.join('; '),
      });
      continue;
    }

    const targetDir = path.join(skillsDir, manifestName);

    try {
      if (await pathExists(targetDir)) {
        if (!force) {
          result.errors.push({
            skillId: manifestName,
            error: 'Skill already exists. Use force=true to overwrite',
          });
          continue;
        }
        await fs.rm(targetDir, { recursive: true, force: true });
      }

      await fs.mkdir(path.dirname(targetDir), { recursive: true });
      await copyDirectory(skillDir, targetDir);

      if (options.origin) {
        await writeSkillOrigin(targetDir, options.origin);
      } else {
        // 包内自带的 sidecar 不可信：没有来源参数时清掉，避免伪造市场来源
        await fs
          .rm(path.join(targetDir, SKILL_ORIGIN_FILE), { force: true })
          .catch(() => undefined);
      }

      result.installed.push({ skillId: manifestName });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push({ skillId: manifestName, error: errorMessage });
    }
  }

  return result;
}

/**
 * 写入市场来源 sidecar。
 *
 * 失败时静默忽略：来源信息是「锦上添花」的元数据，复制已经成功，
 * 不该因为写不进去就把整个安装判成失败。
 */
export async function writeSkillOrigin(
  skillDir: string,
  origin: SkillOrigin,
): Promise<void> {
  const source = typeof origin?.source === 'string' ? origin.source.trim() : '';
  const itemId = typeof origin?.itemId === 'string' ? origin.itemId.trim() : '';
  if (!source || !itemId) return;

  const payload = {
    schemaVersion: 1,
    source: source.slice(0, 32),
    itemId: itemId.slice(0, 200),
    ...(origin.version ? { version: String(origin.version).slice(0, 64) } : {}),
    installedAt: origin.installedAt || new Date().toISOString(),
  };

  try {
    await fs.writeFile(
      path.join(skillDir, SKILL_ORIGIN_FILE),
      JSON.stringify(payload, null, 2),
      'utf-8',
    );
  } catch {
    // 来源元数据写失败不影响安装结果
  }
}

/**
 * 解析 SKILL.md frontmatter。
 *
 * 用 js-yaml 而不是正则：市场里的描述经常是 `description: |` 多行块，
 * 正则会把 `|` 当成描述内容，导致校验/展示都拿到错误值。
 */
export async function parseSkillMetadata(
  skillMdPath: string,
): Promise<ParsedSkillMetadata | null> {
  try {
    const content = await fs.readFile(skillMdPath, 'utf-8');
    const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return null;

    const parsed = yaml.load(match[1]);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    if (!name) return null;

    const description =
      typeof record.description === 'string' ? record.description.trim() : '';
    const version =
      typeof record.version === 'string' ? record.version.trim() : undefined;

    return { name, description, ...(version ? { version } : {}) };
  } catch {
    return null;
  }
}

/** 递归复制目录（保留既有行为：逐文件复制，不跟随符号链接语义变化） */
export async function copyDirectory(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });

  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/** 递归查找 SKILL.md（跳过隐藏目录与 node_modules） */
export async function findSkillMdFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
        results.push(...(await findSkillMdFiles(fullPath)));
      }
    } else if (entry.name === 'SKILL.md') {
      results.push(fullPath);
    }
  }

  return results;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function isAdmZipLike(value: unknown): value is AdmZip {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { getEntries?: unknown; extractAllTo?: unknown };
  return (
    typeof candidate.getEntries === "function" &&
    typeof candidate.extractAllTo === "function"
  );
}
