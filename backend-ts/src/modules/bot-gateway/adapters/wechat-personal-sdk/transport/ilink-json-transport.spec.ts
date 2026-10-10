import { IlinkJsonTransport } from "./ilink-json-transport";

const originalFetch = global.fetch;

afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
});

function jsonResponse(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
    });
}

function stubFetch(impl: (url: string | URL, init: any) => Promise<Response>): jest.Mock {
    const mock = jest.fn(impl);
    global.fetch = mock as any;
    return mock;
}

function createTransport(seed: { baseUrl?: string; token?: string } = {}): IlinkJsonTransport {
    return new IlinkJsonTransport({
        baseUrl: seed.baseUrl ?? "https://example.test",
        cdnBaseUrl: "https://cdn.example.test/c2c",
        token: seed.token,
    });
}

describe("iLink transport 协议校准", () => {
    it("签名请求携带应用头与 base_info 指纹，且不再手动设置 Content-Length", async () => {
        const transport = createTransport({ token: "tok" });
        const fetchMock = stubFetch(async () => jsonResponse({ ret: 0 }));

        await transport.loadPeerTypingConfig({ ilinkUserId: "peer" });

        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe("https://example.test/ilink/bot/getconfig");
        expect(init.method).toBe("POST");
        expect(init.headers["iLink-App-Id"]).toBe("bot");
        expect(init.headers["iLink-App-ClientVersion"]).toBe("196626");
        expect(init.headers["Content-Length"]).toBeUndefined();
        expect(init.headers.Authorization).toBe("Bearer tok");
        expect(JSON.parse(init.body).base_info).toEqual({
            channel_version: "3.0.18",
            bot_agent: "OneBots/3.0.18",
        });
    });

    it("扫码创建改为 POST 且不泄露 Bearer token", async () => {
        const transport = createTransport({ token: "secret-token" });
        const fetchMock = stubFetch(async () =>
            jsonResponse({ ret: 0, qrcode: "qr-1", qrcode_img_content: "https://qr.test/1" }),
        );

        const reply = await transport.openLoginBitmap({ botType: "3" });

        expect(reply.qrcode).toBe("qr-1");
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toContain("get_bot_qrcode?bot_type=3");
        expect(init.method).toBe("POST");
        expect(init.headers.Authorization).toBeUndefined();
        expect(JSON.parse(init.body)).toEqual({ local_token_list: [] });
    });

    it("扫码响应缺失二维码时报 INVALID_QR_RESPONSE", async () => {
        const transport = createTransport();
        stubFetch(async () => jsonResponse({ ret: 0, qrcode: "", qrcode_img_content: "" }));

        await expect(transport.openLoginBitmap()).rejects.toMatchObject({
            code: "INVALID_QR_RESPONSE",
        });
    });

    it("扫码轮询转发 verify_code 并拒绝未知状态", async () => {
        const transport = createTransport();
        const fetchMock = stubFetch(async () => jsonResponse({ ret: 0, status: "wait" }));

        await transport.probeLoginPhase({ qrcode: "qr-1", verifyCode: "1234" });
        const [url] = fetchMock.mock.calls[0];
        expect(String(url)).toContain("qrcode=qr-1");
        expect(String(url)).toContain("verify_code=1234");

        stubFetch(async () => jsonResponse({ ret: 0, status: "bogus" }));
        await expect(transport.probeLoginPhase({ qrcode: "qr-1" })).rejects.toMatchObject({
            code: "INVALID_QR_STATUS",
        });
    });

    it("扫码轮询在时钟超时时返回 wait，在外层中止时重抛原因", async () => {
        const transport = createTransport();
        stubFetch(
            (_url, init) =>
                new Promise((_resolve, reject) => {
                    init.signal.addEventListener("abort", () => reject(init.signal.reason), {
                        once: true,
                    });
                }),
        );

        await expect(
            transport.probeLoginPhase({ qrcode: "qr-1", budgetMs: 5 }),
        ).resolves.toEqual({ status: "wait" });

        const controller = new AbortController();
        const reason = new Error("stop-now");
        const pending = transport.probeLoginPhase({
            qrcode: "qr-1",
            budgetMs: 60_000,
            signal: controller.signal,
        });
        controller.abort(reason);
        await expect(pending).rejects.toBe(reason);
    });

    it("长轮询中止时透传中止原因", async () => {
        const transport = createTransport();
        stubFetch(
            (_url, init) =>
                new Promise((_resolve, reject) => {
                    init.signal.addEventListener("abort", () => reject(init.signal.reason), {
                        once: true,
                    });
                }),
        );

        const controller = new AbortController();
        const reason = new Error("stop");
        const pending = transport.pullUnreadBatch("cursor", 60_000, controller.signal);
        controller.abort(reason);

        await expect(pending).rejects.toBe(reason);
    });

    it("统一校验业务错误：-14 视为凭证失效，其它非 0 报 API_ERROR", async () => {
        const transport = createTransport();

        stubFetch(async () => jsonResponse({ ret: -14, errmsg: "expired" }));
        await expect(transport.loadPeerTypingConfig({ ilinkUserId: "peer" })).rejects.toMatchObject({
            code: "SESSION_EXPIRED",
        });

        stubFetch(async () => jsonResponse({ ret: 0, errcode: 7, errmsg: "boom" }));
        await expect(transport.loadPeerTypingConfig({ ilinkUserId: "peer" })).rejects.toMatchObject({
            code: "API_ERROR",
            operation: "getconfig",
        });
    });

    it("非法 JSON 响应报 INVALID_JSON", async () => {
        const transport = createTransport();
        stubFetch(async () => new Response("not-json", { status: 200 }));

        await expect(transport.notifyStart()).rejects.toMatchObject({ code: "INVALID_JSON" });
    });

    it("上线/下线通知命中对应端点", async () => {
        const transport = createTransport();
        const fetchMock = stubFetch(async () => jsonResponse({ ret: 0 }));

        await transport.notifyStart();
        await transport.notifyStop();

        expect(String(fetchMock.mock.calls[0][0])).toBe(
            "https://example.test/ilink/bot/msg/notifystart",
        );
        expect(String(fetchMock.mock.calls[1][0])).toBe(
            "https://example.test/ilink/bot/msg/notifystop",
        );
    });

    it("服务根地址强制 HTTPS（回环例外）并去除尾斜杠", () => {
        expect(() => createTransport({ baseUrl: "http://evil.test" })).toThrow(/HTTPS/);
        expect(() => createTransport({ baseUrl: "https://user:pw@example.test" })).toThrow(
            /凭据/,
        );
        expect(createTransport({ baseUrl: "http://127.0.0.1:8080" }).baseUrl).toBe(
            "http://127.0.0.1:8080",
        );
        expect(createTransport({ baseUrl: "https://example.test/" }).baseUrl).toBe(
            "https://example.test",
        );
    });
});
