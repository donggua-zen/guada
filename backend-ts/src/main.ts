import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { WinstonModule } from 'nest-winston';
import { AppModule } from "./app.module";
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

async function bootstrap() {
  // 修正工作目录到 backend-ts 根目录，确保 bundled-skills/、skills/ 等路径可预测
  const backendRoot = path.resolve(__dirname, '..');
  if (process.cwd() !== backendRoot) {
    process.chdir(backendRoot);
    console.log(`工作目录已修正: ${backendRoot}`);
  }

  // 创建应用实例并配置 Winston 日志
  const app = await NestFactory.create(AppModule, { logger });

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

  // 支持通过环境变量 PORT 指定端口，若未指定则使用 0 让系统自动分配可用端口
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 0;
  await app.listen(port);
  const address = app.getHttpServer().address();
  const actualPort = typeof address === 'string' ? address.split(':').pop() : address.port;

  // 如果是自动模式，动态设置 BASE_URL
  const urlService = app.get(UrlService);
  if (urlService.isAutoMode()) {
    const baseUrl = `http://localhost:${actualPort}`;
    urlService.setBaseUrl(baseUrl);
    console.log(`BASE_URL 已动态设置为: ${baseUrl}`);
  }

  console.log(`Application is running on: http://localhost:${actualPort}`);

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
      bridgeClient.emit("port_ready", { port: actualPort, pid: process.pid });
      console.log(`已通过 Bridge 上报端口: ${actualPort}`);

      // 监听 Electron 退出信号，优雅关闭
      bridgeClient.on("shutdown", async () => {
        console.log("收到 Bridge shutdown 信号，正在优雅关闭...");
        try {
          // 强制关闭所有 HTTP 连接（包括 keep-alive），使 app.close() 不再挂起
          const server = app.getHttpServer();
          if (typeof (server as any).closeAllConnections === "function") {
            (server as any).closeAllConnections();
          }
          // app.close() 可能因残留连接挂起，设 2s 超时兜底
          await Promise.race([
            app.close(),
            new Promise((resolve) => setTimeout(resolve, 2000)),
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
