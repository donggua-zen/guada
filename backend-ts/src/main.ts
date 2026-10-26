import { NestFactory } from "@nestjs/core";
import { ValidationPipe, INestApplication } from "@nestjs/common";
import { WinstonModule } from 'nest-winston';
import { AppModule } from "./app.module";
import { JobRegistryService } from "./modules/jobs/job-registry.service";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { UrlService } from "./common/services/url.service";
import { resolveAttachmentResponseHeaders } from "./common/utils/attachment-serving.util";
import { createWinstonConfig } from './common/logger/winston.config';
import { RequestTimingInterceptor } from "./common/interceptors/request-timing.interceptor";
import * as express from "express";
import * as path from "path";
import * as fs from "fs";

// 日志目录基于 __dirname 解析（backend-ts/logs），不依赖 cwd：全局异常处理器
// 在 bootstrap 的 chdir 之前注册，必须现在就能拿到日志目录
const logsDir = process.env.LOGS_DIR || path.join(__dirname, "..", "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}
const logger = WinstonModule.createLogger(createWinstonConfig(logsDir));

/**
 * 进程级致命错误兜底。
 * 不兜底的后果：进程级异常只打 stderr，Electron 又只监控 npx 包装进程（不触发崩溃弹窗
 * /backend-crash.log），现场即丢失。这里落盘 winston error 日志后保持 Node 默认的退出语义。
 * 注意：ts-node-dev 不会因为子进程退出而重启它（lib/index.js 的 child.on('exit') 只清空引用），
 * 只有文件变更触发 restart() 才会再 start() —— 所以本函数的每次退出在 dev 下都可能表现为
 * 「后端长时间不可用」，直到下次改文件或重启应用。
 */
function logFatal(kind: string, err: unknown): void {
  const error = err instanceof Error ? err : new Error(String(err));
  console.error(`[FATAL] ${kind}: ${error.stack || error.message}`);
  try {
    logger.error(`进程级 ${kind}: ${error.message}`, { stack: error.stack });
  } catch {
    // 日志系统自身异常时以 stderr 为准
  }
  process.exit(1);
}

process.on("uncaughtException", (err) => logFatal("uncaughtException", err));
process.on("unhandledRejection", (reason) => logFatal("unhandledRejection", reason));

/**
 * stdout/stderr 管道断裂不算致命错误。
 * dev 模式下后端 stdout 是 Electron 持有的命名管道（经 cmd/npx/ts-node-dev 继承），
 * 包装链任一环退出后，下一次 console 写入即抛 EPIPE；该错误以 uncaughtException 形式
 * 冒泡，被 logFatal 当成致命错误 process.exit(1)，导致整个后端静默自杀（2026-09-21
 * 06:16 现场：error 日志只有 3 条 "进程级 uncaughtException: EPIPE: broken pipe, write"，
 * 栈顶是 winston Console 传输）。服务本身与此无关，吞掉流错误即可继续运行。
 */
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (err: NodeJS.ErrnoException) => {
    if (err?.code === "EPIPE" || err?.code === "EOF") return;
    logFatal("stdioError", err);
  });
}

/**
 * 「临终呼吸」同步记录：判定死亡性质的最后一块拼图。
 * winston 是异步流，进程被杀时必然丢日志；这里用 appendFileSync 直写，
 * 四种结果分别对应四种死法：
 *   - 有 exit(N) 行          → 走的是正常/半正常退出路径（含 logFatal 的 exit(1)）
 *   - 有 beforeExit 行       → 事件循环被抽空（所有句柄被关），不是被杀
 *   - 有 signal SIGxxx 行    → 收到可捕获信号（ts-node-dev 重启 / SIGBREAK 关窗）
 *   - 什么都没有             → TerminateProcess 强杀或原生 AV，句柄级退出，无任何 JS 执行机会
 */
const lastBreathPath = path.join(logsDir, "backend-last-breath.log");
function lastBreath(why: string): void {
  try {
    const mem = process.memoryUsage();
    fs.appendFileSync(
      lastBreathPath,
      `${new Date().toISOString()} pid=${process.pid} ${why}` +
        ` uptime=${process.uptime().toFixed(1)}s rss=${Math.round(mem.rss / 1048576)}MB\n`,
    );
  } catch {
    // 临终记录不得改变退出语义
  }
}
let nestApp: INestApplication | null = null;
let shuttingDown = false;

/**
 * 信号/宿主退出统一收尾：先 app.close() 触发 Nest shutdown 钩子（进程 reaper、
 * PTY/远程 job 清理），最多等 5s；超时或重复信号才强制退出。
 */
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    lastBreath(`signal ${signal} (forced)`);
    process.exit(1);
  }
  shuttingDown = true;
  lastBreath(`signal ${signal}`);
  const timer = setTimeout(() => process.exit(1), 5_000);
  timer.unref();
  try {
    // 先静默 Registry 通知，再跑各模块 reaper。
    nestApp?.get(JobRegistryService, { strict: false }).beginShutdown();
  } catch {
    // 应用尚未初始化完成
  }
  try {
    await nestApp?.close();
  } catch (error) {
    console.error("关闭应用时出错:", error);
  }
  clearTimeout(timer);
  process.exit(0);
}

