/**
 * Workflow Worker Bootstrap（worker 入口源码）
 *
 * 以 `new Worker(source, { eval: true })` 启动（免构建管线资产拷贝）：
 * worker 内先 post ready 等宿主 'go' 启动门，然后创建 vm context 注入
 * 编排钩子（agent/parallel/pipeline/phase/log + args）执行脚本。
 *
 * 错误纪律（对齐 DSH）：
 * - fatal 错误（宿主注入的钩子产生的 WorkflowError 同构对象）杀死整个脚本
 * - 普通子代理失败 → agent() resolve null，parallel()/pipeline() 内普通异常 → null
 * - 取消在下一个钩子边界生效（checkCancel）；所有 pending agent 调用立即 reject
 *
 * 序列化边界：postMessage structured clone 拒绝函数/循环引用——钩子入参在
 * 投递前显式校验（INVALID_ARGUMENT），脚本 return 值由 clone 自然把关
 * （DataCloneError → RESULT_UNSERIALIZABLE），等价 DSH realm 物化。
 */

/** 脚本初始同步切片的 vm 超时（await 之后的同步段由宿主取消宽限兜底） */
export const WORKER_SYNC_TIMEOUT_MS = 5000;
/** parallel()/pipeline() 单次调用条目上限（runaway 兜底） */
export const WORKER_MAX_ITEMS_PER_CALL = 4096;

