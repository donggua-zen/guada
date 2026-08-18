import { PluginBase, type PluginApi } from "../../backend-ts/src/modules/plugins";

/**
 * Demo Settings 插件后端
 *
 * 验证链路：
 *  1. registerSlot('settings', MyPanel) → GET /plugins/slots 出现在 settings 区域
 *  2. registerRpc(getInfo/saveConfig) → 插件 UI 通过 pluginApi.call 调用
 *  3. lang/*.json NLS → meta.label 的 %demo.tabName% 被解析
 */
export default class DemoSettingsPlugin extends PluginBase {
  manifest = {
    id: "demo-settings",
    name: "Demo Settings",
    version: "1.0.0",
    description: "Slot 机制 demo 插件：设置页面板 + RPC + i18n 全链路验证",
    category: "core" as const,
  };

  async onLoad(api: PluginApi) {
    // ── 声明设置页 slot（settings 区域，single 模式）──
    api.registerSlot({
      name: "settings",
      component: "MyPanel",
      mode: "single",
      order: 500,
      meta: { label: "%demo.tabName%", group: "system" },
    });

    // ── 注册 RPC：插件 UI 通过 pluginApi.call('demo-settings', method, args) 调用 ──
    api.registerRpc({
      getInfo: async () => ({
        app: "GuaDa",
        time: new Date().toISOString(),
        from: "demo-settings plugin",
      }),
      saveConfig: async (args: any) => ({
        ok: true,
        saved: args,
        at: new Date().toISOString(),
      }),
    });

    // ── 插件 KV 数据（L2）──
    await api.setValue("installedAt", new Date().toISOString());
  }
}
