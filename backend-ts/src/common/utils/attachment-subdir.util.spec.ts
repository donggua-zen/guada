import {
  isValidChatUploadSubdir,
  normalizeChatUploadSubdir,
} from "./attachment-subdir.util";
import { DEFAULT_CHAT_UPLOAD_SUBDIR } from "../../constants/settings.constants";

/**
 * 附件子目录名的归一/校验测试。
 *
 * 该值来自用户设置并被拼进会话工作目录路径，是「设置项 → 文件系统路径」的
 * 一处注入面：必须挡住分隔符、盘符与上跳，否则能把附件写到工作目录之外。
 */
describe("chat upload subdir normalization", () => {
  it("接受普通单层目录名", () => {
    expect(isValidChatUploadSubdir("uploads")).toBe(true);
    expect(isValidChatUploadSubdir("附件")).toBe(true);
    expect(isValidChatUploadSubdir("my-files_2")).toBe(true);
  });

  it("拒绝路径分隔符 / 盘符 / 上跳 / 非法字符 / 空值", () => {
    const bad = [
      "a/b",
      "a\\b",
      "..",
      ".",
      "",
      "   ",
      "C:",
      "C:\\tmp",
      "/abs",
      "a:b",
      'a"b',
      "a|b",
      "a?b",
      "a*b",
    ];
    // 断言"被错误接受的值"为空数组：失败时直接列出是哪几个值通过了校验
    expect(bad.filter((v) => isValidChatUploadSubdir(v))).toEqual([]);
  });

  it("空值/非法值一律回退默认目录（运行时容错，不抛错）", () => {
    expect(normalizeChatUploadSubdir(null)).toBe(DEFAULT_CHAT_UPLOAD_SUBDIR);
    expect(normalizeChatUploadSubdir("")).toBe(DEFAULT_CHAT_UPLOAD_SUBDIR);
    expect(normalizeChatUploadSubdir("  ")).toBe(DEFAULT_CHAT_UPLOAD_SUBDIR);
    expect(normalizeChatUploadSubdir("../evil")).toBe(DEFAULT_CHAT_UPLOAD_SUBDIR);
    expect(normalizeChatUploadSubdir("a/b")).toBe(DEFAULT_CHAT_UPLOAD_SUBDIR);
  });

  it("合法值原样返回（含首尾空白被裁掉）", () => {
    expect(normalizeChatUploadSubdir("files")).toBe("files");
    expect(normalizeChatUploadSubdir("  files  ")).toBe("files");
    expect(normalizeChatUploadSubdir("附件")).toBe("附件");
  });
});
