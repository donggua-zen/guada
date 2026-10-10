import type { InboundWirePacket, WireFileSection, WireImageSection, WireVideoSection, WireVoiceSection } from "./wire-models";

export type InputFile =
    | string
    | URL
    | Buffer
    | Uint8Array
    | {
          source: Buffer | Uint8Array;
          filename?: string;
          contentType?: string;
      };

export interface CredentialBlob {
    token: string;
    accountId: string;
    userId?: string;
    baseUrl: string;
    cdnBaseUrl: string;
    routeTag?: string;
    syncBuffer?: string;
    contextTokens?: Record<string, string>;
    createdAt?: string;
    updatedAt?: string;
}

export interface SessionStore {
    load(): Promise<CredentialBlob | null>;
    save(session: CredentialBlob): Promise<void>;
    clear(): Promise<void>;
}

export interface ChatHandle {
    id: string;
    type: "private";
}

export interface PeerHandle {
    id: string;
}

export type NormalizedFacet = "text" | "photo" | "video" | "document" | "voice" | "unknown";

export interface MediaPhoto {
    kind: "photo";
    fileId?: string;
    downloadUrl?: string;
    aesKey?: string;
    item: WireImageSection;
}

export interface MediaVideo {
    kind: "video";
    fileId?: string;
    downloadUrl?: string;
    aesKey?: string;
    item: WireVideoSection;
}

export interface MediaDocument {
    kind: "document";
    fileId?: string;
    downloadUrl?: string;
    aesKey?: string;
    fileName?: string;
    item: WireFileSection;
}

export interface MediaVoice {
    kind: "voice";
    fileId?: string;
    downloadUrl?: string;
    aesKey?: string;
    transcript?: string;
    item: WireVoiceSection;
}

export type NormalizedMedia = MediaPhoto | MediaVideo | MediaDocument | MediaVoice;

/** 适配器消费的统一消息视图 */
export interface NormalizedChatEvent {
    id: string | number | undefined;
    seq: number | undefined;
    type: NormalizedFacet;
    chat: ChatHandle;
    from: PeerHandle;
    date: number | undefined;
    text?: string;
    caption?: string;
    contextToken?: string;
    media?: NormalizedMedia;
    raw: InboundWirePacket;
}

export interface SendCommonOptions {
    contextToken?: string;
}

export interface SendMediaOptions extends SendCommonOptions {
    caption?: string;
    filename?: string;
    contentType?: string;
}

export interface PollingOptions {
    timeoutMs?: number;
    /** @deprecated 使用 retryInitialDelayMs；保留作为初始退避延迟的兼容位。 */
    retryDelayMs?: number;
    /** 首次重试延迟，默认 1000ms。 */
    retryInitialDelayMs?: number;
    /** 重试延迟上限，默认 30000ms。 */
    retryMaxDelayMs?: number;
    /** 外部取消信号，会与内部轮询控制器联动。 */
    signal?: AbortSignal;
}

export interface DownloadMediaResult {
    buffer: Buffer;
    mimeType: string;
    fileName?: string;
}

export interface DownloadMediaOptions {
    filePath?: string;
    fileName?: string;
}

export interface LoginTicket {
    sessionKey: string;
    qrcode: string;
    qrCodeUrl: string;
    baseUrl: string;
    botType: string;
}

export interface WaitForLoginOptions {
    timeoutMs?: number;
    refreshExpiredQr?: boolean;
    signal?: AbortSignal;
    /** 二维码过期后自动换发新码时回调，便于推送到 Web 更新 UI */
    onQrRefresh?: (ticket: Pick<LoginTicket, "qrcode" | "qrCodeUrl">) => void;
    /** 手机端要求数字配对码时，由宿主安全地向用户收集并返回。 */
    onVerificationCode?: () => Promise<string>;
}

export interface LoginOutcome {
    connected: boolean;
    /** 上游判定该微信已绑定当前客户端，无需重复创建会话。 */
    alreadyConnected?: boolean;
    message: string;
    session?: CredentialBlob;
}

export type OnTextListener = (message: NormalizedChatEvent, match: RegExpExecArray) => void | Promise<void>;
