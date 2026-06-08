
/**
 * 设置分组常量 (SG = Settings Group)
 */
export const SG_SYSTEM = 'system';
export const SG_MODELS = 'models';
export const SG_TOOLS = 'tools';

/**
 * 系统级设置键名 (SK_SYS = Setting Key System)
 */
export const SK_SYS_AUTO_LOGIN = 'autoLoginEnabled';
export const SK_SYS_WORKSPACE_BASE_DIR = 'workspaceBaseDir';

/**
 * 模型偏好设置键名 (SK_MOD = Setting Key Model)
 */
export const SK_MOD_CHAT = 'defaultChatModelId';
export const SK_MOD_SEARCH = 'defaultSearchModelId';
export const SK_MOD_SUMMARY = 'defaultSummaryModelId';
export const SK_MOD_CONTEXT_LEN = 'searchPromptContextLength';
export const SK_MOD_TITLE_MODEL = 'defaultTitleSummaryModelId';
export const SK_MOD_TITLE_PROMPT = 'defaultTitleSummaryPrompt';
export const SK_MOD_TRANS_MODEL = 'defaultTranslationModelId';
export const SK_MOD_TRANS_PROMPT = 'defaultTranslationPrompt';
export const SK_MOD_COMPRESS_MODEL = 'defaultHistoryCompressionModelId';
export const SK_MOD_COMPRESS_PROMPT = 'defaultHistoryCompressionPrompt';
export const SK_MOD_COMPRESS_ENABLE_SUMMARY = 'enableHistoryCompressionSummary'; // 是否启用历史压缩摘要功能
export const SK_MOD_VISUAL = 'defaultVisualAssistantModelId';

/**
 * 工具设置键名
 */
export const SK_TOOLS_CONFIG = 'tools';

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
