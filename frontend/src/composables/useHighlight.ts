// composables/useHighlight.ts
import hljs from "highlight.js/lib/core";

// 导入语言包（与 useMarkdown 保持一致）
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import java from "highlight.js/lib/languages/java";
import cpp from "highlight.js/lib/languages/cpp";
import c from "highlight.js/lib/languages/c";
import csharp from "highlight.js/lib/languages/csharp";
import php from "highlight.js/lib/languages/php";
import ruby from "highlight.js/lib/languages/ruby";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import html from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import scss from "highlight.js/lib/languages/scss";
import json from "highlight.js/lib/languages/json";
import yaml from "highlight.js/lib/languages/yaml";
import bash from "highlight.js/lib/languages/bash";
import shell from "highlight.js/lib/languages/shell";
import markdown from "highlight.js/lib/languages/markdown";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import nginx from "highlight.js/lib/languages/nginx";
import powershell from "highlight.js/lib/languages/powershell";
import ini from "highlight.js/lib/languages/ini";
import apache from "highlight.js/lib/languages/apache";
import makefile from "highlight.js/lib/languages/makefile";
import perl from "highlight.js/lib/languages/perl";
import r from "highlight.js/lib/languages/r";
import swift from "highlight.js/lib/languages/swift";
import kotlin from "highlight.js/lib/languages/kotlin";
import scala from "highlight.js/lib/languages/scala";
import vbnet from "highlight.js/lib/languages/vbnet";
import lua from "highlight.js/lib/languages/lua";
import lisp from "highlight.js/lib/languages/lisp";
import dart from "highlight.js/lib/languages/dart";
import plaintext from "highlight.js/lib/languages/plaintext";
import dos from "highlight.js/lib/languages/dos";

// 注册语言
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("java", java);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("c", c);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("php", php);
hljs.registerLanguage("ruby", ruby);
hljs.registerLanguage("go", go);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("html", html);
hljs.registerLanguage("vue", html);
hljs.registerLanguage("css", css);
hljs.registerLanguage("scss", scss);
hljs.registerLanguage("json", json);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("shell", shell);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("nginx", nginx);
hljs.registerLanguage("powershell", powershell);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("apache", apache);
hljs.registerLanguage("makefile", makefile);
hljs.registerLanguage("perl", perl);
hljs.registerLanguage("r", r);
hljs.registerLanguage("swift", swift);
hljs.registerLanguage("kotlin", kotlin);
hljs.registerLanguage("scala", scala);
hljs.registerLanguage("vbnet", vbnet);
hljs.registerLanguage("lua", lua);
hljs.registerLanguage("lisp", lisp);
hljs.registerLanguage("dart", dart);
hljs.registerLanguage("plaintext", plaintext);
hljs.registerLanguage("dos", dos);

/**
 * 根据文件扩展名获取对应的语言标识
 */
export function getLanguageFromExtension(ext: string): string | null {
  const langMap: Record<string, string> = {
    ".js": "javascript",
    ".ts": "typescript",
    ".jsx": "javascript",
    ".tsx": "typescript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".mts": "typescript",
    ".cts": "typescript",
    ".py": "python",
    ".java": "java",
    ".cpp": "cpp",
    ".c": "c",
    ".cs": "csharp",
    ".php": "php",
    ".rb": "ruby",
    ".go": "go",
    ".rs": "rust",
    ".sql": "sql",
    ".css": "css",
    ".scss": "scss",
    ".json": "json",
    ".jsonl": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".sh": "bash",
    ".bash": "bash",
    ".bat": "dos",
    ".cmd": "dos",
    ".ps1": "powershell",
    ".xml": "xml",
    ".vue": "vue",
    ".dockerfile": "dockerfile",
    ".nginx": "nginx",
    ".ini": "ini",
    ".conf": "apache",
    ".makefile": "makefile",
    ".pl": "perl",
    ".r": "r",
    ".swift": "swift",
    ".kt": "kotlin",
    ".scala": "scala",
    ".vb": "vbnet",
    ".lua": "lua",
    ".lisp": "lisp",
    ".dart": "dart",
    ".html": "html",
    ".htm": "html",
    ".md": "markdown",
    ".markdown": "markdown",
  };

  return langMap[ext.toLowerCase()] || null;
}

