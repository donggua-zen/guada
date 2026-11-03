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
            // 只写插槽不传 label：面板里能看到文字，触发器却是空——常见误用，开发期提示
            if (import.meta.env.DEV && !props.label && slots.default) {
                console.warn(
                    `<GdOption value="${String(props.value)}"> 未传 label：触发器上的显示文本取自 label，` +
                    `插槽内容只用于面板内的自定义渲染。请补 :label 或改用文本子节点写法`,
                );
            }
        } else if (import.meta.env.DEV) {
            console.warn('<GdOption> 必须作为 <GdSelect> 的子组件使用');
        }
        return () => null;
    },
});

export default GdOption;
