/**
 * 契约测试的实际驱动装配（SQLite + JSONL）
 *
 * 这一层把「端口契约」与「具体驱动」接起来：契约文件只写行为断言，
 * 驱动差异（临时目录、连接关闭）全部收在这里。
 *
 * 企业版新增驱动时，只需照本文件再写一个同样形状的装配 + 调用同一批
 * `run*Contract`，即可证明与核心实现行为等价。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { SqliteSessionMetaDriver } from '../../../src/common/store/drivers/sqlite/sqlite-session-meta.driver';
import { SqliteGroupDriver } from '../../../src/common/store/drivers/sqlite/sqlite-group.driver';
import { JsonlBackend } from '../../../src/common/persistence/jsonl-backend';
import {
  runEventLogContract,
  runProjectGroupContract,
  runSessionGroupContract,
  runSessionMetaContract,
} from './store.contract';

/** 每个用例独立的临时数据根（驱动按 SESSION_DATA_DIR 解析路径） */
function withTempRoot(): {
  root: string;
  cleanup: () => void;
  restore: () => void;
} {
  const previous = process.env.SESSION_DATA_DIR;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-contract-'));
  process.env.SESSION_DATA_DIR = root;
  return {
    root,
    restore: () => {
      if (previous === undefined) delete process.env.SESSION_DATA_DIR;
      else process.env.SESSION_DATA_DIR = previous;
    },
    cleanup: () => {
      // 先恢复 env，再删目录（Windows 句柄释放后 rm 才不报 EPERM）
      if (previous === undefined) delete process.env.SESSION_DATA_DIR;
      else process.env.SESSION_DATA_DIR = previous;
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

runSessionMetaContract('sqlite', async () => {
  const env = withTempRoot();
  const driver = new SqliteSessionMetaDriver();
  await driver.startup();
  return Object.assign(driver, {
    destroy: () => {
      driver.onModuleDestroy();
      env.cleanup();
    },
  });
});

runSessionGroupContract('sqlite', async () => {
  const env = withTempRoot();
  const meta = new SqliteSessionMetaDriver();
  const groups = new SqliteGroupDriver();
  await meta.startup();
  // 契约需要「分组 + 会话行」两类能力（删分组要解绑会话）。
  // 分组方法优先：SessionGroupPort 的 create/list/update/delete 与
  // SessionMetaPort 的 create/update 同名，必须按端口归属显式覆盖。
  const merged: any = Object.create(meta);
  for (const key of Object.getOwnPropertyNames(
    Object.getPrototypeOf(meta),
  )) {
    if (key === 'constructor') continue;
    merged[key] = (meta as any)[key].bind(meta);
  }
  for (const key of Object.getOwnPropertyNames(
    Object.getPrototypeOf(groups),
  )) {
    if (key === 'constructor') continue;
    merged[key] = (groups as any)[key].bind(groups);
  }
  // 会话行级能力用显式别名暴露（避免与分组同名方法混淆）
  merged.getSession = (id: string) => meta.get(id);
  merged.createSession = (input: any) => meta.create(input);
  merged.startup = () => meta.startup();
  return Object.assign(merged, {
    destroy: () => {
      meta.onModuleDestroy();
      groups.onModuleDestroy();
      env.cleanup();
    },
  });
});

runProjectGroupContract('sqlite', async () => {
  const env = withTempRoot();
  const meta = new SqliteSessionMetaDriver();
  const groups = new SqliteGroupDriver();
  await meta.startup();
  const merged: any = Object.create(meta);
  for (const key of Object.getOwnPropertyNames(
    Object.getPrototypeOf(meta),
  )) {
    if (key === 'constructor') continue;
    merged[key] = (meta as any)[key].bind(meta);
  }
  for (const key of Object.getOwnPropertyNames(
    Object.getPrototypeOf(groups),
  )) {
    if (key === 'constructor') continue;
    // 目录分组方法优先（与 meta 无同名冲突，但仍统一覆盖以避免原型链误判）
    merged[key] = (groups as any)[key].bind(groups);
  }
  merged.getSession = (id: string) => meta.get(id);
  merged.startup = () => meta.startup();
  return Object.assign(merged, {
    destroy: () => {
      meta.onModuleDestroy();
      groups.onModuleDestroy();
      env.cleanup();
    },
  });
});

runEventLogContract('jsonl', async () => {
  const env = withTempRoot();
  const backend = new JsonlBackend();
  return Object.assign(backend, {
    destroy: () => env.cleanup(),
  });
});
