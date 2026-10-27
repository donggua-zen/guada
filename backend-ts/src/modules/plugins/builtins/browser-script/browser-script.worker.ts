/**
 * Browser Script Worker Bootstrap（worker 入口源码）
 *
 * 以 `new Worker(source, { eval: true })` 启动，和 workflow 的 worker 模式一致：
 * worker 内先 post ready 等宿主 'go'，再创建 vm context 执行脚本。
 *
 * 脚本只能看到 browser/tab/log/sleep/args：
 * - 没有 require/process/fs/fetch/timers（sleep 由宿主注入）
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

let callSeq = 0;
let cancelled = false;
let cancelReason = null;
const pending = new Map();
let resolveGo = null;

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

function makeLocator(descriptor) {
  return {
    __browserLocator: descriptor,
    click: function (options) {
      return hostCall('locator', { locator: descriptor, action: 'click', options: options || {} });
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
    count: function () {
      return hostCall('locator', { locator: descriptor, action: 'count' });
    },
    text: function () {
      return hostCall('locator', { locator: descriptor, action: 'text' });
    },
    isVisible: function () {
      return hostCall('locator', { locator: descriptor, action: 'isVisible' });
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
  };
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
    return makeLocator(Object.assign({}, options || {}, {
      kind: 'role',
      role: role,
      exact: Boolean(options && options.exact),
    }));
  },
  getByText: function (text, options) {
    return makeLocator({
      kind: 'text',
      text: text,
      exact: Boolean(options && options.exact),
    });
  },
  getByLabel: function (text, options) {
    return makeLocator({
      kind: 'label',
      text: text,
      exact: Boolean(options && options.exact),
    });
  },
  getByPlaceholder: function (text, options) {
    return makeLocator({
      kind: 'placeholder',
      text: text,
      exact: Boolean(options && options.exact),
    });
  },
  getByTestId: function (testId) {
    return makeLocator({ kind: 'testid', testId: testId });
  },
  getByAltText: function (text, options) {
    return makeLocator({
      kind: 'altText',
      text: text,
      exact: Boolean(options && options.exact),
    });
  },
  getByTitle: function (text, options) {
    return makeLocator({
      kind: 'title',
      text: text,
      exact: Boolean(options && options.exact),
    });
  },
  locator: function (selector) {
    return makeLocator({ kind: 'selector', selector: selector });
  },
  info: function () { return hostCall('info', {}); },
});

const browser = Object.freeze({
  open: function (url, options) {
    return hostCall('goto', Object.assign({}, options || {}, {
      url: url,
      newTab: Boolean(options && options.newTab),
    }));
  },
  tabs: Object.freeze({
    list: function () { return hostCall('tabs', { action: 'list' }); },
    select: function (index) { return hostCall('tabs', { action: 'select', index: index }); },
    close: function (index) { return hostCall('tabs', { action: 'close', index: index }); },
    closeAll: function () { return hostCall('tabs', { action: 'close_all' }); },
  }),
  snapshot: function (options) { return tab.snapshot(options); },
  current: function () { return hostCall('info', {}); },
});

const sandbox = {
  browser: browser,
  tab: tab,
  log: function (message) { post({ type: 'log', message: String(message) }); },
  sleep: sleep,
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

main().catch(function (error) {
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
