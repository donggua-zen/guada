/**
 * 打包版原生资源路径修正。
 *
 * 生产包把后端的 node_modules 打进 app.asar（安装期只需写 1 个大文件，而不是 1.5 万个小文件
 * ——实测安装耗时 ≈ 文件数 × 18ms，与包体字节数无关）。绝大多数原生模块不受影响：Electron 的
 * fs / process.dlopen 补丁会把 asar 内的路径重定向到 app.asar.unpacked 下的真实文件。
 *
 * **SQLite 的 loadExtension 是例外**：它把路径直接交给原生 LoadLibrary/dlopen，不经过 Electron
 * 的补丁，asar 虚拟路径必然加载失败（`no such module: vec0`，建表就报错）。所以这条路径必须自己
 * 改写成 app.asar.unpacked 下的真实文件——对应 electron-builder 配置里的 asarUnpack。
 */
import * as path from 'path';
import sqliteVec from 'sqlite-vec';

const ASAR_SEGMENT = `app.asar${path.sep}`;
const UNPACKED_SEGMENT = `app.asar.unpacked${path.sep}`;

/** asar 内路径 → app.asar.unpacked 下的真实路径；非打包态（无 app.asar 段）原样返回 */
export function toUnpackedPath(filePath: string): string {
  return filePath.includes(ASAR_SEGMENT)
    ? filePath.replace(ASAR_SEGMENT, UNPACKED_SEGMENT)
    : filePath;
}

/**
 * 加载 sqlite-vec 扩展。
 *
 * 不用 `sqliteVec.load(db)`：它内部就是 `loadExtension(getLoadablePath())`，拿不到改写的机会。
 */
export function loadSqliteVec(db: {
  loadExtension(file: string, entrypoint?: string): void;
}): void {
  db.loadExtension(toUnpackedPath(sqliteVec.getLoadablePath()));
}
