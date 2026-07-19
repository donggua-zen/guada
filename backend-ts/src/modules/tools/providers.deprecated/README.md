# providers — 已废弃

此目录中的 `*.provider.ts` 已被新一代插件系统（`plugins/`）取代，不再使用。

请勿在此目录添加新文件。所有新工具应通过 `PluginBase` + `PluginApi.registerTool()` 实现。

示例参考：
- `plugins/builtins/file.plugin.ts`
- `plugins/builtins/browser.plugin.ts`
- `plugins/builtins/plan.plugin.ts`

遗留文件仅供参考，部分逻辑已迁移至对应 plugin 中。
