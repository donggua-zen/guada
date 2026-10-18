import {
  MIN_AGENT_VERSION_FOR_WSL,
  WSL_AGENT_DIR_BASES,
  buildWslArgs,
  decodeWslOutput,
  isWslPlatformAvailable,
  parseDistroList,
  parseDistroNames,
  toWslPath,
  wslAgentDirCandidates,
} from "./wsl-agent-connect";

/**
 * wsl-agent-connect 纯函数测试：
 * 编码解码（UTF-16LE/UTF-8）、`wsl -l -v` 解析、参数组装、Windows 路径 → /mnt 转换、
 * 安装目录候选顺序、平台门禁常量。
 */
describe("wsl-agent-connect 纯函数", () => {
  describe("decodeWslOutput", () => {
    it("UTF-16LE（含 NUL 字节）正确解码", () => {
      const buf = Buffer.from("  NAME   STATE\n* Ubuntu-AOSP  Running  2\n", "utf16le");
      expect(buf.includes(0)).toBe(true);
      expect(decodeWslOutput(buf)).toContain("Ubuntu-AOSP");
    });

    it("UTF-8（WSL_UTF8=1 归一后）正确解码", () => {
      const buf = Buffer.from("Ubuntu-AOSP\ndocker-desktop\n", "utf8");
      expect(decodeWslOutput(buf)).toBe("Ubuntu-AOSP\ndocker-desktop\n");
    });

    it("空输入返回空串", () => {
      expect(decodeWslOutput(null)).toBe("");
      expect(decodeWslOutput(undefined)).toBe("");
      expect(decodeWslOutput(Buffer.alloc(0))).toBe("");
      expect(decodeWslOutput("plain")).toBe("plain");
    });
  });

  describe("parseDistroList", () => {
    it("解析表头/默认标记/状态/版本", () => {
      const raw =
        "  NAME              STATE           VERSION\r\n" +
        "* Ubuntu-AOSP       Running         2\r\n" +
        "  docker-desktop    Stopped         2\r\n";
      expect(parseDistroList(raw)).toEqual([
        { name: "Ubuntu-AOSP", state: "Running", version: 2, isDefault: true },
        { name: "docker-desktop", state: "Stopped", version: 2, isDefault: false },
      ]);
    });

    it("发行版名含空格时从右往左按列解析", () => {
      const raw = "  NAME  STATE  VERSION\n  My Distro  Running  2\n";
      expect(parseDistroList(raw)).toEqual([
        { name: "My Distro", state: "Running", version: 2, isDefault: false },
      ]);
    });

    it("WSL1 发行版（version=1）同样解析", () => {
      const raw = "  NAME    STATE    VERSION\n* Legacy  Running  1\n";
      expect(parseDistroList(raw)[0]).toMatchObject({ name: "Legacy", version: 1, isDefault: true });
    });

    it("仅表头/空串 → 空数组（不误判无发行版列表）", () => {
      expect(parseDistroList("  NAME  STATE  VERSION\n")).toEqual([]);
      expect(parseDistroList("")).toEqual([]);
      expect(parseDistroList("\r\n")).toEqual([]);
    });

    it("容忍 BOM 与 CRLF", () => {
      const raw = "\uFEFF  NAME  STATE  VERSION\r\n  Ubuntu  Running  2\r\n";
      expect(parseDistroList(raw)).toHaveLength(1);
    });
  });

  describe("parseDistroNames（-q 回退）", () => {
    it("每行一个名称；过滤说明性文案行", () => {
      expect(parseDistroNames("Ubuntu-AOSP\r\ndocker-desktop\r\n")).toEqual([
        "Ubuntu-AOSP",
        "docker-desktop",
      ]);
      expect(
        parseDistroNames("Windows Subsystem for Linux has no installed distributions.\r\n"),
      ).toEqual([]);
    });
  });

  describe("buildWslArgs", () => {
    it("配置发行版名时前置 -d", () => {
      expect(buildWslArgs({ distro: "Ubuntu-AOSP" }, ["--exec", "uname", "-m"])).toEqual([
        "-d",
        "Ubuntu-AOSP",
        "--exec",
        "uname",
        "-m",
      ]);
    });

    it("发行版名为空/空白时走系统默认发行版（不加 -d）", () => {
      expect(buildWslArgs({ distro: "" }, ["-l", "-v"])).toEqual(["-l", "-v"]);
      expect(buildWslArgs({ distro: "   " }, ["-l", "-v"])).toEqual(["-l", "-v"]);
    });
  });

  describe("toWslPath", () => {
    it("盘符路径（反斜杠/正斜杠、含空格）→ /mnt/<drive>", () => {
      expect(toWslPath("C:\\Users\\22071\\.guada\\agent\\guada-agent-linux-amd64")).toBe(
        "/mnt/c/Users/22071/.guada/agent/guada-agent-linux-amd64",
      );
      expect(toWslPath("D:/projects/my app/main.ts")).toBe("/mnt/d/projects/my app/main.ts");
    });

    it("不可转换的路径（UNC/相对路径）→ null", () => {
      expect(toWslPath("\\\\server\\share\\file")).toBeNull();
      expect(toWslPath("relative/path")).toBeNull();
      expect(toWslPath("")).toBeNull();
    });
  });

  describe("wslAgentDirCandidates", () => {
    it("$HOME 优先，其后为 /tmp、/var/tmp、/dev/shm 下的 .guada-agent", () => {
      const list = wslAgentDirCandidates("/home/dev");
      expect(list[0]).toBe("/home/dev/.guada-agent");
      expect(list.slice(1)).toEqual(WSL_AGENT_DIR_BASES.map((b) => `${b}/.guada-agent`));
    });

    it("$HOME 为空或根目录时不产生重复/畸形候选", () => {
      expect(wslAgentDirCandidates("")).toEqual(WSL_AGENT_DIR_BASES.map((b) => `${b}/.guada-agent`));
      expect(wslAgentDirCandidates("/")).toEqual(WSL_AGENT_DIR_BASES.map((b) => `${b}/.guada-agent`));
      expect(wslAgentDirCandidates("/root/")).toEqual([
        "/root/.guada-agent",
        "/tmp/.guada-agent",
        "/var/tmp/.guada-agent",
        "/dev/shm/.guada-agent",
      ]);
    });
  });

  describe("平台门禁与版本下限", () => {
    it("仅 Windows 可用", () => {
      expect(isWslPlatformAvailable("win32")).toBe(true);
      expect(isWslPlatformAvailable("darwin")).toBe(false);
      expect(isWslPlatformAvailable("linux")).toBe(false);
    });

    it("WSL 侧下限常量与 stdio 门槛一致（0.6.0）", () => {
      expect(MIN_AGENT_VERSION_FOR_WSL).toBe("0.6.0");
    });
  });
});
