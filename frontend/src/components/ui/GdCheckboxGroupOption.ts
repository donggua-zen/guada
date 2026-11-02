import { defineComponent, inject, onScopeDispose } from 'vue';
import { gdCheckboxGroupKey } from './gdCheckboxGroupContext';

/**
 * GdCheckboxGroup 的选项消费件：value 在组内即选中态（数组语义）。
 * 通常直接用 <GdCheckbox v-model="arr" ...> 的数组重载更简单；本组件用于
 * ModelsProviderDetail 的「必选锁定」等需要独立 value 语义的场景。
 * 自身渲染 null，setup 阶段注册（含 disabled 状态与 hook）。
 */
export const GdCheckboxGroupOption = defineComponent({
    name: 'GdCheckboxGroupOption',
    props: {
        value: { type: [String, Number], required: true },
        disabled: { type: Boolean, default: false },
    },
    setup(props) {
        const ctx = inject(gdCheckboxGroupKey, null);
        if (!ctx) {
            if (import.meta.env.DEV) console.warn('<GdCheckboxGroupOption> 必须在 <GdCheckboxGroup> 内使用');
            return () => null;
        }
        const dispose = ctx.register({
            getValue: () => props.value,
            getDisabled: () => props.disabled,
        });
        onScopeDispose(dispose);
        return () => null;
    },
});

export default GdCheckboxGroupOption;
