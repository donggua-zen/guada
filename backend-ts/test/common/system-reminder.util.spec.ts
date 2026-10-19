import { wrapSystemReminder } from "../../src/common/utils/system-reminder.util";

describe("wrapSystemReminder", () => {
  it("用 <system_reminder> 包裹模型可见的系统文案", () => {
    expect(wrapSystemReminder("read-only")).toBe(
      "<system_reminder>\nread-only\n</system_reminder>",
    );
  });

  it("保留多行内容", () => {
    const wrapped = wrapSystemReminder("line 1\nline 2");
    expect(wrapped).toBe(
      "<system_reminder>\nline 1\nline 2\n</system_reminder>",
    );
  });
});
