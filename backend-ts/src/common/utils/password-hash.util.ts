import * as crypto from 'crypto';

const SALT_LENGTH = 16;
const KEY_LENGTH = 64;
const DIGEST = 'sha256';

export class PasswordHashUtil {
  static async hash(password: string): Promise<string> {
    const salt = crypto.randomBytes(SALT_LENGTH).toString('hex');
    const hash = crypto.scryptSync(password, salt, KEY_LENGTH).toString('hex');
    return `${salt}:${hash}`;
  }

  static async compare(password: string, hash: string): Promise<boolean> {
    const [salt, storedHash] = hash.split(':');
    if (!salt || !storedHash) {
      return false;
    }
    const computedHash = crypto.scryptSync(password, salt, KEY_LENGTH).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(storedHash), Buffer.from(computedHash));
  }
}