# @parcel/watcher Windows 后端补丁

上游 `@parcel/watcher@2.6.0` 的 Windows 后端有 use-after-free：`Subscription` 把裸 `this`
塞进 `mOverlapped.hEvent`，`unsubscribe()` 直接 `watcher->state = nullptr` 释放对象，而
在途的 `ReadDirectoryChangesW` 完成回调随后就会解引用这块已释放内存。表现是后端进程
**零日志退出、退出码 0xC0000005**（本项目里由切换工作区会话触发，详见
`docs/TROUBLESHOOTING.md` 第 21 节）。上游 issue
[parcel-bundler/watcher#262](https://github.com/parcel-bundler/watcher/issues/262) 到 2026-09-21
仍未修复合入。

## 目录内容

| 文件 | 说明 |
| ---- | ---- |
| `WindowsBackend.patch` | 源码补丁（上游 `src/windows/WindowsBackend.cc` 的 unified diff），可直接提交 |
| `WindowsBackend.cc` | 打补丁后的完整源文件 |
| `watcher.node` | 本地编译产物（x64 / node-api ABI 稳定，node 与 Electron 通用），md5 `20df8c54e32e0a1e317eea85a99e0ad5` |

## 生效方式

`scripts/patch-parcel-watcher.mjs`（挂在 `backend-ts` 的 `postinstall`）把上面的
`watcher.node` 覆盖到：

- `backend-ts/node_modules/@parcel/watcher-win32-x64/watcher.node`（dev：ts-node-dev 起的后端）
- `backend-ts/node_modules/.pnpm/@parcel+watcher-win32-x64@2.6.0/...`（store 链接）
- `backend-ts/node_modules_production/node_modules/@parcel/watcher-win32-x64/watcher.node`（打包进 app）

只在 win32/x64 生效；`@parcel/watcher-win32-x64` 版本不是 `2.6.0` 时**跳过并告警**，
因为补丁二进制是按 2.6.0 源码编的。手工执行：`node scripts/patch-parcel-watcher.mjs`（幂等）。

## 重新编译（升级版本 / 改补丁时）

```bash
# 1. 取源码到临时目录（保留 package.json / binding.gyp / src）
# 2. 应用补丁
patch -p1 < WindowsBackend.patch
# 3. 编译：必须清掉 VS 相关环境变量，否则 node-gyp 的 VS 探测会失败
env -u VCINSTALLDIR -u VSINSTALLDIR -u VCToolsInstallDir -u GYP_MSVS_VERSION \
  npx --yes node-gyp rebuild
# 产物 build/Release/watcher.node 覆盖本目录同名文件，并更新脚本里的 PATCHED_MD5
```

两个坑：注释必须纯 ASCII（MSVC 会按 GBK 解释 UTF-8 无 BOM 的中文字节，0x5C 会吞掉换行，
报一串假语法错误）；增量链接在临时目录下会 `LNK1103`，删掉 `build/` 全量重建即可。

## 验证

```bash
node scripts/repro-parcel-watcher-crash.js churnwrite 3000   # 打补丁前 5/5 崩 0xC0000005
node scripts/repro-parcel-watcher-crash.js events            # 事件语义回归检查，exit 0
```

上游发版修掉后：升级 `@parcel/watcher`，确认新二进制不含该缺陷，然后删除本目录与
`scripts/patch-parcel-watcher.mjs` 及其 `postinstall` 挂载。
