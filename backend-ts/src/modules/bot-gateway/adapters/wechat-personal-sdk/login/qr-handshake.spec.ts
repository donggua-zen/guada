import { IlinkJsonTransport } from "../transport/ilink-json-transport";
import { allocateLoginTicket, awaitLoginTicketResolution } from "./qr-handshake";

// 登录轮询之间的固定 1s 延迟在测试中无需真实等待
jest.mock("../internal/async-tools", () => ({
    ...jest.requireActual("../internal/async-tools"),
    delay: jest.fn(async () => undefined),
}));

function createTransport(): IlinkJsonTransport {
    return new IlinkJsonTransport({ baseUrl: "https://example.test" });
}

async function newTicket(transport: IlinkJsonTransport, qrcode = "qr-1") {
    jest.spyOn(transport, "openLoginBitmap").mockResolvedValue({
        qrcode,
        qrcode_img_content: `https://qr.test/${qrcode}`,
    });
    return allocateLoginTicket(transport, { botType: "3" });
}

describe("iLink 扫码登录握手", () => {
    it("未知登录句柄报 LOGIN_SESSION_NOT_FOUND", async () => {
        await expect(awaitLoginTicketResolution(createTransport(), "nope")).rejects.toMatchObject({
            code: "LOGIN_SESSION_NOT_FOUND",
        });
    });

    it("缺少宿主输入通道时返回未连接提示", async () => {
        const transport = createTransport();
        const ticket = await newTicket(transport);
        jest.spyOn(transport, "probeLoginPhase").mockResolvedValue({ status: "need_verifycode" });

        const outcome = await awaitLoginTicketResolution(transport, ticket.sessionKey, {
            timeoutMs: 5_000,
        });

        expect(outcome.connected).toBe(false);
        expect(outcome.message).toContain("输入通道");
    });

    it("收集数字配对码并在下一次探测中携带", async () => {
        const transport = createTransport();
        const ticket = await newTicket(transport);
        const probe = jest
            .spyOn(transport, "probeLoginPhase")
            .mockResolvedValueOnce({ status: "need_verifycode" })
            .mockResolvedValueOnce({
                status: "confirmed",
                bot_token: "token",
                ilink_bot_id: "bot-id",
            });
        const onVerificationCode = jest.fn(async () => "1234");

        const outcome = await awaitLoginTicketResolution(transport, ticket.sessionKey, {
            timeoutMs: 5_000,
            onVerificationCode,
        });

        expect(onVerificationCode).toHaveBeenCalledTimes(1);
        expect(probe.mock.calls[1][0]).toMatchObject({ verifyCode: "1234" });
        expect(outcome.connected).toBe(true);
        expect(outcome.session?.token).toBe("token");
    });

    it("配对码格式非法时报 LOGIN_VERIFY_CODE_INVALID", async () => {
        const transport = createTransport();
        const ticket = await newTicket(transport);
        jest.spyOn(transport, "probeLoginPhase").mockResolvedValue({ status: "need_verifycode" });

        await expect(
            awaitLoginTicketResolution(transport, ticket.sessionKey, {
                timeoutMs: 5_000,
                onVerificationCode: async () => "12",
            }),
        ).rejects.toMatchObject({ code: "LOGIN_VERIFY_CODE_INVALID" });
    });

    it("IDC 跳转后改用 redirect origin 继续探测", async () => {
        const transport = createTransport();
        const ticket = await newTicket(transport);
        const probe = jest
            .spyOn(transport, "probeLoginPhase")
            .mockResolvedValueOnce({
                status: "scaned_but_redirect",
                redirect_host: "redirect.test",
            })
            .mockResolvedValueOnce({
                status: "confirmed",
                bot_token: "token",
                ilink_bot_id: "bot-id",
            });

        const outcome = await awaitLoginTicketResolution(transport, ticket.sessionKey, {
            timeoutMs: 5_000,
        });

        expect(probe.mock.calls[1][0].baseUrl).toBe("https://redirect.test");
        expect(outcome.connected).toBe(true);
    });

    it("redirect_host 缺失时报 LOGIN_REDIRECT_HOST_MISSING", async () => {
        const transport = createTransport();
        const ticket = await newTicket(transport);
        jest.spyOn(transport, "probeLoginPhase").mockResolvedValue({
            status: "scaned_but_redirect",
        });

        await expect(
            awaitLoginTicketResolution(transport, ticket.sessionKey, { timeoutMs: 5_000 }),
        ).rejects.toMatchObject({ code: "LOGIN_REDIRECT_HOST_MISSING" });
    });

    it("已绑定时返回 alreadyConnected", async () => {
        const transport = createTransport();
        const ticket = await newTicket(transport);
        jest.spyOn(transport, "probeLoginPhase").mockResolvedValue({ status: "binded_redirect" });

        const outcome = await awaitLoginTicketResolution(transport, ticket.sessionKey, {
            timeoutMs: 5_000,
        });

        expect(outcome).toMatchObject({ connected: false, alreadyConnected: true });
    });

    it("二维码过期时自动换码并回调 onQrRefresh", async () => {
        const transport = createTransport();
        const open = jest
            .spyOn(transport, "openLoginBitmap")
            .mockResolvedValueOnce({ qrcode: "qr-1", qrcode_img_content: "https://qr.test/qr-1" })
            .mockResolvedValueOnce({ qrcode: "qr-2", qrcode_img_content: "https://qr.test/qr-2" });
        const ticket = await allocateLoginTicket(transport, { botType: "3" });
        jest.spyOn(transport, "probeLoginPhase")
            .mockResolvedValueOnce({ status: "expired" })
            .mockResolvedValueOnce({
                status: "confirmed",
                bot_token: "token",
                ilink_bot_id: "bot-id",
            });
        const onQrRefresh = jest.fn();

        const outcome = await awaitLoginTicketResolution(transport, ticket.sessionKey, {
            timeoutMs: 5_000,
            onQrRefresh,
        });

        expect(open).toHaveBeenCalledTimes(2);
        expect(onQrRefresh).toHaveBeenCalledWith({
            qrcode: "qr-2",
            qrCodeUrl: "https://qr.test/qr-2",
        });
        expect(outcome.connected).toBe(true);
    });

    it("refreshExpiredQr=false 时过期直接返回", async () => {
        const transport = createTransport();
        const ticket = await newTicket(transport);
        // 唯一一次调用来自 allocateLoginTicket 的初始建码
        const open = jest.spyOn(transport, "openLoginBitmap");
        jest.spyOn(transport, "probeLoginPhase").mockResolvedValue({ status: "expired" });

        const outcome = await awaitLoginTicketResolution(transport, ticket.sessionKey, {
            timeoutMs: 5_000,
            refreshExpiredQr: false,
        });

        expect(outcome).toMatchObject({ connected: false, message: "二维码已过期" });
        expect(open).toHaveBeenCalledTimes(1);
    });
});
