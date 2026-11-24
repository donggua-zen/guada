/**
 * Computer Script Worker Bootstrap（worker 入口源码）
 *
 * 以 `new Worker(source, { eval: true })` 启动，和 browser-script / workflow
 * 的 worker 模式一致：worker 内先 post ready 等宿主 'go'，再创建 vm context
 * 执行脚本。
 *
 * 脚本只能看到 computer/log/sleep/timers/args：
 * - 没有 require/process/fs/fetch；timer 由宿主注入并随取消/结束清理
 * - vm 开启 codeGeneration.strings=false，挡住 Function/eval 构造逃逸
 *
 * 宿主侧负责真正的桌面调用（Bridge → Electron → sidecar），worker 只做编排。
 */

export const COMPUTER_SCRIPT_WORKER_SOURCE = String.raw`
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
  if (cancelled) throw fatal('CANCELLED', cancelReason || 'Computer script cancelled');
}

function hostCall(method, params) {
  checkCancel();
  const callId = 'c' + (++callSeq);
  post({ type: 'call', callId: callId, method: method, params: params || {} });
  return new Promise(function (resolve, reject) {
    pending.set(callId, { resolve: resolve, reject: reject });
  });
}

function sleep(ms) {
  checkCancel();
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0 || value > MAX_SLEEP_MS) {
    throw fatal('INVALID_ARGUMENT', 'sleep(ms) requires a number between 0 and ' + MAX_SLEEP_MS);
  }
  return new Promise(function (resolve) { setTimeout(resolve, value); });
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function objectArg(name, value) {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) {
    throw fatal('INVALID_ARGUMENT', name + ' must be an object');
  }
  return value;
}

function stringArg(name, value) {
  if (typeof value !== 'string') {
    throw fatal('INVALID_ARGUMENT', name + ' must be a string');
  }
  return value;
}

function nonEmptyStringArg(name, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw fatal('INVALID_ARGUMENT', name + ' must be a non-empty string');
  }
  return value;
}

function numberArg(name, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw fatal('INVALID_ARGUMENT', name + ' must be a finite number');
  }
  return value;
}

var COMPUTER_METHODS = [
  'screenshot', 'a11y', 'windows', 'apps', 'cursor',
  'click', 'setValue', 'type', 'key', 'scroll',
  'focusWindow', 'move', 'drag', 'launch',
];

function guardComputer(facade) {
  if (typeof Proxy !== 'function') return facade;
  return new Proxy(facade, {
    get: function (target, prop) {
      if (typeof prop === 'symbol') return target[prop];
      if (prop === 'then' || prop === 'toJSON' || prop === 'inspect') return undefined;
      if (prop in target) return target[prop];
      throw fatal(
        'UNSUPPORTED',
        'computer.' + prop + ' is not supported. Supported members: ' +
          COMPUTER_METHODS.join(', ') + '.'
      );
    },
  });
}

const computer = guardComputer(Object.freeze({
  screenshot: function (options) {
    return hostCall('screenshot', objectArg('screenshot(options)', options));
  },
  a11y: function (options) {
    return hostCall('a11y', objectArg('a11y(options)', options));
  },
  windows: function (options) {
    return hostCall('windows', objectArg('windows(options)', options));
  },
  apps: function (options) {
    return hostCall('apps', objectArg('apps(options)', options));
  },
  cursor: function () {
    return hostCall('cursor', {});
  },
  click: function (options) {
    return hostCall('click', objectArg('click(options)', options));
  },
  setValue: function (options) {
    return hostCall('setValue', objectArg('setValue(options)', options));
  },
  type: function (text) {
    return hostCall('type', { text: stringArg('type(text)', text) });
  },
  key: function (combo) {
    return hostCall('key', { key: nonEmptyStringArg('key(combo)', combo) });
  },
  scroll: function (options) {
    return hostCall('scroll', objectArg('scroll(options)', options));
  },
  focusWindow: function (windowId) {
    return hostCall('focusWindow', { window_id: numberArg('focusWindow(windowId)', windowId) });
  },
  move: function (x, y) {
    return hostCall('move', {
      x: numberArg('move(x, y) x', x),
      y: numberArg('move(x, y) y', y),
    });
  },
  drag: function (options) {
    return hostCall('drag', objectArg('drag(options)', options));
  },
  launch: function (path) {
    return hostCall('launch', { path: nonEmptyStringArg('launch(path)', path) });
  },
}));

const sandbox = {
  computer: computer,
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
    cancelReason = msg.reason || 'Computer script cancelled';
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
        error.message || 'Computer call failed',
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
      filename: 'computer-script.js',
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
        message: 'Computer script return value is not structured-cloneable: ' + ((error && error.message) || String(error)),
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
        code: (error && error.fatal && error.code) || 'SCRIPT_ERROR',
        message: (error && error.message) || String(error),
        ...(error && error.details !== undefined ? { details: error.details } : {}),
      },
    });
  });
`;
