/**
 * GuaDa 浏览器端模块加载器（v1 方案）
 *
 * 职责：
 * - register(id, exports)：插件产物调用，注册模块导出
 * - import(id)：物化模块（脚本加载 + 缓存）
 * - prepare({ id, url, cssUrl })：slot store 在拿到清单时注册待加载模块
 * - invalidate(id) / unload(id)：失效/卸载（插件启停、产物更新）
 *
 * 产物协议：插件 frontend/dist/<Name>.js 是 IIFE，执行时调用
 *   window.__GuaDaModuleLoader__.register('pluginId:Name', { default: Component })
 * 共享依赖（vue/element-plus/plugin-api）从 window.__GuaDaShared__ 读取，不 import。
 */

const registry = new Map();      // id → exports
const factories = new Map();     // id → { url, cssUrl }
const loadCache = new Map();     // id → Promise<exports>
const injectedCss = new Set();

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.async = true;
    el.src = url;
    // 记录脚本执行期间的全局错误（用于 "did not register" 诊断）
    let scriptError = null;
    const onError = (e) => {
      if (e.filename === url || (e.target && e.target.src === url)) {
        scriptError = e.message || String(e.error || '');
      }
    };
    window.addEventListener('error', onError);
    el.addEventListener('load', () => {
      window.removeEventListener('error', onError);
      el.remove();
      resolve(scriptError);
    }, { once: true });
    el.addEventListener('error', () => {
      window.removeEventListener('error', onError);
      el.remove();
      reject(new Error(`plugin-loader: script ${url} failed to load`));
    }, { once: true });
    document.head.append(el);
  });
}

function injectStylesheet(url) {
  if (injectedCss.has(url)) return;
  injectedCss.add(url);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  document.head.append(link);
}

window.__GuaDaModuleLoader__ = {
  register(id, exports) {
    if (registry.has(id)) throw new Error(`plugin-loader: duplicate module ${id}`);
    registry.set(id, exports);
  },

  prepare({ id, url, cssUrl }) {
    factories.set(id, { url, cssUrl });
  },

  async import(id) {
    if (registry.has(id)) return registry.get(id);
    if (loadCache.has(id)) return loadCache.get(id);

    const task = (async () => {
      const meta = factories.get(id);
      if (!meta) throw new Error(`plugin-loader: unknown module ${id} (not prepared)`);
      if (meta.cssUrl) {
        try { injectStylesheet(meta.cssUrl); } catch { /* 样式缺失不致命 */ }
      }
      const scriptError = await loadScript(meta.url);
      if (!registry.has(id)) {
        const detail = scriptError ? `; script error: ${scriptError}` : '';
        throw new Error(`plugin-loader: script loaded but module ${id} did not register${detail}`);
      }
      return registry.get(id);
    })();

    loadCache.set(id, task);
    return task;
  },

  invalidate(id) {
    registry.delete(id);
    loadCache.delete(id);
  },

  unload(id) {
    this.invalidate(id);
    factories.delete(id);
  },

  // 诊断：当前已注册/已准备模块
  _debug() {
    return {
      registered: Array.from(registry.keys()),
      prepared: Array.from(factories.keys()),
    };
  },
};
