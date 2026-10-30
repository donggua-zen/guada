import log from "electron-log/main";

/**
 * 内置浏览器 partition 的权限治理（对齐 zcode 的 fail-closed 策略）。
 *
 * Electron 未注册 permission handler 的 session 会自动批准所有权限请求：
 * 恶意页面可静默拿到摄像头/麦克风/地理位置/剪贴板读取；设备类 API 未监听
 * select-* 事件时还会静默连接第一个匹配设备。本模块对共享 browser session
 * 注册默认拒绝的 request/check/device/displayMedia handler：
 *
 * - 无害白名单（剪贴板写/fullscreen/pointerLock/DRM）放行——拒绝会造成
 *   页面大面积功能故障且不泄露数据；
 * - 摄像头、麦克风、地理位置、通知、USB/HID 等敏感权限一律拒绝并记日志；
 * - 后续接入产品级授权弹窗时只需替换 deny 分支。
 */

const SILENT_ALLOW_PERMISSIONS: ReadonlySet<string> = new Set([
  "clipboard-sanitized-write",
  "fullscreen",
  "pointerLock",
  "mediaKeySystem",
]);

const registeredSessions = new WeakSet<Electron.Session>();

function originOf(url: string | undefined): string {
  try {
    return new URL(url ?? "").origin;
  } catch {
    return "unknown";
  }
}

export function applyBrowserPermissionPolicy(
  targetSession: Electron.Session,
  source = "browser_shared",
): void {
  if (registeredSessions.has(targetSession)) return;
  registeredSessions.add(targetSession);

  targetSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (SILENT_ALLOW_PERMISSIONS.has(permission)) {
      callback(true);
      return;
    }
    log.info(
      `[browser-permission] denied request: ${permission} origin=${originOf(
        details?.requestingUrl ?? webContents?.getURL(),
      )} session=${source}`,
    );
    callback(false);
  });

  targetSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    if (SILENT_ALLOW_PERMISSIONS.has(permission)) return true;
    log.info(
      `[browser-permission] denied check: ${permission} origin=${originOf(
        requestingOrigin ?? webContents?.getURL(),
      )} session=${source}`,
    );
    return false;
  });

  // 设备选择：不注册回调时 Electron 会静默授权第一个匹配设备。
  // 显式取消所有选择，设备类页面拿到明确的"未授权"而不是假成功。
  targetSession.on(
    "select-hid-device",
    (_event, _details, callback) => {
      log.info(`[browser-permission] device selection cancelled: select-hid-device session=${source}`);
      callback();
    },
  );
  targetSession.on(
    "select-usb-device",
    (_event, _details, callback) => {
      log.info(`[browser-permission] device selection cancelled: select-usb-device session=${source}`);
      callback();
    },
  );
  targetSession.on(
    "select-serial-port",
    (_event, _port, _webContents, callback) => {
      log.info(`[browser-permission] device selection cancelled: select-serial-port session=${source}`);
      callback("");
    },
  );

  targetSession.setDisplayMediaRequestHandler((_request, callback) => {
    log.info(`[browser-permission] denied display-media session=${source}`);
    // 空 options = 不提供任何源，请求方收到失败。
    callback({});
  });
}
