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
      name: "Todo Management",
      loadMode: "eager",
      activator: "Read this toolset if your task needs to be broken down into multiple steps",
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
              "# Todo Management Guide",
              "",
              "When handling complex tasks, you should proactively break them down into actionable steps, record them in files, and manage them using the file toolset (read / write / edit).",
              "",
              "## Todo File Location",
              "",
              `Todos are stored in \`${todoRoot}/todo/tasks.md\``,
              "",
              "## File Format",
              "",
              "```markdown",
              "# Todos",
              "",
              "- [ ] Step 1 description",
              "- [ ] Step 2 description",
              "- [ ] Completed step description",
              "```",
              "",
              "## Usage Guidelines",
              "",
              "1. **Create**: When the user proposes a complex task, first break it down into steps and write them into the todo file",
              "2. **Update**: After completing each step, update the file status (check the completed item)",
              "3. **Proceed**: After updating, re-read the file to review remaining tasks and continue execution",
              "4. **Append**: When new requirements arise mid-task, append new steps to the \"In Progress\" list",
              "5. **Cancel**: Mark long-postponed tasks as `- [c] description` to indicate cancellation",
              "6. **Operations**: Use \`read\` to read, \`write\` or \`edit\` to write/update",
              "7. **Conciseness**: Describe each task in one sentence, avoid verbosity",
            ].join("\n");
          },
        });
      },
    });
  }
}
