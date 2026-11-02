/**
 * 语义色图标共享件：success/warning/error(info 圆圈系) 的内联 SVG 与 token 配色。
 * 消费方：GdToastHost（轻提示）、GdAlert（提示条）等需要「类型 → 图标+颜色」映射的组件。
 */

export type SemanticType = 'success' | 'error' | 'warning' | 'info';

/** 类型 → token 配色 class（图标描边色） */
export const semanticIconClass: Record<SemanticType, string> = {
    success: 'text-[var(--gd-color-success)]',
    error: 'text-[var(--gd-color-danger)]',
    warning: 'text-[var(--gd-color-warning)]',
    info: 'text-[var(--gd-color-info)]',
};

/** 语义图标路径数据（stroke 风格，24 viewBox）：success 勾圈 / error 叉圈 / warning 三角叹号 / info 圈 i */
export const semanticIconPaths: Record<SemanticType, string[]> = {
    success: [
        'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
        'm8.5 12.5 2.5 2.5 5-5.5',
    ],
    error: [
        'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
        'M15 9l-6 6M9 9l6 6',
    ],
    warning: [
        'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
        'M12 9v4',
        'M12 17h.01',
    ],
    info: [
        'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
        'M12 16v-4',
        'M12 8h.01',
    ],
};

/** 类型归一：error 视作 error 本体；danger 是 tag 家族的别名（在各自组件内归一） */
export function normalizeSemanticType(type?: string): SemanticType {
    const key = (type || 'info').toLowerCase();
    return (['success', 'error', 'warning', 'info'] as const).includes(key as SemanticType)
        ? (key as SemanticType)
        : 'info';
}
