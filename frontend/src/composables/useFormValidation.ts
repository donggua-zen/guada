/**
 * 轻量表单校验 composable（替代 el-form 的 :rules + validate()/clearValidate 契约）。
 *
 * 规则五类直接用函数表达（required/正则/长度/一致性/async），不依赖 async-validator：
 *   validator: (value) => string | null —— 返回错误文案或 null（通过）；异步规则返回 Promise。
 *
 * 用法：schema 的 validator 从 `values()` getter 取字段值（响应式，调用时求值）：
 *   const { errors, validate } = useFormValidation(schema, () => form.username)
 *   // 或整表：useFormValidation(schema, () => form)
 *
 * 错误展示：GdFormField 的 error prop + 控件的 :error（GdInput/GdSelect/GdInputNumber 均支持）。
 * 范式参照：SchedulerTaskEditView 的 errors reactive + field-error 红字、zcode 的 FieldError + aria-invalid。
 */
import { reactive, unref, type MaybeRef } from 'vue';

export interface FieldRule {
    /** 返回错误文案；null/true = 通过；异步规则返回 Promise */
    validator: (value: unknown) => string | null | true | Promise<string | null | true>;
}

export type FieldSchema = Record<string, FieldRule[]>;

export interface UseFormValidationReturn {
    /** 当前各字段错误文案（reactive，渲染行内红字） */
    errors: Record<string, string>;
    /** 全量校验：全部通过返回 true 并清空 errors；失败逐字段填充文案。 */
    validate: () => Promise<boolean>;
    /** 清空校验态（弹窗开关时用）；传字段数组则只清指定字段 */
    clearValidate: (fields?: string[]) => void;
    /** 校验单个字段并更新 errors（input/blur 时增量触发可选） */
    validateField: (field: string) => Promise<boolean>;
    hasError: (field: string) => boolean;
}

export function useFormValidation(
    schema: MaybeRef<FieldSchema>,
    /** 字段值 getter：传整表对象或单字段取值函数 */
    values?: () => unknown,
): UseFormValidationReturn {
    const errors = reactive<Record<string, string>>({});

    const normalizeMessage = (result: string | null | true): string | null =>
        typeof result === 'string' ? result : null;

    const valueOf = (field: string): unknown => {
        if (!values) return undefined;
        const all = values();
        // 传整表对象：按 field 取键；传单字段 getter（函数返回值即值）：直接返回
        if (typeof all === 'function') return (all as (f: string) => unknown)(field);
        return (all as Record<string, unknown>)?.[field];
    };

    const validateField = async (field: string): Promise<boolean> => {
        const rules = unref(schema)[field];
        if (!rules?.length) {
            delete errors[field];
            return true;
        }
        for (const rule of rules) {
            try {
                const message = normalizeMessage(await rule.validator(valueOf(field)));
                if (message) {
                    errors[field] = message;
                    return false;
                }
            } catch (error) {
                errors[field] = (error as Error)?.message || '校验失败';
                return false;
            }
        }
        delete errors[field];
        return true;
    };

    const validate = async (): Promise<boolean> => {
        const fields = Object.keys(unref(schema));
        // 并发跑全部字段（async 规则并行），结果聚合
        const results = await Promise.all(fields.map(async (f) => ({ field: f, ok: await validateField(f) })));
        return results.every((r) => r.ok);
    };

    const clearValidate = (fields?: string[]): void => {
        const keys = fields ?? Object.keys(errors);
        for (const key of keys) delete errors[key];
    };

    const hasError = (field: string): boolean => !!errors[field];

    return { errors, validate, clearValidate, validateField, hasError };
}