/**
 * 判断是否为文本文件（可以安全显示）
 */
export function isTextFile(ext: string): boolean {
  const textExtensions = [
    ".txt",
    ".md",
    ".markdown",
    ".html",
    ".htm",
    ".css",
    ".scss",
    ".less",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".vue",
    ".json",
    ".yaml",
    ".yml",
    ".xml",
    ".py",
    ".java",
    ".c",
    ".cpp",
    ".h",
    ".hpp",
    ".cs",
    ".php",
    ".rb",
    ".go",
    ".rs",
    ".swift",
    ".kt",
    ".scala",
    ".sh",
    ".bash",
    ".zsh",
    ".ps1",
    ".sql",
    ".dockerfile",
    ".nginx",
    ".conf",
    ".ini",
    ".toml",
    ".env",
    ".gitignore",
    ".npmignore",
    ".editorconfig",
    ".eslintrc",
    ".prettierrc",
    ".log",
    ".csv",
    ".tsv",
    ".svg",
    ".graphql",
    ".proto",
    // 新增格式
    ".jsonl",
    ".ndjson",
    ".bat",
    ".cmd",
    ".mjs",
    ".cjs",
    ".mts",
    ".cts",
    ".properties",
    ".cfg",
    ".gradle",
  ];

  return textExtensions.includes(ext.toLowerCase());
}

/**
 * 判断是否为图片文件
 */
export function isImageFile(ext: string): boolean {
  const imageExtensions = [
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".bmp",
    ".ico",
    ".avif",
    ".tiff",
    ".tif",
    ".heic",
    ".heif",
    ".jfif",
  ];
  return imageExtensions.includes(ext.toLowerCase());
}

/** 音频扩展名（浏览器可直接解码的容器/编码组合） */
const AUDIO_EXTENSIONS = [
  ".mp3",
  ".wav",
  ".ogg",
  ".oga",
  ".opus",
  ".m4a",
  ".aac",
  ".flac",
  ".weba",
];

/** 视频扩展名（浏览器可直接解码的容器/编码组合；.mkv/.mov 视内部编码而定，失败有兜底 UI） */
const VIDEO_EXTENSIONS = [
  ".mp4",
  ".m4v",
  ".webm",
  ".ogv",
  ".mov",
  ".mkv",
];

/**
 * 已知但浏览器基本解不了的媒体容器 → 给"浏览器无法播放"专门文案，
 * 而不是通用的"此文件暂不支持预览"（用户才知道该换播放器）。
 * 刻意不含 .ts：那是 TypeScript，不是 MPEG-TS。
 */
const UNPLAYABLE_MEDIA_EXTENSIONS = [
  ".avi",
  ".flv",
  ".wmv",
  ".wma",
  ".ape",
  ".mpg",
  ".mpeg",
  ".rmvb",
  ".3gp",
];

/** 预览面板的渲染形态（唯一分流结果，由 getPreviewKind 产出） */
export type FilePreviewKind = 'text' | 'image' | 'audio' | 'video' | 'pdf' | 'unsupported';

/**
 * 扩展名 → 预览形态（预览面板的唯一分流入口）。
 *
 * 判定顺序：文本优先（.svg 归 text —— 它源码可编辑，渲染成图片的能力由面板按
 * isSvgFile 另判），再位图，再音视频，最后 pdf；其余落 unsupported 走兜底 UI。
 */
export function getPreviewKind(ext: string): FilePreviewKind {
  const normalized = ext.toLowerCase();
  if (isTextFile(normalized)) return 'text';
  if (isImageFile(normalized)) return 'image';
  if (AUDIO_EXTENSIONS.includes(normalized)) return 'audio';
  if (VIDEO_EXTENSIONS.includes(normalized)) return 'video';
  if (normalized === '.pdf') return 'pdf';
  return 'unsupported';
}

/** 已知但浏览器解不了的媒体格式（用于 unsupported 分支的专门文案） */
export function isUnplayableMediaFile(ext: string): boolean {
  return UNPLAYABLE_MEDIA_EXTENSIONS.includes(ext.toLowerCase());
}

