/**
 * 已退役工具/工具包的迁移提示。
 *
 * 这里的条目不会出现在模型可见的工具定义里，也不会出现在前端插件列表；
 * 只有在旧会话继续调用旧工具名（或重新 tool_learn 旧工具包）时，才会返回
 * 一条明确的迁移提示，避免模型把“工具不存在”误判为临时故障。
 *
 * 新增退役项时，把旧名称 → 新调用方式写进下面的表即可。
 */

const RETIRED_TOOL_REPLACEMENTS: Record<string, string> = {
  browser_navigate:
    'Use browser_run with `await tab.goto(url)` (optionally `{ newTab, waitUntil }`) instead.',
  browser_tabs:
    'Use browser_run with `browser.tabs.list()`, `select(index)`, `close(index?)`, or `closeAll()` instead.',
  browser_snapshot:
    'Use browser_run with `await tab.snapshot({ type? })` instead.',
  browser_interact:
    'Use browser_run with `await tab.click(target)` or `await tab.fill(target, value)` instead.',
  browser_evaluate:
    'Use browser_run with `await tab.evaluate(fn, arg?)` instead.',
  browser_history:
    'Use browser_run with `await tab.back()`, `tab.forward()`, or `tab.reload()` instead.',
  browser_reload: 'Use browser_run with `await tab.reload()` instead.',
  browser_console: 'Use browser_run with `await tab.console()` instead.',
  browser_screenshot:
    'Use browser_run with `await tab.screenshot({ filePath?, fullPage? })` instead.',
  browser_wait:
    'Use browser_run with `await tab.waitFor(target, { timeout? })` instead.',
  browser_page_text:
    'Use browser_run with `await tab.snapshot({ type: "summary" })` or `tab.evaluate` instead.',
  browser_new_window:
    'Use browser_run with `await tab.goto(url, { newTab: true })` instead.',
  browser_page_struct:
    'Use browser_run with `await tab.snapshot({ type: "struct" })` instead.',
  browser_page_summary:
    'Use browser_run with `await tab.snapshot({ type: "summary" })` instead.',
  browser_close:
    'Use browser_run with `browser.tabs.close(index?)` instead.',
  browser_windows: 'Use browser_run with `browser.tabs.list()` instead.',
};

const RETIRED_TOOLKIT_REPLACEMENTS: Record<string, string> = {
  browser:
    'The "browser" toolkit is retired. Use the browser_run tool; call skill_learn("browser-script") for the full API.',
  "浏览器自动化":
    'The "浏览器自动化" toolkit is retired. Use the browser_run tool; call skill_learn("browser-script") for the full API.',
  "Browser Automation":
    'The "Browser Automation" toolkit is retired. Use the browser_run tool; call skill_learn("browser-script") for the full API.',
  "浏览器控制":
    'The "浏览器控制" toolkit is retired. Use the browser_run tool; call skill_learn("browser-script") for the full API.',
  "Browser Control":
    'The "Browser Control" toolkit is retired. Use the browser_run tool; call skill_learn("browser-script") for the full API.',
};

/** 返回旧工具的迁移提示；未退役返回 undefined。 */
export function getRetiredToolMessage(toolName: string): string | undefined {
  const replacement = RETIRED_TOOL_REPLACEMENTS[toolName];
  if (!replacement) return undefined;
  return `Tool "${toolName}" is retired. ${replacement} Call skill_learn("browser-script") for the full API.`;
}

/** 返回旧工具包的迁移提示；未退役返回 undefined。 */
export function getRetiredToolkitMessage(name: string): string | undefined {
  return RETIRED_TOOLKIT_REPLACEMENTS[name];
}
