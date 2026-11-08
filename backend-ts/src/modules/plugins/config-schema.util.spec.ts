import { normalizeConfigSchema, resolveConfigSchemaNls } from "./config-schema.util";

describe("normalizeConfigSchema", () => {
  it("accepts the direct fields form", () => {
    const schema = normalizeConfigSchema({
      fields: [
        { key: "blenderExecutable", label: "Blender", type: "text", required: true },
        { key: "enableHelpers", label: "Helpers", type: "boolean", default: true },
        { key: "mode", label: "Mode", type: "select", options: [{ label: "A", value: "a" }] },
      ],
    });
    expect(schema.fields.map((f) => f.key)).toEqual([
      "blenderExecutable",
      "enableHelpers",
      "mode",
    ]);
    expect(schema.fields[1].type).toBe("boolean");
    expect(schema.fields[2].options).toEqual([{ label: "A", value: "a" }]);
  });

  it("accepts a JSON Schema subset", () => {
    const schema = normalizeConfigSchema({
      type: "object",
      required: ["blenderExecutable"],
      properties: {
        blenderExecutable: { type: "string", description: "Blender path" },
        timeoutMs: { type: "integer", default: 180000 },
        level: { type: "string", enum: ["low", "high"] },
      },
    });
    expect(schema.fields).toHaveLength(3);
    expect(schema.fields[0]).toMatchObject({
      key: "blenderExecutable",
      type: "text",
      required: true,
    });
    expect(schema.fields[1]).toMatchObject({ type: "number", default: 180000 });
    expect(schema.fields[2].type).toBe("select");
    expect(schema.fields[2].options).toEqual([
      { label: "low", value: "low" },
      { label: "high", value: "high" },
    ]);
  });

  it("returns empty fields for unknown shapes", () => {
    expect(normalizeConfigSchema(undefined).fields).toEqual([]);
    expect(normalizeConfigSchema({ foo: "bar" }).fields).toEqual([]);
    expect(normalizeConfigSchema("nope").fields).toEqual([]);
  });

  it("downgrades unknown types to text", () => {
    const schema = normalizeConfigSchema({
      fields: [{ key: "x", label: "X", type: "date" }],
    });
    expect(schema.fields[0].type).toBe("text");
  });

  it("resolves NLS placeholders in labels", () => {
    const schema = normalizeConfigSchema({
      fields: [{ key: "a", label: "%blender.a%", description: "%blender.a.desc%" }],
    });
    const resolved = resolveConfigSchemaNls(schema, (text) => text.replace(/%/g, ""));
    expect(resolved.fields[0].label).toBe("blender.a");
    expect(resolved.fields[0].description).toBe("blender.a.desc");
  });

  it("supports single-key and anyOf showIf forms", () => {
    const schema = normalizeConfigSchema({
      fields: [
        { key: "a", label: "A", type: "boolean" },
        { key: "b", label: "B", type: "boolean" },
        { key: "c", label: "C", type: "boolean", showIf: { field: "a", equals: true } },
        {
          key: "d",
          label: "D",
          type: "boolean",
          showIf: { anyOf: [{ field: "a", equals: true }, { field: "b", equals: true }] },
        },
      ],
    });
    expect(schema.fields[2].showIf).toEqual({ field: "a", equals: true });
    expect(schema.fields[3].showIf).toEqual({
      anyOf: [
        { field: "a", equals: true },
        { field: "b", equals: true },
      ],
    });
  });
});
