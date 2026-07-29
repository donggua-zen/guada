import { PluginBase, type PluginApi } from "../../backend-ts/src/modules/plugins";
import { z } from "zod";

export default class HelloPlugin extends PluginBase {
  manifest = {
    id: "hello-plugin",
    name: "Hello Plugin",
    version: "1.0.0",
    description: "示例外部插件",
    category: "user" as const,
  };

  async onLoad(api: PluginApi) {
    // 注册一个简单工具
    api.registerTool({
      name: "hello_say",
      description: "打个招呼。用户说你好、打招呼时使用。",
      inputSchema: z.object({
        name: z.string().describe("要称呼的名字"),
      }),
      execute: async (args) => {
        return `你好，${args.name}！这是来自外部插件的问候。`;
      },
      display: { actionType: "hello", argsKey: "name", icon: "message" },
    });

    // 注册提示词
    api.registerPrompt({
      content: "## Hello Plugin\n这是一个示例外部插件，提供 hello_say 工具。",
      frequency: "REGULAR",
      description: "Hello Plugin 说明",
    });
  }
}
