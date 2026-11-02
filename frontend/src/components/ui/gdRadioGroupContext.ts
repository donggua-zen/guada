import type { InjectionKey } from 'vue';

export interface GdRadioGroupContext {
    select: (value: string | number) => void;
    has: (value: string | number) => boolean;
    disabled: () => boolean;
}

export const gdRadioGroupKey: InjectionKey<GdRadioGroupContext> = Symbol('gdRadioGroup');
