import type { InjectionKey } from 'vue';

/** GdSelect ↔ GdOption 注册通道（GdOption 在 setup 阶段同步注册，顺序即模板顺序） */
export interface GdSelectContext {
    register: (option: {
        getLabel: () => string;
        getValue: () => string | number;
        getDisabled: () => boolean;
        slot: (() => unknown) | null;
    }) => () => void;
}

export const gdSelectKey: InjectionKey<GdSelectContext> = Symbol('gdSelect');
