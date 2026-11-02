/**
 * 会话资产端口契约的 FS 驱动装配
 *
 * 契约本身（`store.contract.ts` 的 `runSessionAssetContract`）只断言行为，
 * 这里负责准备临时根目录，并提供两个测试探针：
 * - `writeProbeFile`：直接往会话目录写文件（模拟事件日志 / 资产内容）
 * - `hasFile`：判断文件是否存在
 *
 * 有这两个探针，契约才能验证「删资产不删轨迹」这条域边界——
 * 这是企业版（记录上云、附件本地）最容易踩的坑。
 */
import * as fs from 'fs/promises';
import * as path from 'path';

import {
  ASSET_SUBDIRS,
  FsSessionAssetDriver,
} from '../../../src/common/store/drivers/fs/fs-session-asset.driver';
import { runSessionAssetContract } from './store.contract';

runSessionAssetContract('fs', async () => {
  const previous = process.env.SESSION_DATA_DIR;
  const root = await fs.mkdtemp(
    path.join((await import('os')).tmpdir(), 'asset-contract-'),
  );
  process.env.SESSION_DATA_DIR = root;

  // 驱动在构造期解析根目录，env 必须先设好
  const driver = new FsSessionAssetDriver();
  const sessionsRoot = path.join(root, 'sessions');

  const sessionDir = (sessionId: string) => path.join(sessionsRoot, sessionId);

  const harness = Object.assign(driver, {
    async writeProbeFile(sessionId: string, relativePath: string) {
      const target = path.join(sessionDir(sessionId), relativePath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, 'probe', 'utf-8');
      // 确保父目录（会话目录本身）存在
      await fs.mkdir(sessionDir(sessionId), { recursive: true });
    },
    async hasFile(sessionId: string, relativePath: string) {
      try {
        await fs.access(path.join(sessionDir(sessionId), relativePath));
        return true;
      } catch {
        return false;
      }
    },
    destroy: () => {
      if (previous === undefined) delete process.env.SESSION_DATA_DIR;
      else process.env.SESSION_DATA_DIR = previous;
      // 同步清理：契约用例已跑完，句柄应已释放
      void fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
    },
  });

  return harness;
});

describe('资产子目录白名单', () => {
  it('白名单覆盖 images/previews/workflows，且不含任何事件日志文件', () => {
    expect([...ASSET_SUBDIRS].sort()).toEqual([
      'images',
      'previews',
      'workflows',
    ]);
    for (const forbidden of ['seg-0000.jsonl', 'manifest.json', 'snapshot.json']) {
      expect(ASSET_SUBDIRS as readonly string[]).not.toContain(forbidden);
    }
  });
});
