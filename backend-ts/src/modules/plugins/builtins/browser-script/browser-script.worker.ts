/**
 * Browser Script Worker Bootstrap（worker 入口源码）
 *
 * 以 `new Worker(source, { eval: true })` 启动，和 workflow 的 worker 模式一致：
 * worker 内先 post ready 等宿主 'go'，再创建 vm context 执行脚本。
 *
 * 脚本只能看到 browser/tab/log/sleep/timers/args：
 * - 没有 require/process/fs/fetch；timer 由宿主注入并随取消/结束清理
 * - vm 开启 codeGeneration.strings=false，挡住 Function/eval 构造逃逸
 *
 * 宿主侧负责真正的浏览器调用（Bridge → Electron），worker 只做编排。
 */

export const BROWSER_SCRIPT_WORKER_SOURCE = String.raw`
'use strict';
const { parentPort, workerData } = require('worker_threads');
const vm = require('vm');

const MAX_SLEEP_MS = 5000;
const SYNC_TIMEOUT_MS = 5000;
const MAX_TIMER_MS = 300000;
const MIN_INTERVAL_MS = 10;

let callSeq = 0;
let cancelled = false;
let cancelReason = null;
const pending = new Map();
let resolveGo = null;

// ── 沙箱计时器 ──
// vm context 不继承 Node 的 timer 全局，这里显式注入并统一登记，
// 取消/结束时清理，避免 interval 在脚本返回后继续产生回调。
let timerSeq = 0;
const timerHandles = new Map();

function runTimerHandler(handler, args) {
  try {
    handler.apply(null, args);
  } catch (error) {
    post({
      type: 'error',
      error: {
        code: (error && error.fatal && error.code) || 'SCRIPT_ERROR',
        message: (error && error.message) || String(error),
      },
    });
    clearAllTimers();
  }
}

function scheduleTimer(kind, handler, delay, args, repeat) {
  if (typeof handler !== 'function') {
    throw fatal('INVALID_ARGUMENT', kind + ' requires a function');
  }
  const value = delay === undefined ? 0 : Number(delay);
  if (!Number.isFinite(value) || value < 0) {
    throw fatal('INVALID_ARGUMENT', kind + ' delay must be a finite number >= 0');
  }
  const ms = Math.min(Math.floor(value), MAX_TIMER_MS);
  const id = ++timerSeq;
  if (repeat) {
    const handle = setInterval(function () {
      runTimerHandler(handler, args);
    }, Math.max(MIN_INTERVAL_MS, ms));
    timerHandles.set(id, { handle: handle, repeat: true });
  } else {
    const handle = setTimeout(function () {
      timerHandles.delete(id);
      runTimerHandler(handler, args);
    }, ms);
    timerHandles.set(id, { handle: handle, repeat: false });
  }
  return id;
}

function clearTimer(id) {
  const key = Number(id);
  const entry = timerHandles.get(key);
  if (!entry) return;
  timerHandles.delete(key);
  if (entry.repeat) clearInterval(entry.handle);
  else clearTimeout(entry.handle);
}

function clearAllTimers() {
  timerHandles.forEach(function (entry) {
    if (entry.repeat) clearInterval(entry.handle);
    else clearTimeout(entry.handle);
  });
  timerHandles.clear();
}

function post(msg) { parentPort.postMessage(msg); }

function fatal(code, message, details) {
  const error = new Error(message);
  error.code = code;
  error.fatal = true;
  if (details !== undefined) error.details = details;
  return error;
}

function checkCancel() {
  if (cancelled) throw fatal('CANCELLED', cancelReason || 'Browser script cancelled');
}

function hostCall(method, params) {
  checkCancel();
  const callId = 'c' + (++callSeq);
  post({ type: 'call', callId: callId, method: method, params: params || {} });
  return new Promise(function (resolve, reject) {
    pending.set(callId, { resolve: resolve, reject: reject });
  });
}

function isRegExp(value) {
  return Object.prototype.toString.call(value) === '[object RegExp]';
}

function serializeTarget(target) {
  if (typeof target === 'string') {
    if (/^e\d+$/.test(target)) {
      throw fatal(
        'INVALID_ARGUMENT',
        'Ref targets were removed. Use tab.getByRole/getByText/getByLabel/getByPlaceholder/getByTestId/getByAltText/getByTitle or tab.locator(css).'
      );
    }
    return { kind: 'selector', selector: target };
  }
  if (target && typeof target === 'object') {
    if (target.__browserLocator) return target.__browserLocator;
    if (typeof target.ref === 'string') {
      throw fatal(
        'INVALID_ARGUMENT',
        'Snapshot node refs were removed. Use tab.getByRole/getByText/getByLabel/getByPlaceholder/getByTestId/getByAltText/getByTitle or tab.locator(css).'
      );
    }
  }
  throw fatal(
    'INVALID_ARGUMENT',
    'target must be a CSS selector string or a locator from getByRole/getByText/getByLabel/getByPlaceholder/getByTestId/getByAltText/getByTitle/locator'
  );
}

function roleStep(role, options) {
  var step = Object.assign({}, options || {}, { kind: 'role', role: role });
  delete step.scope;
  step.exact = Boolean(options && options.exact);
  return step;
}

function textStep(kind, text, options) {
  return { kind: kind, text: text, exact: Boolean(options && options.exact) };
}

function testIdStep(testId) {
  return { kind: 'testid', testId: testId };
}

function selectorStep(selector, options) {
  if (typeof selector !== 'string' || !selector.trim()) {
    throw fatal('INVALID_ARGUMENT', 'locator(selector) requires a non-empty CSS selector string');
  }
  if (options && typeof options === 'object' && Object.keys(options).length > 0) {
    throw fatal(
      'UNSUPPORTED',
      'locator(selector, options) filtering is not supported. Use a more specific CSS selector, a chained getByRole/getByText/..., or tab.evaluate(...).'
    );
  }
  return { kind: 'selector', selector: selector };
}

// Playwright 的 locator 是链式的：父级的 scope 收进 descriptor，动作时由宿主逐级解析。
function appendStep(descriptor, step) {
  var parent = Object.assign({}, descriptor);
  delete parent.scope;
  var scope = Array.isArray(descriptor.scope) ? descriptor.scope.slice() : [];
  scope.push(parent);
  return Object.assign({}, step, { scope: scope });
}

var LOCATOR_METHODS = [
  'click', 'dblclick', 'focus', 'clear', 'fill', 'hover', 'press', 'scroll',
  'selectOption', 'check', 'uncheck',
  'state', 'count', 'text', 'innerText', 'isVisible', 'isHidden', 'waitFor',
  'isEnabled', 'isDisabled', 'isEditable', 'isChecked', 'inputValue', 'boundingBox',
  'getAttribute',
  'first', 'last', 'nth', 'locator',
  'getByRole', 'getByText', 'getByLabel', 'getByPlaceholder',
  'getByTestId', 'getByAltText', 'getByTitle',
];

function guardLocator(locator) {
  if (typeof Proxy !== 'function') return locator;
  return new Proxy(locator, {
    get: function (target, prop) {
      if (typeof prop === 'symbol') return target[prop];
      // thenable / 日志序列化的探测属性保持静默，避免 await 或 JSON.stringify 误判。
      if (prop === 'then' || prop === 'toJSON' || prop === 'inspect') return undefined;
      if (prop in target) return target[prop];
      throw fatal(
        'UNSUPPORTED',
        'locator.' + prop + ' is not supported. Supported locator members: ' +
          LOCATOR_METHODS.join(', ') +
          '. Narrow scope with locator.locator(css) or a chained getByRole/getByText/...; ' +
          'read attributes or computed styles with tab.evaluate(...).'
      );
    },
  });
}

var TAB_METHODS = [
  'goto', 'snapshot', 'click', 'dblclick', 'focus', 'clear', 'fill', 'hover',
  'press', 'scroll', 'selectOption',
  'check', 'uncheck', 'elementState', 'waitFor', 'waitForLoadState', 'evaluate',
  'screenshot', 'title', 'url', 'getDialog', 'handleDialog', 'waitForDownload',
  'downloads', 'setViewportSize', 'console', 'back', 'forward', 'reload',
  'getByRole', 'getByText', 'getByLabel', 'getByPlaceholder', 'getByTestId',
  'getByAltText', 'getByTitle', 'locator', 'info',
];

// tab 不是浏览器对象：未知成员（page.getAttribute 等 Playwright Page API）
// 统一报 UNSUPPORTED 并列出可用方法，避免原生 TypeError 让模型再猜一轮。
function guardTab(tabFacade) {
  if (typeof Proxy !== 'function') return tabFacade;
  return new Proxy(tabFacade, {
    get: function (target, prop) {
      if (typeof prop === 'symbol') return target[prop];
      if (prop === 'then' || prop === 'toJSON' || prop === 'inspect') return undefined;
      if (prop in target) return target[prop];
      throw fatal(
        'UNSUPPORTED',
        'tab.' + prop + ' is not supported. Supported tab members: ' +
          TAB_METHODS.join(', ') +
          '. Use tab.evaluate(...) for arbitrary page JavaScript.'
      );
    },
  });
}

function makeLocator(descriptor) {
  var locator = {
    __browserLocator: descriptor,
    click: function (options) {
      return hostCall('locator', { locator: descriptor, action: 'click', options: options || {} });
    },
    dblclick: function (options) {
      return hostCall('locator', {
        locator: descriptor,
        action: 'dblclick',
        options: Object.assign({}, options || {}, { clickCount: 2 }),
      });
    },
    focus: function () {
      return hostCall('locator', { locator: descriptor, action: 'focus' });
    },
    clear: function (options) {
      return hostCall('locator', { locator: descriptor, action: 'clear', options: options || {} });
    },
    fill: function (value, options) {
      return hostCall('locator', { locator: descriptor, action: 'fill', value: value, options: options || {} });
    },
    hover: function (options) {
      return hostCall('locator', { locator: descriptor, action: 'hover', options: options || {} });
    },
    press: function (key, options) {
      return hostCall('locator', { locator: descriptor, action: 'press', key: key, options: options || {} });
    },
    scroll: function (options) {
      return hostCall('locator', { locator: descriptor, action: 'scroll', options: options || {} });
    },
    selectOption: function (values, options) {
      return hostCall('locator', { locator: descriptor, action: 'selectOption', values: values, options: options || {} });
    },
    check: function (checked, options) {
      if (checked && typeof checked === 'object') {
        options = checked;
        checked = true;
      }
      return hostCall('locator', { locator: descriptor, action: 'check', checked: checked !== false, options: options || {} });
    },
    uncheck: function (options) {
      return hostCall('locator', { locator: descriptor, action: 'uncheck', checked: false, options: options || {} });
    },
    state: function () {
      return hostCall('locator', { locator: descriptor, action: 'state' });
    },
    // 以下读取全部复用 state 探针的返回值，不增加宿主动作
    isEnabled: function () {
      return hostCall('locator', { locator: descriptor, action: 'state' }).then(function (probe) {
        return !!probe.enabled;
      });
    },
    isDisabled: function () {
      return hostCall('locator', { locator: descriptor, action: 'state' }).then(function (probe) {
        return !probe.enabled;
      });
    },
    isEditable: function () {
      return hostCall('locator', { locator: descriptor, action: 'state' }).then(function (probe) {
        return !!probe.editable;
      });
    },
    isChecked: function () {
      return hostCall('locator', { locator: descriptor, action: 'state' }).then(function (probe) {
        if (typeof probe.checked !== 'boolean') {
          throw fatal(
            'INVALID_ARGUMENT',
            'isChecked() requires a checkbox or radio element, got <' + String(probe.tagName || '?') + '>'
          );
        }
        return probe.checked;
      });
    },
    inputValue: function () {
      return hostCall('locator', { locator: descriptor, action: 'state' }).then(function (probe) {
        if (typeof probe.value !== 'string') {
          throw fatal(
            'INVALID_ARGUMENT',
            'inputValue() requires an input, textarea, or select element, got <' + String(probe.tagName || '?') + '>'
          );
        }
        return probe.value;
      });
    },
    boundingBox: function () {
      return hostCall('locator', { locator: descriptor, action: 'state' }).then(function (probe) {
        var rect = probe.rect || {};
        return {
          x: Number(rect.x) || 0,
          y: Number(rect.y) || 0,
          width: Number(rect.width) || 0,
          height: Number(rect.height) || 0,
        };
      });
    },
    getAttribute: function (name) {
      if (typeof name !== 'string' || !name.trim()) {
        throw fatal('INVALID_ARGUMENT', 'getAttribute(name) requires an attribute name');
      }
      return hostCall('locator', { locator: descriptor, action: 'attribute', attribute: name });
    },
    count: function () {
      return hostCall('locator', { locator: descriptor, action: 'count' });
    },
    text: function () {
      return hostCall('locator', { locator: descriptor, action: 'text' });
    },
    innerText: function () {
      return hostCall('locator', { locator: descriptor, action: 'text' });
    },
    isVisible: function () {
      return hostCall('locator', { locator: descriptor, action: 'isVisible' });
    },
    isHidden: function () {
      return hostCall('locator', { locator: descriptor, action: 'isVisible' }).then(function (visible) {
        return !visible;
      });
    },
    waitFor: function (options) {
      return hostCall('locator', { locator: descriptor, action: 'waitFor', options: options || {} });
    },
    first: function () {
      return makeLocator(Object.assign({}, descriptor, { index: 0 }));
    },
    last: function () {
      return makeLocator(Object.assign({}, descriptor, { index: -1 }));
    },
    nth: function (index) {
      return makeLocator(Object.assign({}, descriptor, { index: Number(index) }));
    },
    locator: function (selector, options) {
      return makeLocator(appendStep(descriptor, selectorStep(selector, options)));
    },
    getByRole: function (role, options) {
      return makeLocator(appendStep(descriptor, roleStep(role, options)));
    },
    getByText: function (text, options) {
      return makeLocator(appendStep(descriptor, textStep('text', text, options)));
    },
    getByLabel: function (text, options) {
      return makeLocator(appendStep(descriptor, textStep('label', text, options)));
    },
    getByPlaceholder: function (text, options) {
      return makeLocator(appendStep(descriptor, textStep('placeholder', text, options)));
    },
    getByTestId: function (testId) {
      return makeLocator(appendStep(descriptor, testIdStep(testId)));
    },
    getByAltText: function (text, options) {
      return makeLocator(appendStep(descriptor, textStep('altText', text, options)));
    },
    getByTitle: function (text, options) {
      return makeLocator(appendStep(descriptor, textStep('title', text, options)));
    },
  };
  return guardLocator(locator);
}

function findNodes(node, query, firstOnly, out) {
  if (!node || typeof node !== 'object') return out;
  if (matches(node, query)) {
    out.push(node);
    if (firstOnly) return out;
  }
  const children = Array.isArray(node.children) ? node.children : [];
  for (let i = 0; i < children.length; i++) {
    findNodes(children[i], query, firstOnly, out);
    if (firstOnly && out.length > 0) return out;
  }
  return out;
}

function matches(node, query) {
  if (!query) return false;
  if (typeof query === 'string') {
    return node.role === query || node.name === query;
  }
  if (query.ref !== undefined && node.ref !== query.ref) return false;
  if (query.role !== undefined && node.role !== query.role) return false;
  if (query.name !== undefined) {
    const name = node.name || '';
    if (isRegExp(query.name)) {
      if (!query.name.test(name)) return false;
    } else if (query.exact === true ? name !== query.name : name.indexOf(String(query.name)) === -1) {
      return false;
    }
  }
  return true;
}

function collectText(node) {
  if (!node || typeof node !== 'object') return '';
  const parts = [];
  if (node.name) parts.push(node.name);
  const children = Array.isArray(node.children) ? node.children : [];
  for (let i = 0; i < children.length; i++) {
    const childText = collectText(children[i]);
    if (childText) parts.push(childText);
  }
  return parts.join('\n');
}

function decorateSnapshot(data) {
  if (!data || typeof data !== 'object') return data;
  // 非枚举，避免脚本直接 return snap 时 structured clone 遇到函数
  Object.defineProperty(data, 'find', {
    value: function (query) { return findNodes(this.tree, query, true, [])[0] || null; },
    enumerable: false,
  });
  Object.defineProperty(data, 'findAll', {
    value: function (query) { return findNodes(this.tree, query, false, []); },
    enumerable: false,
  });
  Object.defineProperty(data, 'text', {
    value: function () { return collectText(this.tree); },
    enumerable: false,
  });
  return data;
}

function sleep(ms) {
  checkCancel();
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0 || value > MAX_SLEEP_MS) {
    throw fatal('INVALID_ARGUMENT', 'sleep(ms) requires a number between 0 and ' + MAX_SLEEP_MS);
  }
  return new Promise(function (resolve) { setTimeout(resolve, value); });
}

const tab = Object.freeze({
  goto: function (url, options) {
    return hostCall('goto', Object.assign({}, options || {}, { url: url }));
  },
  snapshot: function (options) {
    return hostCall('snapshot', options || {}).then(decorateSnapshot);
  },
  click: function (target, options) {
    return hostCall('click', Object.assign({}, options || {}, { target: serializeTarget(target) }));
  },
  dblclick: function (target, options) {
    return hostCall('dblclick', Object.assign({}, options || {}, { target: serializeTarget(target) }));
  },
  focus: function (target, options) {
    return hostCall('focus', Object.assign({}, options || {}, { target: serializeTarget(target) }));
  },
  clear: function (target, options) {
    return hostCall('clear', Object.assign({}, options || {}, { target: serializeTarget(target) }));
  },
  fill: function (target, value, options) {
    return hostCall('fill', Object.assign({}, options || {}, { target: serializeTarget(target), value: value }));
  },
  hover: function (target, options) {
    return hostCall('hover', Object.assign({}, options || {}, { target: serializeTarget(target) }));
  },
  press: function (key, options) {
    var params = Object.assign({}, options || {}, { key: key });
    if (params.target !== undefined) params.target = serializeTarget(params.target);
    return hostCall('press', params);
  },
  scroll: function (options) {
    var params = Object.assign({}, options || {});
    if (params.target !== undefined) params.target = serializeTarget(params.target);
    return hostCall('scroll', params);
  },
  selectOption: function (target, values, options) {
    return hostCall('selectOption', Object.assign({}, options || {}, {
      target: serializeTarget(target),
      values: values,
    }));
  },
  check: function (target, checked, options) {
    if (checked && typeof checked === 'object') {
      options = checked;
      checked = true;
    }
    return hostCall('check', Object.assign({}, options || {}, {
      target: serializeTarget(target),
      checked: checked !== false,
    }));
  },
  uncheck: function (target, options) {
    return hostCall('check', Object.assign({}, options || {}, {
      target: serializeTarget(target),
      checked: false,
    }));
  },
  elementState: function (target) {
    return hostCall('elementState', { target: serializeTarget(target) });
  },
  waitFor: function (target, options) {
    return hostCall('waitFor', Object.assign({}, options || {}, { target: serializeTarget(target) }));
  },
  waitForLoadState: function (stateName, options) {
    return hostCall('waitForLoadState', Object.assign({}, options || {}, { state: stateName || 'domcontentloaded' }));
  },
  evaluate: function (fn, arg) {
    return hostCall('evaluate', {
      fn: typeof fn === 'function' ? fn.toString() : String(fn),
      arg: arg,
    });
  },
  screenshot: function (options) { return hostCall('screenshot', options || {}); },
  // Playwright page.title() / page.url() 的对应物：读当前标签，不发导航
  title: function () {
    return hostCall('info', {}).then(function (info) {
      return info ? String(info.title || '') : '';
    });
  },
  url: function () {
    return hostCall('info', {}).then(function (info) {
      return info ? String(info.url || '') : '';
    });
  },
  getDialog: function () {
    return hostCall('dialog', { action: 'get' }).then(function (result) {
      return (result && result.dialog) || null;
    });
  },
  handleDialog: function (accept, promptText) {
    return hostCall('dialog', {
      action: 'handle',
      accept: accept === true,
      promptText: typeof promptText === 'string' ? promptText : undefined,
    });
  },
  waitForDownload: function (options) {
    var params = options && typeof options === 'object' ? options : {};
    return hostCall('download', { action: 'wait', timeout: params.timeout }).then(function (result) {
      return (result && result.download) || null;
    });
  },
  downloads: function () {
    return hostCall('download', { action: 'list' }).then(function (result) {
      return (result && result.downloads) || [];
    });
  },
  setViewportSize: function (widthOrOptions, height) {
    var params;
    if (widthOrOptions && typeof widthOrOptions === 'object') {
      params = { width: widthOrOptions.width, height: widthOrOptions.height };
      if (widthOrOptions.tabId !== undefined) params.tabId = widthOrOptions.tabId;
    } else {
      params = { width: widthOrOptions, height: height };
    }
    return hostCall('setViewport', params);
  },
  console: function (options) { return hostCall('console', options || {}); },
  back: function (options) {
    return hostCall('history', Object.assign({}, options || {}, { action: 'back' }));
  },
  forward: function (options) {
    return hostCall('history', Object.assign({}, options || {}, { action: 'forward' }));
  },
  reload: function (options) {
    return hostCall('history', Object.assign({}, options || {}, { action: 'reload' }));
  },
  getByRole: function (role, options) {
    return makeLocator(roleStep(role, options));
  },
  getByText: function (text, options) {
    return makeLocator(textStep('text', text, options));
  },
  getByLabel: function (text, options) {
    return makeLocator(textStep('label', text, options));
  },
  getByPlaceholder: function (text, options) {
    return makeLocator(textStep('placeholder', text, options));
  },
  getByTestId: function (testId) {
    return makeLocator(testIdStep(testId));
  },
  getByAltText: function (text, options) {
    return makeLocator(textStep('altText', text, options));
  },
  getByTitle: function (text, options) {
    return makeLocator(textStep('title', text, options));
  },
  locator: function (selector, options) {
    return makeLocator(selectorStep(selector, options));
  },
  info: function () { return hostCall('info', {}); },
});

const tabApi = guardTab(tab);

const browser = Object.freeze({
  open: function (url, options) {
    return hostCall('goto', Object.assign({}, options || {}, {
      url: url,
      newTab: Boolean(options && options.newTab),
    }));
  },
  tabs: Object.freeze({
    list: function () { return hostCall('tabs', { action: 'list' }); },
    new: function (url) {
      if (url !== undefined && typeof url !== 'string') {
        throw fatal('INVALID_ARGUMENT', 'browser.tabs.new(url) requires a string URL');
      }
      return hostCall('goto', { url: url || 'about:blank', newTab: true });
    },
    select: function (index) { return hostCall('tabs', { action: 'select', index: index }); },
    close: function (index) { return hostCall('tabs', { action: 'close', index: index }); },
    closeAll: function () { return hostCall('tabs', { action: 'close_all' }); },
  }),
  snapshot: function (options) { return tab.snapshot(options); },
  current: function () { return hostCall('info', {}); },
});

const sandbox = {
  browser: browser,
  tab: tabApi,
  log: function (message) { post({ type: 'log', message: String(message) }); },
  sleep: sleep,
  setTimeout: function (handler, delay) {
    return scheduleTimer('setTimeout', handler, delay, Array.prototype.slice.call(arguments, 2), false);
  },
  clearTimeout: function (id) { clearTimer(id); },
  setInterval: function (handler, delay) {
    return scheduleTimer('setInterval', handler, delay, Array.prototype.slice.call(arguments, 2), true);
  },
  clearInterval: function (id) { clearTimer(id); },
  args: workerData.args,
  console: {
    log: function () {
      post({ type: 'log', message: Array.prototype.map.call(arguments, String).join(' ') });
    },
    info: function () {
      post({ type: 'log', message: Array.prototype.map.call(arguments, String).join(' ') });
    },
    warn: function () {
      post({ type: 'log', message: Array.prototype.map.call(arguments, String).join(' ') });
    },
    error: function () {
      post({ type: 'log', message: Array.prototype.map.call(arguments, String).join(' ') });
    },
  },
};

parentPort.on('message', function (msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'go') {
    if (resolveGo) resolveGo();
    return;
  }
  if (msg.type === 'cancel') {
    cancelled = true;
    cancelReason = msg.reason || 'Browser script cancelled';
    clearAllTimers();
    pending.forEach(function (entry) { entry.reject(fatal('CANCELLED', cancelReason)); });
    pending.clear();
    return;
  }
  if (msg.type === 'call-result') {
    const entry = pending.get(msg.callId);
    if (!entry) return;
    pending.delete(msg.callId);
    if (msg.ok) {
      entry.resolve(msg.value);
    } else {
      const error = msg.error || {};
      entry.reject(fatal(
        error.code || 'CALL_FAILED',
        error.message || 'Browser call failed',
        error.details
      ));
    }
  }
});

const goPromise = new Promise(function (resolve) { resolveGo = resolve; });
post({ type: 'ready' });

async function main() {
  await goPromise;
  if (cancelled) {
    post({ type: 'error', error: { code: 'CANCELLED', message: cancelReason } });
    return;
  }

  const context = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
  });
  const wrapper = '(async () => {\n' + workerData.script + '\n})()';

  let value;
  try {
    const compiled = new vm.Script(wrapper, {
      filename: 'browser-script.js',
      lineOffset: -1,
    });
    value = await compiled.runInContext(context, { timeout: SYNC_TIMEOUT_MS });
  } catch (error) {
    if (cancelled) {
      post({ type: 'error', error: { code: 'CANCELLED', message: cancelReason } });
      return;
    }
    post({
      type: 'error',
      error: {
        code: (error && error.fatal && error.code) || (error instanceof SyntaxError ? 'SCRIPT_PARSE' : 'SCRIPT_ERROR'),
        message: (error && error.message) || String(error),
        ...(error && error.details !== undefined ? { details: error.details } : {}),
      },
    });
    return;
  }

  if (cancelled) {
    post({ type: 'error', error: { code: 'CANCELLED', message: cancelReason } });
    return;
  }

  try {
    post({ type: 'result', value: value });
  } catch (error) {
    post({
      type: 'error',
      error: {
        code: 'RESULT_UNSERIALIZABLE',
        message: 'Browser script return value is not structured-cloneable: ' + ((error && error.message) || String(error)),
      },
    });
  }
}

main()
  .then(function () {
    clearAllTimers();
  })
  .catch(function (error) {
    clearAllTimers();
    post({
      type: 'error',
      error: {
        code: 'SCRIPT_ERROR',
        message: (error && error.message) || String(error),
        ...(error && error.details !== undefined ? { details: error.details } : {}),
      },
    });
  });
`;
