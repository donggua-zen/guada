import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * 本地密钥文件加密(密码等敏感字段非明文存储)。
 *
 * 方案:AES-256-GCM + 本地密钥文件(~/.guada/secret.key,权限 600)。
 * - 首次使用自动生成随机 32 字节密钥并落盘(仅本机用户可读);
 * - 磁盘上只保存密文(格式 "enc:v1:<iv>:<tag>:<cipher>" 的 base64 组合);
 * - 读取时解密,内存中短暂存在明文(SSH 认证必需);
 * - 不兼容旧明文数据:非 "enc:" 前缀的值视为无效,解密时返回空串。
 */

const KEY_DIR = path.join(os.homedir(), ".guada");
const KEY_FILE = path.join(KEY_DIR, "secret.key");
const PREFIX = "enc:";

function getOrCreateKey(): Buffer {
  if (fs.existsSync(KEY_FILE)) {
    const key = fs.readFileSync(KEY_FILE, "utf-8").trim();
    if (key) return Buffer.from(key, "hex");
  }
  const key = crypto.randomBytes(32);
  fs.mkdirSync(KEY_DIR, { recursive: true });
  fs.writeFileSync(KEY_FILE, key.toString("hex"), { mode: 0o600 });
  return key;
}

/** 加密明文 → "enc:<ivBase64>:<tagBase64>:<cipherBase64>" */
export function encryptSecret(plain: string): string {
  const key = getOrCreateKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

/** 解密密文 → 明文;非加密格式(旧明文/损坏数据)返回空串,不做兼容 */
export function decryptSecret(value: string): string {
  if (!value || !value.startsWith(PREFIX)) return "";
  try {
    const body = value.slice(PREFIX.length);
    const [ivB64, tagB64, cipherB64] = body.split(":");
    if (!ivB64 || !tagB64 || !cipherB64) return "";
    const key = getOrCreateKey();
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivB64, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(cipherB64, "base64")),
      decipher.final(),
    ]);
    return plain.toString("utf-8");
  } catch {
    // 解密失败(密钥更换/数据损坏)视为无效密码
    return "";
  }
}
