import { defineComponent, inject, onScopeDispose } from 'vue';
import { gdSelectKey } from './gdSelectContext';

/**
 * GdSelect 的 el 兼容子组件 API：<GdOption label value :disabled>自定义内容</GdOption>
 * 自身不渲染任何 DOM（render null），在 setup 阶段同步注册到父 GdSelect。
 * label/value/disabled 走 getter 读取 props，保持响应式（如 t(labelKey) 随语言切换）。
 * 默认插槽内容在面板中渲染（自定义选项外观），未提供插槽时显示 label 文本。
 */
export const GdOption = defineComponent({
    name: 'GdOption',
    props: {
        label: { type: [String, Number], default: '' },
        value: { type: [String, Number], required: true },
        disabled: { type: Boolean, default: false },
    },
    setup(props, { slots }) {
        const ctx = inject(gdSelectKey, null);
        if (ctx) {
            const dispose = ctx.register({
                getLabel: () => String(props.label ?? ''),
                getValue: () => props.value,
                getDisabled: () => props.disabled,
                slot: slots.default ? () => slots.default!() : null,
            });
            onScopeDispose(dispose);
        } else if (import.meta.env.DEV) {
            console.warn('<GdOption> 必须作为 <GdSelect> 的子组件使用');
        }
        return () => null;
    },
});

export default GdOption;
