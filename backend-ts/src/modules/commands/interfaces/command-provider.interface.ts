/** 命令请求上下文（由调用方传递，供 provider 做会话级过滤） */
export interface CommandContext {
  sessionId?: string;
  characterId?: string | null;
  /** 本次消息中提取到的标记总数（TagParserPipeline 透传，供 parse 判断单/多命令注入策略） */
  commandCount?: number;
}

/** 解析器单次产出 */
export interface ParserResult {
  /** 原地替换文本（针对单个标签）。当前管线正文不改写，仅作语义占位 */
  replacement: string;
  /**
   * 可选附录：解析产物的注入文案（如技能完整指令或轻量提示）。
   * 由管线冻结为 origin='system' 注入块随消息落库，不再拼接到正文。
   */
  appendix?: string;
}

/** 命令项（前端 picker 展示用） */
export interface CommandItem {
  /** 选中值，如 "coder"（对应标签中冒号后的部分） */
  name: string;
  /** 前端展示描述 */
  description: string;
  /** 可附加的自定义字段 */
  [key: string]: any;
}

/** 命令提供者：插件通过此接口注册斜杠/艾特命令 */
export interface ICommandProvider {
  /** 唯一标识，如 "skill"（对应标签 type） */
  id: string;
  /** 触发方式 */
  trigger: 'slash' | 'mention';
  /** 获取命令列表 */
  fetchItems(ctx?: CommandContext): CommandItem[] | Promise<CommandItem[]>;
  /**
   * 解析标签属性，返回替换文本 + 可选附录
   * 接收从 [/type:name key="val"] 中提取的 attrs（name 已合并入内）
   * 返回 undefined 表示不支持的解析，原样保留
   */
  parse(attrs: Record<string, string>, ctx?: CommandContext): ParserResult | undefined | Promise<ParserResult | undefined>;
}
