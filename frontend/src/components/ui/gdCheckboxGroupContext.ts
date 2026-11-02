import type { InjectionKey } from 'vue';

/** GdCheckboxGroup ↔ Option 注册通道 */
export interface GdCheckboxGroupContext {
    register: (option: {
        getValue: () => string | number;
        getDisabled: () => boolean;
    }) => () => void;
    /** 组内 toggle（数组 add/remove），由 Group 提供 */
    toggle: (value: string | number) => void;
    /** 组内选中判定 */
    has: (value: string | number) => boolean;
}

export const gdCheckboxGroupKey: InjectionKey<GdCheckboxGroupContext> = Symbol('gdCheckboxGroup');
