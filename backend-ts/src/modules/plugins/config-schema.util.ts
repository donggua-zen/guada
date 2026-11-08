import {
  PluginConfigField,
  PluginConfigSchema,
} from "./types/plugin.types";

/**
 * 插件配置 schema 归一化。
 *
 * 接受两种写法：
 * 1. `{ fields: [...] }`（直接声明，推荐）
 * 2. JSON Schema 子集 `{ type:"object", properties:{...}, required:[...] }`
 *
 * 统一转成 `{ fields: PluginConfigField[] }`，未知类型降级为 text。
 * 字段 label 优先用 `title`，其次 `description`，最后是 key。
 */
const ALLOWED_TYPES = new Set([
  "text",
  "password",
  "number",
  "select",
  "textarea",
  "boolean",
]);

function normalizeType(raw: any, hasEnum: boolean): PluginConfigField["type"] {
  if (typeof raw === "string" && ALLOWED_TYPES.has(raw)) {
    return raw as PluginConfigField["type"];
  }
  if (hasEnum) return "select";
  if (raw === "integer" || raw === "float") return "number";
  if (raw === "bool") return "boolean";
  if (typeof raw === "string" && raw === "string") return "text";
  return "text";
}

function coerceOptions(raw: any): PluginConfigField["options"] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((item) => {
    if (item && typeof item === "object" && "value" in item) {
      return {
        label: String(item.label ?? item.value),
        value: item.value,
      };
    }
    return { label: String(item), value: item };
  });
}

function normalizeField(key: string, raw: any, requiredSet: Set<string>): PluginConfigField {
  const source = raw && typeof raw === "object" ? raw : {};
  const enumValues = Array.isArray(source.enum) ? source.enum : undefined;
  const type = normalizeType(source.type ?? source.kind, Boolean(enumValues));

  const field: PluginConfigField = {
    key: String(source.key ?? key),
    label: String(source.label ?? source.title ?? source.description ?? key),
    type,
    required: Boolean(source.required) || requiredSet.has(key),
  };

  if (source.default !== undefined) field.default = source.default;
  if (source.placeholder !== undefined) field.placeholder = String(source.placeholder);
  if (source.description !== undefined) field.description = String(source.description);
  if (source.showIf && typeof source.showIf === "object") {
    if (Array.isArray(source.showIf.anyOf)) {
      field.showIf = {
        anyOf: source.showIf.anyOf
          .filter((item: any) => item && typeof item === "object" && item.field)
          .map((item: any) => ({
            field: String(item.field),
            equals: item.equals,
          })),
      };
    } else if (source.showIf.field) {
      field.showIf = {
        field: String(source.showIf.field),
        equals: source.showIf.equals,
      };
    }
  }

  const options = coerceOptions(source.options) || (enumValues
    ? enumValues.map((value: unknown) => ({ label: String(value), value }))
    : undefined);
  if (options && type === "select") field.options = options;

  return field;
}

/**
 * @returns `{ fields: [] }`；无法识别时返回空 fields（调用方据此隐藏入口）
 */
export function normalizeConfigSchema(raw: any): PluginConfigSchema {
  if (!raw || typeof raw !== "object") return { fields: [] };

  // 形式 1：直接 fields
  if (Array.isArray(raw.fields)) {
    return {
      fields: raw.fields
        .filter((item: any) => item && typeof item === "object")
        .map((item: any, index: number) =>
          normalizeField(String(item.key ?? `field${index}`), item, new Set()),
        )
        .filter((field: PluginConfigField) => field.key),
    };
  }

  // 形式 2：JSON Schema 子集
  const properties =
    (raw.properties && typeof raw.properties === "object" ? raw.properties : null) ||
    (raw.type === "object" && raw.properties ? raw.properties : null);
  if (!properties) return { fields: [] };

  const requiredSet = new Set<string>(
    Array.isArray(raw.required) ? raw.required.map((key: unknown) => String(key)) : [],
  );

  const fields = Object.entries(properties).map(([key, value]) =>
    normalizeField(key, value, requiredSet),
  );
  return { fields };
}

/** 把 NLS `%key%` 引用就地解析（字段 label/description/placeholder） */
export function resolveConfigSchemaNls(
  schema: PluginConfigSchema,
  resolve: (text: string) => string,
): PluginConfigSchema {
  return {
    fields: schema.fields.map((field) => ({
      ...field,
      label: resolve(field.label),
      ...(field.description ? { description: resolve(field.description) } : {}),
      ...(field.placeholder ? { placeholder: resolve(field.placeholder) } : {}),
    })),
  };
}
