import { Injectable, Logger } from "@nestjs/common";
import * as path from "path";
import { PluginBase } from "../base-plugin";
import { PluginContext } from "../types/plugin.types";
import { PluginApi } from "../api/plugin-api";

@Injectable()
export class TodoPlugin extends PluginBase {
  private readonly logger = new Logger(TodoPlugin.name);

  manifest = {
    id: "todo",
    name: "待办事项",
    description: "任务拆解与待办事项管理指南",
    version: "1.0.0",
    category: "extended" as const,
  };

  constructor() {
    super();
  }

  async onLoad(api: PluginApi) {
    // 注册工具包（ToolKit方式，lazy 加载）
    api.registerToolKit({
      id: "todo",
      name: "待办事项",
      loadMode: "eager",
      activator: "如果你的任务需要拆解为多步骤进行，请阅读此工具集",
      onLoad: (toolkit) => {
        // 注册待办管理指南（挂载在待办工具包下，tool_load 后注入）
        toolkit.registerPrompt({
          frequency: "REGULAR",
          description: "待办事项管理指南",
          content: (context: PluginContext) => {
            const todoRoot =
              context?.session.sessionType === "sub_agent"
                ? `.guada/subagents/${context.session.sessionId}`
                : ".guada";

            return [
              "# 待办事项管理指南",
              "",
              "当你需要处理复杂任务时，应该主动将任务拆解为可执行的步骤，记录在文件中，并使用文件工具集（read / write / edit）进行管理。",
              "",
              "## 待办文件位置",
              "",
              `待办事项保存在 \`${todoRoot}/todo/tasks.md\``,
              "",
              "## 文件格式",
              "",
              "```markdown",
              "# 待办事项",
              "",
              "## 进行中",
              "- [ ] 步骤一描述",
              "- [ ] 步骤二描述",
              "",
              "## 已完成",
              "- [x] 已完成步骤描述",
              "```",
              "",
              "## 使用规范",
              "",
              "1. **创建**：用户提出复杂任务时，先拆解为多个步骤写入待办文件",
              "2. **更新**：每完成一个步骤后，更新文件状态（勾选已完成）",
              "3. **续进**：更新后重新读取文件，查看剩余任务继续执行",
              "4. **追加**：中途新增需求时，在「进行中」列表追加新步骤",
              "5. **取消**：长期搁置的任务标记为 `- [c] 描述` 表示已取消",
              "6. **操作方式**：使用 \`read\` 读取，\`write\` 或 \`edit\` 写入/更新",
              "7. **简洁**：每条任务用一句话描述，避免冗长",
            ].join("\n");
          },
        });
      },
    });
  }
}
