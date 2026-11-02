/**
 * 存储端口共享类型（传输无关）
 *
 * 这里的每个类型都是**介质无关的纯数据契约**：不出现 SQL 形状、不出现文件路径、
 * 不出现事务语义。SQLite 驱动、Postgres 驱动、HTTP 远端服务都从同一份类型出发，
 * 因此换后端不会改变领域层看到的词汇。
 *
 * 时间一律用 ISO 字符串（与 JSON 线格式一致，跨介质可读、可比较、无时区歧义）。
 * 前端历史上收到的 `Date` 由调用方在出口处自行转换，端口层不做隐式转换。
 */

/** 会话类型（与 `sessions.session_type` 取值一致） */
export type SessionType = 'web' | 'bot' | 'sub_agent' | 'team' | (string & {});

/**
 * 会话元信息行（领域视图，camelCase）。
 *
 * 与 `sessions` 表的列一一对应，但列名不暴露给消费方——HTTP 驱动返回同形状 JSON 即可。
 */
export interface SessionRow {
  id: string;
  title: string | null;
  avatarUrl: string | null;
  description: string | null;
  modelId: string | null;
  agentId: string | null;
  groupId: string | null;
  /** 会话设置（受管键；落库时折叠进 data.settings） */
  settings: Record<string, any> | null;
  /** 通用扩展字段（不索引，未来新字段放这里） */
  data: Record<string, any> | null;
  sessionType: SessionType;
  archived: boolean;
  pinned: boolean;
  botId: string | null;
  platform: string | null;
  externalId: string | null;
  workspacePath: string | null;
  /** 工作目录比较键（派生列，落库供分组等值查询） */
  workspaceKey: string | null;
  parentId: string | null;
  /** 顶层祖先会话 id（主会话自身为 null） */
  rootId: string | null;
  closedAt: string | null;
  closeReason: string | null;
  createdAt: string;
  updatedAt: string;
  lastActiveAt: string | null;
}

/**
 * 工作目录筛选范围。
 *
 * 旧实现用 `workspace_key IS NULL OR workspace_key NOT IN (SELECT path_key FROM project_groups)`
 * 表达「通用桶」——这是把两个表的关系塞进一条 SQL。端口把它显式成三态语义，
 * 由驱动自行决定如何解析（SQL 驱动用子查询，HTTP 驱动由服务端按已注册分组求差集）：
 * - `exact`：仅该目录键
 * - `general`：未注册目录 + 空路径（含自动生成目录与 public）
 * - `all`：不过滤
 */
export interface WorkspaceScope {
  scope: 'exact' | 'general' | 'all';
  /** `scope='exact'` 时必填 */
  workspaceKey?: string;
}

/**
 * 结构化查询过滤（tri-state 语义）：
 * - `groupId`：null = 仅未分组，undefined = 不过滤
 * - `archived`：undefined = 不过滤
 * - `pinned`：undefined = 不过滤（true = 仅置顶，false = 排除置顶）
 */
export interface SessionQueryFilter {
  sessionType?: SessionType;
  /** 排除的会话类型（目录分组侧栏排除 bot / sub_agent） */
  excludeSessionTypes?: SessionType[];
  archived?: boolean;
  pinned?: boolean;
  groupId?: string | null;
  /** 工作目录范围（缺省 = 不过滤） */
  workspace?: WorkspaceScope;
  /** 标题子串（大小写不敏感） */
  keyword?: string;
  parentId?: string;
  botId?: string;
}

export type SessionSortKey = 'lastActiveDesc' | 'updatedDesc' | 'createdAsc';

/** LIMIT/OFFSET 分页（limit 省略 = 不分页） */
export interface SessionQueryPage {
  skip?: number;
  limit?: number;
}

/** queryPaged 返回：页内行 + 同快照的总行数 */
export interface PagedSessionRows {
  rows: SessionRow[];
  total: number;
}

/** 会话分组（`session_groups` 表行） */
export interface SessionGroupRow {
  id: string;
  name: string;
  sortOrder: number;
  /** 自定义图标 key（null = 默认文件夹） */
  icon: string | null;
  createdAt: string;
  updatedAt: string;
  /** 通用扩展字段（不索引） */
  data?: Record<string, any> | null;
}

/**
 * 目录分组（`project_groups` 表行）。
 *
 * 身份用 `id`（与路径解耦）而非路径：用户重命名/移动目录后分组名与排序不会变孤儿；
 * 成员关系仍是派生的——`session.workspaceKey === group.pathKey`。
 */
export interface ProjectGroupRow {
  id: string;
  /** 展示用原始路径（首次注册时的写法） */
  path: string;
  /** 归一化比较键，唯一 */
  pathKey: string;
  name: string;
  /** 用户改过名（启动期注册永不覆盖） */
  nameOverridden: boolean;
  icon: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
}

/** 目录分组候选（启动期一次性注册扫描的结果行） */
export interface ProjectGroupCandidate {
  pathKey: string;
  path: string | null;
  /** 该目录下最近活跃时间（ISO）；无行时为 null */
  lastActive: string | null;
}

/** 新建会话入参（驱动负责补默认值与派生列） */
export interface CreateSessionInput {
  id?: string;
  title?: string | null;
  avatarUrl?: string | null;
  description?: string | null;
  modelId?: string | null;
  agentId?: string | null;
  groupId?: string | null;
  settings?: Record<string, any> | null;
  data?: Record<string, any> | null;
  sessionType?: SessionType;
  archived?: boolean;
  pinned?: boolean;
  botId?: string | null;
  platform?: string | null;
  externalId?: string | null;
  workspacePath?: string | null;
  parentId?: string | null;
  closedAt?: string | null;
  closeReason?: string | null;
  createdAt?: string;
  updatedAt?: string;
  lastActiveAt?: string | null;
}

/**
 * 会话资产端口（会话目录生命周期）。
 *
 * 个人版 = 文件系统目录（附件/图片/workflow 快照都住在这里）；
 * 企业版 = 对象存储或共享卷。端口只表达「这个会话的附属内容」，
 * 不暴露任何路径——调用方永远拿不到 `<sessionsBase>/<id>`。
 */
export interface SessionAssetPort {
  /** 确保会话资产容器存在（幂等） */
  ensure(sessionId: string): Promise<void>;
  /** 会话资产容器是否存在 */
  exists(sessionId: string): Promise<boolean>;
  /** 删除会话全部资产（幂等；不存在视为成功） */
  remove(sessionId: string): Promise<void>;
  /** 复制一个会话的资产到另一个会话（分支/克隆用；源不存在静默跳过） */
  copy(fromSessionId: string, toSessionId: string): Promise<void>;
  /** 列出有资产的会话 id（用于启动期收敛/迁移） */
  listIds(): Promise<string[]>;
}

/** SessionAssetPort 注入 token */
export const SESSION_ASSET_PORT = 'SessionAssetPort';
