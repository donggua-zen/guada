/**
 * 模块级命令式 toast 服务（零 Vue 组件依赖，modalService / Pinia store / 组件内都可调）。
 *
 * 架构照 modalService + GdDialogHost 范式：状态是模块级 shallowReactive 队列，
 * GdToastHost（挂 App.vue）负责渲染；进出场动画由 Host 的 TransitionGroup 处理，
 * 这里只负责数据（visible 标记驱动 leave，再由 Host 在 transitionend 后出队——
 * 实现为 setTimeout(LEAVE_DURATION)）。
 */
import { shallowReactive } from 'vue';

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading';

export interface ToastItem {
    id: number;
    type: ToastType;
    /** 主体文案；notify 场景 title 单独存 */
    title?: string;
    content: string;
    /** ms；0 = 常驻（loading），需手动 close */
    duration: number;
    showClose: boolean;
}

let nextId = 1;

/** 渲染队列（GdToastHost 消费） */
export const toastStack = shallowReactive<ToastItem[]>([]);

const timers = new Map<number, ReturnType<typeof setTimeout>>();

function scheduleDismiss(item: ToastItem): void {
    if (item.duration <= 0) return;
    const existing = timers.get(item.id);
    if (existing) clearTimeout(existing);
    timers.set(item.id, setTimeout(() => dismissToast(item.id), item.duration));
}

export interface ToastOptions {
    type?: ToastType;
    /** 可选标题（notify 语义：标题加粗首行） */
    title?: string;
    content: string;
    /** 默认按 type 分级：success/info 2000、warning 2500、error 3000、loading 0（常驻） */
    duration?: number;
    showClose?: boolean;
}

export interface ToastHandle {
    id: number;
    close: () => void;
}

const DEFAULT_DURATION: Record<ToastType, number> = {
    success: 2000,
    info: 2000,
    warning: 2500,
    error: 3000,
    loading: 0,
};

/** 入队一条 toast；loading 型返回常驻句柄，业务手动 close() */
export function pushToast(options: ToastOptions): ToastHandle {
    const type = options.type ?? 'info';
    const item: ToastItem = {
        id: nextId++,
        type,
        title: options.title,
        content: options.content,
        duration: options.duration ?? DEFAULT_DURATION[type],
        showClose: options.showClose ?? type === 'error',
    };
    // 队列尾部追加；堆叠上限 5，超出把最旧的先收掉（避免误触发风暴刷屏）
    toastStack.push(item);
    while (toastStack.length > 5) {
        dismissToast(toastStack[0].id);
    }
    scheduleDismiss(item);
    return { id: item.id, close: () => dismissToast(item.id) };
}

/** 出队（TransitionGroup 对被移除元素自动播 leave 动画）；重复 dismiss 幂等返回 */
export function dismissToast(id: number): void {
    const item = toastStack.find((t) => t.id === id);
    if (!item) return;
    const timer = timers.get(id);
    if (timer) {
        clearTimeout(timer);
        timers.delete(id);
    }
    // 直接出队：TransitionGroup 会对被移除的元素自动播 leave 动画并等 transitionend 后移除 DOM
    // （不再用 visible 两段式——v-if/template 组合下 leave 没有元素可动画）
    const idx = toastStack.findIndex((t) => t.id === id);
    if (idx >= 0) toastStack.splice(idx, 1);
}

export function closeAllToasts(): void {
    for (const item of [...toastStack]) {
        dismissToast(item.id);
    }
}

/** usePopup.toast 的便捷形态：toast.success(content) / toast.loading(content) */
export const toast = {
    success: (content: string) => pushToast({ type: 'success', content }),
    error: (content: string) => pushToast({ type: 'error', content }),
    warning: (content: string) => pushToast({ type: 'warning', content }),
    info: (content: string) => pushToast({ type: 'info', content }),
    /** 常驻，返回 { close() } */
    loading: (content: string): ToastHandle => pushToast({ type: 'loading', content }),
};

/** notify 便捷形态：notify.error(title, content, options?)——options 可覆盖 duration 等 */
export const notify = {
    success: (title: string, content: string, options?: Partial<Pick<ToastOptions, 'duration' | 'showClose'>>) =>
        pushToast({ type: 'success', title, content, duration: 3000, ...options }),
    error: (title: string, content: string, options?: Partial<Pick<ToastOptions, 'duration' | 'showClose'>>) =>
        pushToast({ type: 'error', title, content, duration: 5000, ...options }),
    warning: (title: string, content: string, options?: Partial<Pick<ToastOptions, 'duration' | 'showClose'>>) =>
        pushToast({ type: 'warning', title, content, duration: 4000, ...options }),
    info: (title: string, content: string, options?: Partial<Pick<ToastOptions, 'duration' | 'showClose'>>) =>
        pushToast({ type: 'info', title, content, duration: 3000, ...options }),
};
