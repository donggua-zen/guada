/**
 * @deprecated 已废弃，微信个人号适配器改为直接透传原始文本，不再压平 Markdown。
 * 保留此函数仅用于避免外部引用报错，内部实现直接返回原文。
 */
export function coercePlainMarkdown(source: string): string {
    return source;
}