export const WORKER_BOOTSTRAP_SOURCE = String.raw`
'use strict';
const { parentPort, workerData } = require('worker_threads');
const vm = require('vm');

var SYNC_TIMEOUT_MS = ${WORKER_SYNC_TIMEOUT_MS};
var MAX_ITEMS_PER_CALL = ${WORKER_MAX_ITEMS_PER_CALL};

var callSeq = 0;
var cancelled = false;
var cancelReason = null;
var pending = new Map();
var resolveGo = null;

function post(msg) { parentPort.postMessage(msg); }

function fatal(code, message) {
  var e = new Error(message);
  e.code = code;
  e.fatal = true;
  return e;
}

function checkCancel() {
  if (cancelled) throw fatal('CANCELLED', cancelReason || 'Workflow cancelled');
}

function isPlainOptions(opts) {
  if (opts === undefined || opts === null) return true;
  if (typeof opts !== 'object' || Array.isArray(opts)) return false;
  var keys = Object.keys(opts);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k !== 'agentId' && k !== 'label' && k !== 'phase') return false;
    var v = opts[k];
    if (v !== undefined && typeof v !== 'string') return false;
  }
  return true;
}

// agent(prompt, opts?) → 子代理最终输出文本；失败/中止 resolve null；fatal 错误 reject
async function agent(prompt, opts) {
  checkCancel();
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw fatal('INVALID_ARGUMENT', 'agent(prompt, opts?): prompt must be a non-empty string');
  }
  if (!isPlainOptions(opts)) {
    throw fatal('INVALID_ARGUMENT', 'agent() opts accepts only { agentId?, label?, phase? } with string values');
  }
  var o = opts || {};
  var callId = 'a' + (++callSeq);
  post({ type: 'agent-call', callId: callId, prompt: prompt, opts: { agentId: o.agentId, label: o.label, phase: o.phase } });
  var reply = await new Promise(function (resolve, reject) { pending.set(callId, { resolve: resolve, reject: reject }); });
  if (reply.stopReason !== 'completed') return null;
  return reply.output;
}

// parallel(thunks) → Promise.all 屏障；普通异常项 → null；fatal 重抛
async function parallel(thunks) {
  checkCancel();
  if (!Array.isArray(thunks)) {
    throw fatal('INVALID_ARGUMENT', 'parallel(thunks): thunks must be an array of zero-arg functions');
  }
  if (thunks.length > MAX_ITEMS_PER_CALL) {
    throw fatal('ITEM_CAP', 'parallel() exceeds max items per call (' + MAX_ITEMS_PER_CALL + ')');
  }
  for (var i = 0; i < thunks.length; i++) {
    if (typeof thunks[i] !== 'function') {
      throw fatal('INVALID_ARGUMENT', 'parallel(thunks): every entry must be a function');
    }
  }
  return Promise.all(thunks.map(function (t) {
    return Promise.resolve().then(t).catch(function (e) {
      if (e && e.fatal) throw e;
      return null;
    });
  }));
}

// pipeline(items, ...stages) → 每个 item 独立穿过 stage 链（stage 间无屏障）；
// stage 签名 (prev, item, index)；单项普通异常 → 该项 null；fatal 重抛
async function pipeline(items) {
  checkCancel();
  if (!Array.isArray(items)) {
    throw fatal('INVALID_ARGUMENT', 'pipeline(items, ...stages): items must be an array');
  }
  if (items.length > MAX_ITEMS_PER_CALL) {
    throw fatal('ITEM_CAP', 'pipeline() exceeds max items per call (' + MAX_ITEMS_PER_CALL + ')');
  }
  var stages = Array.prototype.slice.call(arguments, 1);
  for (var s = 0; s < stages.length; s++) {
    if (typeof stages[s] !== 'function') {
      throw fatal('INVALID_ARGUMENT', 'pipeline(items, ...stages): every stage must be a function');
    }
  }
  return Promise.all(items.map(function (item, index) {
    var acc = Promise.resolve(item);
    for (var s = 0; s < stages.length; s++) {
      // stage 签名 (prev, item, index)：Promise.then 只回传 prev，需显式补齐 item/index
      // （IIFE 固定本轮 stage，防 var 闭包取到末轮值）
      (function (stage) {
        acc = acc.then(function (prev) {
          return stage(prev, item, index);
        });
      })(stages[s]);
    }
    return acc.catch(function (e) {
      if (e && e.fatal) throw e;
      return null;
    });
  }));
}

function phase(title) {
  checkCancel();
  if (typeof title !== 'string' || title.trim() === '') {
    throw fatal('INVALID_ARGUMENT', 'phase(title): title must be a non-empty string');
  }
  post({ type: 'phase', title: title });
}

function log(message) {
  checkCancel();
  if (typeof message !== 'string') {
    throw fatal('INVALID_ARGUMENT', 'log(message): message must be a string');
  }
  post({ type: 'log', message: message });
}

parentPort.on('message', function (msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'go') {
    if (resolveGo) resolveGo();
    return;
  }
  if (msg.type === 'cancel') {
    cancelled = true;
    cancelReason = msg.reason || 'Workflow cancelled';
    pending.forEach(function (p) { p.reject(fatal('CANCELLED', cancelReason)); });
    pending.clear();
    return;
  }
  if (msg.type === 'agent-settled' || msg.type === 'agent-failed') {
    var p = pending.get(msg.callId);
    if (!p) return;
    pending.delete(msg.callId);
    if (msg.type === 'agent-settled') {
      p.resolve({ output: msg.output, stopReason: msg.stopReason });
    } else {
      p.reject(fatal(msg.code, msg.message));
    }
    return;
  }
});

var goPromise = new Promise(function (resolve) { resolveGo = resolve; });
post({ type: 'ready' });

function postCancelled() {
  post({ type: 'error', code: 'CANCELLED', message: cancelReason || 'Workflow cancelled' });
}

async function main() {
  await goPromise;
  if (cancelled) { postCancelled(); return; }

  var context = vm.createContext({
    agent: agent,
    parallel: parallel,
    pipeline: pipeline,
    phase: phase,
    log: log,
    args: workerData.args,
  });
  var wrapper = '(async () => {\n' + workerData.script + '\n})()';

  var value;
  try {
    // lineOffset: -1 —— wrapper 首行折叠，报错行号即脚本自身行号
    var compiled = new vm.Script(wrapper, { filename: 'workflow-script.js', lineOffset: -1 });
    value = await compiled.runInContext(context, { timeout: SYNC_TIMEOUT_MS });
  } catch (e) {
    if (cancelled) { postCancelled(); return; }
    var code = (e && e.fatal && e.code) ? e.code
      : (e instanceof SyntaxError ? 'SCRIPT_PARSE' : 'SCRIPT_ERROR');
    post({ type: 'error', code: code, message: (e && e.message) || String(e) });
    return;
  }
  if (cancelled) { postCancelled(); return; }
  try {
    post({ type: 'result', value: value });
  } catch (e) {
    post({
      type: 'error',
      code: 'RESULT_UNSERIALIZABLE',
      message: 'Workflow return value is not JSON-serializable: ' + ((e && e.message) || String(e)),
    });
  }
}

main().catch(function (e) {
  post({
    type: 'error',
    code: (e && e.fatal && e.code) || 'SCRIPT_ERROR',
    message: (e && e.message) || String(e),
  });
});
`;
