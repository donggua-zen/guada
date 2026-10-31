/**
 * 供应商/协议运行时错误
 *
 * 带稳定 code，便于上层（AgentEngine / 管理面 / 前端）按 code 路由，
 * 不依赖错误文案。文案保持人类可读并包含协议名/可用协议列表。
 */

export class UnsupportedProtocolError extends Error {
  readonly code = 'UNSUPPORTED_PROTOCOL';
  constructor(
    readonly protocol: string,
    readonly providerType?: string,
    readonly availableProtocols: string[] = [],
  ) {
    super(
      `Unsupported protocol: ${protocol}` +
        (providerType ? ` (provider ${providerType})` : '') +
        (availableProtocols.length
          ? `; available: ${availableProtocols.join(', ')}`
          : '; no protocol adapters registered'),
    );
    this.name = 'UnsupportedProtocolError';
  }
}

export class ProtocolDisabledError extends Error {
  readonly code = 'PROTOCOL_DISABLED';
  constructor(readonly protocol: string, readonly pluginId?: string) {
    super(
      `Protocol disabled: ${protocol}` +
        (pluginId ? ` (plugin ${pluginId} is disabled)` : ''),
    );
    this.name = 'ProtocolDisabledError';
  }
}
