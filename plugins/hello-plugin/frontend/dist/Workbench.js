/* Hello Plugin — 工作台示例（render-function Vue 组件，无需构建）
 *
 * 同时服务两个槽位：
 *   - main                     → 全页（props.sessionId 为 null）
 *   - conversation.side.panel  → 对话右栏页签（带 sessionId）
 *
 * 演示 v3 三项能力：
 *   1. host.url(pluginId, path) → 自定义 HTTP 路由
 *   2. host.call(pluginId, 'demo_complete') → 插件调用宿主模型
 *   3. 全页 / 右栏两种挂载点
 */
(function () {
  'use strict';

  var shared = window.__GuaDaShared__;
  if (!shared || !shared.vue) {
    console.error('[hello-plugin] __GuaDaShared__.vue is missing');
    return;
  }

  var h = shared.vue.h;
  var ref = shared.vue.ref;
  var reactive = shared.vue.reactive;
  var onMounted = shared.vue.onMounted;
  var computed = shared.vue.computed;

  var S = {
    root: { padding: '16px 20px', fontSize: '13px', lineHeight: '1.7', color: 'var(--gd-color-text)', display: 'flex', flexDirection: 'column', gap: '12px', height: '100%', overflow: 'auto' },
    title: { fontSize: '16px', fontWeight: 600, margin: 0 },
    desc: { margin: 0, opacity: 0.7 },
    card: { border: '1px solid var(--gd-color-border, rgba(127,127,127,.25))', borderRadius: '10px', padding: '12px 14px' },
    label: { display: 'block', fontWeight: 600, marginBottom: '6px' },
    row: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
    btn: { padding: '5px 12px', borderRadius: '8px', border: '1px solid var(--gd-color-border, rgba(127,127,127,.35))', background: 'var(--gd-color-secondary-surface, transparent)', color: 'inherit', cursor: 'pointer', fontSize: '13px' },
    btnPrimary: { padding: '5px 12px', borderRadius: '8px', border: '1px solid transparent', background: 'var(--gd-color-primary, #2563eb)', color: '#fff', cursor: 'pointer', fontSize: '13px' },
    input: { flex: 1, minWidth: '160px', padding: '6px 9px', borderRadius: '8px', border: '1px solid var(--gd-color-border, rgba(127,127,127,.35))', background: 'var(--gd-color-secondary-surface, transparent)', color: 'inherit', fontFamily: 'inherit', fontSize: '13px' },
    pre: { margin: '6px 0 0', padding: '8px 10px', borderRadius: '8px', background: 'var(--gd-color-surface-subtle, rgba(127,127,127,.1))', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '12px', maxHeight: '220px', overflow: 'auto' },
    err: { color: 'var(--gd-color-danger, #dc2626)' },
    ok: { color: '#16a34a' },
    muted: { opacity: 0.65, fontSize: '12px', whiteSpace: 'normal', wordBreak: 'break-word', overflowWrap: 'anywhere' },
  };

  var Workbench = {
    name: 'HelloWorkbench',
    props: {
      pluginId: { type: String, default: '' },
      sessionId: { type: [String, Object], default: null },
      host: { type: Object, default: null },
    },
    setup: function (props) {
      var pingResult = ref('');
      var completeResult = ref('');
      var streamResult = ref('');
      var routeResult = ref('');
      var models = ref([]);
      var busy = ref(false);
      var prompt = ref('用一句话介绍你自己。');

      var pid = computed(function () {
        return props.pluginId || 'hello-plugin';
      });
      var where = computed(function () {
        return props.sessionId ? '对话右栏（会话 ' + String(props.sessionId).slice(0, 8) + '…）' : '全页工作台';
      });

      function call(method, args) {
        var api = shared.pluginApi;
        return api.call(pid.value, method, args);
      }

      function url(path) {
        var base = String((shared.pluginApi && shared.pluginApi.baseURL) || '/api/v1').replace(/\/$/, '');
        return base + '/plugins/' + pid.value + '/http/' + String(path).replace(/^\/+/, '');
      }

      function loadModels() {
        return call('demo_models')
          .then(function (res) {
            models.value = (res && res.models) || [];
          })
          .catch(function () {
            models.value = [];
          });
      }

      function runPing() {
        busy.value = true;
        routeResult.value = '';
        fetch(url('api/ping'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'HTTP 路由' }),
        })
          .then(function (r) { return r.json(); })
          .then(function (data) { routeResult.value = JSON.stringify(data, null, 2); })
          .catch(function (e) { routeResult.value = '失败：' + String(e); })
          .then(function () { busy.value = false; });
      }

      function runEcho() {
        busy.value = true;
        routeResult.value = '';
        fetch(url('api/echo/路径参数'))
          .then(function (r) { return r.json(); })
          .then(function (data) { routeResult.value = JSON.stringify(data, null, 2); })
          .catch(function (e) { routeResult.value = '失败：' + String(e); })
          .then(function () { busy.value = false; });
      }

      function runComplete() {
        busy.value = true;
        completeResult.value = '调用中…';
        call('demo_complete', { prompt: prompt.value })
          .then(function (res) {
            completeResult.value =
              '模型：' + res.model + '\n\n' + String(res.text || '').trim();
          })
          .catch(function (e) {
            completeResult.value = '失败：' + String((e && e.message) || e);
          })
          .then(function () { busy.value = false; });
      }

      function runStream() {
        busy.value = true;
        streamResult.value = '流式调用中…';
        call('demo_stream', { prompt: prompt.value })
          .then(function (res) {
            streamResult.value =
              '分片数：' + res.chunks + '\n\n' + String(res.text || '').trim();
          })
          .catch(function (e) {
            streamResult.value = '失败：' + String((e && e.message) || e);
          })
          .then(function () { busy.value = false; });
      }

      function runSse() {
        var es = new EventSource(url('api/stream'));
        var lines = [];
        es.onmessage = function (ev) {
          lines.push(ev.data);
          if (ev.data === '[DONE]') {
            es.close();
            routeResult.value = lines.join('\n');
          }
        };
        es.onerror = function () {
          es.close();
          routeResult.value = lines.length ? lines.join('\n') : 'SSE 连接失败';
        };
      }

      onMounted(loadModels);

      return function () {
        return h('div', { style: S.root }, [
          h('div', null, [
            h('h2', { style: S.title }, 'Hello 工作台'),
            h('p', { style: S.desc }, '演示三项宿主能力：HTTP 路由 / 模型调用 / 页面槽位。'),
            h('p', { style: S.muted }, '当前挂载点：' + where.value),
          ]),

          h('div', { style: S.card }, [
            h('label', { style: S.label }, '① 自定义 HTTP 路由'),
            h('div', { style: S.row }, [
              h('button', { style: S.btnPrimary, disabled: busy.value, onClick: runPing }, 'POST /http/api/ping'),
              h('button', { style: S.btn, disabled: busy.value, onClick: runEcho }, 'GET /http/api/echo/:name'),
              h('button', { style: S.btn, disabled: busy.value, onClick: runSse }, 'GET /http/api/stream (SSE)'),
            ]),
            routeResult.value ? h('pre', { style: S.pre }, routeResult.value) : null,
          ]),

          h('div', { style: S.card }, [
            h('label', { style: S.label }, '② 调用宿主模型'),
            h('p', { style: S.muted },
              models.value.length
                ? '可用模型：' +
                  models.value.slice(0, 4).map(function (m) { return m.name || m.id; }).join('、') +
                  (models.value.length > 4 ? ' 等 ' + models.value.length + ' 个' : '')
                : '未检测到可用模型（去 设置 → 模型供应商 添加）'),
            h('div', { style: S.row }, [
              h('input', {
                style: S.input,
                value: prompt.value,
                onInput: function (e) { prompt.value = e.target.value; },
              }),
              h('button', { style: S.btnPrimary, disabled: busy.value, onClick: runComplete }, '非流式'),
              h('button', { style: S.btn, disabled: busy.value, onClick: runStream }, '流式'),
            ]),
            completeResult.value ? h('pre', { style: S.pre }, completeResult.value) : null,
            streamResult.value ? h('pre', { style: S.pre }, streamResult.value) : null,
          ]),

          h('div', { style: S.card }, [
            h('label', { style: S.label }, '③ 页面槽位'),
            h('p', { style: S.muted },
              '本组件同时注册到 main（左导航入口）与 conversation.side.panel（对话右栏页签）。'),
          ]),
        ]);
      };
    },
  };

  if (!window.__GuaDaModuleLoader__) {
    console.error('[hello-plugin] __GuaDaModuleLoader__ is missing');
    return;
  }
  window.__GuaDaModuleLoader__.register('hello-plugin:Workbench', { default: Workbench });
})();