/**
 * 代码高亮 Composable
 */
export function useHighlight() {
  /**
   * 高亮代码
   * @param code 源代码
   * @param language 语言标识
   * @returns 高亮后的 HTML
   */
  const highlightCode = (code: string, language: string): string => {
    if (!code) return "";

    try {
      const lang = hljs.getLanguage(language) ? language : "plaintext";
      const result = hljs.highlight(code, { language: lang });

      // 按行拆分，每行包裹行号 + 代码内容（per-line flex row，折行时行号自然对齐）
      const lines = result.value.split("\n");
      const digitCount = String(lines.length).length;
      const lineNumWidth = `${Math.max(digitCount, 2)}ch`;
      const codeLines = lines
        .map((line, i) => {
          const num = i + 1;
          return `<div class="line"><span class="line-num" style="min-width:${lineNumWidth}">${num}</span><div class="line-content">${line || " "}</div></div>`;
        })
        .join("\n");

      return `<pre><code class="hljs language-${lang}"><div class="code-lines">${codeLines}</div></code></pre>`;
    } catch (error) {
      console.warn(`Failed to highlight code as ${language}:`, error);
      // 降级为纯文本（也加行号）
      const lines = escapeHtml(code).split("\n");
      const digitCount = String(lines.length).length;
      const lineNumWidth = `${Math.max(digitCount, 2)}ch`;
      const codeLines = lines
        .map((line, i) => {
          const num = i + 1;
          return `<div class="line"><span class="line-num" style="min-width:${lineNumWidth}">${num}</span><div class="line-content">${line || " "}</div></div>`;
        })
        .join("\n");
      return `<pre><code><div class="code-lines">${codeLines}</div></code></pre>`;
    }
  };

  /**
   * 高亮整段代码并按行拆分（保留跨行 token 上下文：块注释/模板字符串/多行字符串）。
   * 逐行调用 highlight 会丢失跨行状态（如 `/* ... *\/` 块注释中间的行无高亮），
   * 这里对整段代码一次高亮，再按 \n 拆回行：
   * hljs 输出的 <span> 可能跨行，拆行时维护标签栈，
   * 行尾关闭未闭合 span、下一行行首重开，保证每行都是合法 HTML 片段。
   * @returns 与 code.split("\n") 一一对应的高亮 HTML 行数组（空行为 ""）
   */
  const highlightCodeLines = (code: string, language: string): string[] => {
    let html: string;
    try {
      const lang = hljs.getLanguage(language) ? language : "plaintext";
      html = hljs.highlight(code, { language: lang }).value;
    } catch (error) {
      console.warn(`Failed to highlight code as ${language}:`, error);
      return code.split("\n").map((l) => escapeHtml(l));
    }
    // 按「标签 / 文本」切分（hljs 输出只含 <span> 标签，文本中的 < > 已转义为 &lt; &gt;）
    const tokens = html.split(/(<[^>]+>)/);
    const lines: string[] = [];
    const stack: string[] = [];
    let cur = "";
    const endLine = () => {
      for (let i = stack.length - 1; i >= 0; i--) cur += "</span>";
      lines.push(cur);
      cur = stack.join(""); // 下一行重开未闭合标签
    };
    for (const tk of tokens) {
      if (!tk) continue;
      if (tk.charCodeAt(0) === 60 /* '<' */) {
        if (tk.startsWith("</")) stack.pop();
        else stack.push(tk);
        cur += tk;
      } else {
        const parts = tk.split("\n");
        for (let j = 0; j < parts.length; j++) {
          cur += parts[j];
          if (j < parts.length - 1) endLine();
        }
      }
    }
    lines.push(cur);
    return lines;
  };

  /**
   * 转义 HTML 特殊字符
   */
  const escapeHtml = (text: string): string => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  };

  return {
    hljs,
    highlightCode,
    highlightCodeLines,
    getLanguageFromExtension,
    isTextFile,
    isImageFile,
    escapeHtml,
  };
}

export default useHighlight;
