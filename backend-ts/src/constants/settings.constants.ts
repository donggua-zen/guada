
/**
 * 设置分组常量 (SG = Settings Group)
 */
export const SG_SYSTEM = 'system';
export const SG_MODELS = 'models';
export const SG_PLUGINS = 'plugins_config';

/**
 * 系统级设置键名 (SK_SYS = Setting Key System)
 */
export const SK_SYS_WORKSPACE_BASE_DIR = 'workspaceBaseDir';
/** 会话工作目录下的聊天附件子目录名（默认 uploads；单层目录名，不含分隔符） */
export const SK_SYS_CHAT_UPLOAD_SUBDIR = 'chatUploadSubdir';
/** 聊天附件子目录的默认名（Web 非图片附件的落点） */
export const DEFAULT_CHAT_UPLOAD_SUBDIR = 'uploads';
/** 知识库存储根（空 = 用默认位置；必须本地绝对路径，不接受 UNC） */
export const SK_SYS_KB_STORAGE_ROOT = 'kbStorageRoot';
export const SK_SYS_LLM_REQUEST_TIMEOUT_MS = 'llmRequestTimeoutMs';
export const SK_SYS_LLM_IDLE_TIMEOUT_MS = 'llmIdleTimeoutMs';
/** 防休眠模式：off 不干预 / busy 仅执行任务时 / always 应用运行期间一直保持唤醒（仅桌面端生效） */
export const SK_SYS_KEEP_AWAKE_MODE = 'keepAwakeMode';
/** 防休眠模式的合法取值 */
export const KEEP_AWAKE_MODES = ['off', 'busy', 'always'] as const;
export type KeepAwakeMode = (typeof KEEP_AWAKE_MODES)[number];
/** 防休眠缺省值：桌面端无人值守场景（长任务/定时任务）默认保持唤醒 */
export const KEEP_AWAKE_MODE_DEFAULT: KeepAwakeMode = 'busy';

/**
 * 模型偏好设置键名 (SK_MOD = Setting Key Model)
 */
/**
 * @deprecated 已移除的全局默认对话模型配置键。
 * 仅用于启动期清理旧 `models.json` 中的残留；业务代码不得再读取。
 */
export const LEGACY_SK_MOD_CHAT = 'defaultChatModelId';
export const SK_MOD_SEARCH = 'defaultSearchModelId';
export const SK_MOD_SUMMARY = 'defaultSummaryModelId';
export const SK_MOD_CONTEXT_LEN = 'searchPromptContextLength';
export const SK_MOD_TITLE_MODEL = 'defaultTitleSummaryModelId';
export const SK_MOD_TITLE_PROMPT = 'defaultTitleSummaryPrompt';
export const SK_MOD_TRANS_MODEL = 'defaultTranslationModelId';
export const SK_MOD_TRANS_PROMPT = 'defaultTranslationPrompt';
export const SK_MOD_COMPRESS_MODEL = 'defaultHistoryCompressionModelId';
export const SK_MOD_VISUAL = 'defaultVisualAssistantModelId';

/** models 设置组里语义为「模型引用」的键（写入时校验） */
export const MODEL_ID_KEYS: ReadonlySet<string> = new Set([
  SK_MOD_TITLE_MODEL,
  SK_MOD_TRANS_MODEL,
  SK_MOD_COMPRESS_MODEL,
  SK_MOD_VISUAL,
  SK_MOD_SEARCH,
  SK_MOD_SUMMARY,
]);

/**
 * 工具设置键名
 */
export const SK_PLUGINS_CONFIG = 'plugins';

/**
 * OCR 设置分组
 */
export const SG_OCR = 'ocr';

/**
 * OCR 设置键名
 */
export const SK_OCR_PROVIDER = 'provider';
export const SK_OCR_UMI_HOST = 'umiHost';
export const SK_OCR_UMI_PORT = 'umiPort';
export const SK_OCR_BAIDU_API_KEY = 'baiduApiKey';
export const SK_OCR_BAIDU_SECRET_KEY = 'baiduSecretKey';

/**
 * 外观设置分组
 */
export const SG_APPEARANCE = 'appearance';

/**
 * 外观设置键名 (SK_APP = Setting Key Appearance)
 */
export const SK_APP_WALLPAPER_URL = 'wallpaperUrl';
export const SK_APP_SIDEBAR_OPACITY = 'sidebarOpacity';
export const SK_APP_CONTENT_OPACITY = 'contentOpacity';
export const SK_APP_ACRYLIC_ENABLED = 'acrylicEnabled';
export const SK_APP_BLUR_RADIUS = 'blurRadius';

/**
 * 搜索设置分组
 */
export const SG_SEARCH = 'search';

/**
 * 搜索设置键名 (SK_SRCH = Setting Key Search)
 */
export const SK_SRCH_API_KEY = 'apiKey';
export const SK_SRCH_ENABLED = 'enabled';