process.on("exit", (code) => lastBreath(`exit(${code})`));
process.on("beforeExit", (code) => lastBreath(`beforeExit(${code}) 事件循环耗尽`));
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP", "SIGBREAK"] as const) {
  process.on(sig, () => {
    void shutdown(sig);
  });
}

async function bootstrap() {
  // 修正工作目录到 backend-ts 根目录，确保 bundled-skills/、skills/ 等路径可预测
  const backendRoot = path.resolve(__dirname, '..');
  if (process.cwd() !== backendRoot) {
    process.chdir(backendRoot);
    console.log(`工作目录已修正: ${backendRoot}`);
  }

  // 创建应用实例并配置 Winston 日志
  const app = await NestFactory.create(AppModule, { logger });
  nestApp = app;

  // 设置全局 API 前缀
  app.setGlobalPrefix("api/v1");

  // 增强对中文文件名的支持
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));
  app.use(express.json({ limit: "50mb" }));

  // 基础静态文件目录（程序自带资源，如图片、模型等）
  const staticPath = process.env.STATIC_DIR || path.join(__dirname, "..", "static");
  const staticPrefix = process.env.STATIC_URL || "/static";

  console.log(`基础静态目录: ${staticPath} -> ${staticPrefix}`);
  app.use(
    staticPrefix,
    express.static(staticPath, {
      setHeaders: (res, filePath) => {
        // 确保静态资源响应头支持 UTF-8
        res.setHeader("Content-Disposition", "inline; charset=utf-8");
      },
    }),
  );

  // 上传文件目录（用户数据，持久化存储）
  const uploadPhysicalRoot = process.env.UPLOAD_ROOT_DIR;
  const uploadPublicPrefix = process.env.UPLOAD_URL_PREFIX || "/uploads";

  if (uploadPhysicalRoot && uploadPublicPrefix) {
    const resolvedPath = path.resolve(uploadPhysicalRoot);

    // 确保上传目录存在
    if (!fs.existsSync(resolvedPath)) {
      fs.mkdirSync(resolvedPath, { recursive: true });
      console.log(`创建上传目录: ${resolvedPath}`);
    }

    console.log(`上传文件目录: ${resolvedPath} -> ${uploadPublicPrefix}`);
    app.use(
      uploadPublicPrefix,
      express.static(resolvedPath, {
        setHeaders: (res, filePath) => {
          // 只有位图 inline，其余强制下载（见 attachment-serving.util 的说明）
          const headers = resolveAttachmentResponseHeaders(filePath);
          for (const [key, value] of Object.entries(headers)) {
            res.setHeader(key, value);
          }
        },
      }),
    );
  } else {
    console.warn("⚠️  上传目录配置未设置（UPLOAD_ROOT_DIR 或 UPLOAD_URL_PREFIX），跳过挂载");
  }

  // 智能体目录（智能体定义与头像的权威来源）：只暴露目录内资源（头像等），
  // AGENT.md 由 API 提供，无需静态直出
  const agentsPhysicalRoot =
    process.env.AGENTS_DATA_DIR ||
    (process.env.USERDATA_DIR
      ? path.join(process.env.USERDATA_DIR, "agents")
      : path.join(process.cwd(), "data", "agents"));
  const agentsPublicPrefix = process.env.AGENTS_URL_PREFIX || "/agents";
  try {
    fs.mkdirSync(agentsPhysicalRoot, { recursive: true });
    console.log(`智能体目录: ${agentsPhysicalRoot} -> ${agentsPublicPrefix}`);
    app.use(
      agentsPublicPrefix,
      express.static(path.resolve(agentsPhysicalRoot), {
        index: false,
        setHeaders: (res) => {
          res.setHeader("Content-Disposition", "inline; charset=utf-8");
        },
      }),
    );
  } catch (err) {
    console.warn(`⚠️  智能体目录挂载失败: ${String(err)}`);
  }

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new RequestTimingInterceptor());

  // 全局 ValidationPipe：whitelist=true 自动剔除 DTO 未声明的字段
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: true,          // 反射请求的 Origin（不用通配符 *，否则浏览器拒收 credentials）
    credentials: true,     // 允许跨域请求携带 cookie（Markdown 预览图片走 html-preview 鉴权）
  });

  // 局域网访问（可选）：把打包的前端 SPA 也交给后端 serve，手机等局域网设备
  // 直接访问 http://<主机IP>:<端口>/ 即可使用，无需 nginx。必须挂在所有
  // API/静态路由之后，避免吞掉 /api、/uploads 等前缀。
  // Electron 端默认不传此变量，行为不变。
  const frontendDistDir = process.env.FRONTEND_DIST_DIR;
  if (frontendDistDir) {
    const indexHtml = path.join(frontendDistDir, "index.html");
    if (fs.existsSync(indexHtml)) {
      app.use(express.static(frontendDistDir, { index: false }));
      // 路由兜底：无扩展名的 GET 一律返回 index.html。这里不能 sendFile 了事 ——
      // Electron 构建产物是 base './'（loadFile 需要相对路径），而浏览器端是
      // history 路由，刷新 /setting/general 时相对资源会被解析成
      // /setting/assets/... 导致白屏。注入 <base href="/"> 把资源锚回根路径。
      // 每次读盘不缓存：dev 下前端重新 build 后不用重启后端。
      app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
        if (req.method !== "GET" || /^\/(api|static|uploads|agents)\//.test(req.path)) {
          return next();
        }
        if (path.extname(req.path)) {
          return next(); // 不存在的资产文件保持 404，不拿 HTML 顶替
        }
        let html: string;
        try {
          html = fs.readFileSync(indexHtml, "utf8");
        } catch (err) {
          console.error("读取前端 index.html 失败:", err);
          return res.status(500).send("frontend index.html unavailable");
        }
        if (!/<base\s/i.test(html)) {
          html = html.replace(/<head>/i, '<head><base href="/">');
        }
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.send(html);
      });
      console.log(`前端 SPA 目录: ${frontendDistDir}`);
    } else {
      console.warn(`⚠️  FRONTEND_DIST_DIR 配置了但找不到 index.html，跳过 SPA 挂载: ${frontendDistDir}`);
    }
  }

  // 监听地址：由宿主（Electron）通过 LISTEN_HOST 显式指定（局域网开启时 0.0.0.0，
  // 否则 127.0.0.1）。未指定时保持历史行为绑所有网卡（docker 等 Web 部署依赖）。
  const listenHost = process.env.LISTEN_HOST || "0.0.0.0";
  // 支持通过环境变量 PORT 指定端口，若未指定则使用 0 让系统自动分配可用端口
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 0;
  await app.listen(port, listenHost);
  const address = app.getHttpServer().address();
  const actualPort = typeof address === 'string' ? address.split(':').pop() : address.port;

  // 如果是自动模式，动态设置 BASE_URL
  const urlService = app.get(UrlService);
  if (urlService.isAutoMode()) {
    const baseUrl = `http://localhost:${actualPort}`;
    urlService.setBaseUrl(baseUrl);
    console.log(`BASE_URL 已动态设置为: ${baseUrl}`);
  }

  console.log(`Application is running on: http://localhost:${actualPort} (host: ${listenHost})`);
  if (listenHost === "0.0.0.0") {
    console.log(`局域网访问已开启: http://<本机IP>:${actualPort}/`);
  }

  // 通过 Bridge 通道向 Electron 上报端口
  const bridgePipePath = process.env.GUADA_BRIDGE_PATH;
  if (bridgePipePath) {
    try {
      const { BridgeClient } = await import("./modules/bridge/bridge-client");
      // 获取已初始化的 BridgeClient 实例
      const bridgeClient = app.get(BridgeClient);
      await bridgeClient.ready;
      // pid：dev 模式下 Electron 持有的是 cmd/npx 包装进程，真实后端是孙进程，
      // 上报自身 pid 让 Electron 能为真正的进程挂上退出码监视
      // host：实际绑定地址，Electron 据此判断局域网访问是否真正生效（设置页 URL 展示）
      bridgeClient.emit("port_ready", { port: actualPort, pid: process.pid, host: listenHost });
      console.log(`已通过 Bridge 上报端口: ${actualPort}`);

      // 监听 Electron 退出信号，优雅关闭
      bridgeClient.on("shutdown", async () => {
        console.log("收到 Bridge shutdown 信号，正在优雅关闭...");
        try {
          // 先静默 Registry 通知，再跑各模块 reaper。
          try {
            app.get(JobRegistryService, { strict: false }).beginShutdown();
          } catch {}
          // 强制关闭所有 HTTP 连接（包括 keep-alive），使 app.close() 不再挂起
          const server = app.getHttpServer();
          if (typeof (server as any).closeAllConnections === "function") {
            (server as any).closeAllConnections();
          }
          // app.close() 可能因残留连接挂起，设 5s 超时兜底（留给 shutdown reaper）
          await Promise.race([
            app.close(),
            new Promise((resolve) => setTimeout(resolve, 5000)),
          ]);
        } catch (e) {
          console.error("关闭应用时出错:", e);
        }
        process.exit(0);
      });
    } catch (err: any) {
      console.warn("通过 Bridge 上报端口失败:", err?.message || err);
    }
  } else {
    console.log("非 Electron 环境，跳过端口上报");
  }
}
bootstrap().catch((err) => logFatal("bootstrap", err));
