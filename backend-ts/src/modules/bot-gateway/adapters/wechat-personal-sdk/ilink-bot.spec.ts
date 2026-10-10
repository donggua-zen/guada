import { IlinkBot } from "./ilink-bot";

describe("IlinkBot 接收与去重", () => {
    it("ingest 走统一消息管线并记住 context_token", async () => {
        const bot = new IlinkBot({
            session: {
                token: "token",
                accountId: "bot",
                baseUrl: "https://example.test",
                cdnBaseUrl: "https://cdn.example.test",
                contextTokens: {},
            },
        });
        const listener = jest.fn();
        bot.on("message", listener);
        const event = await bot.ingest({
            message_id: 7,
            message_type: 1,
            from_user_id: "peer",
            context_token: "ctx",
            item_list: [{ type: 1, text_item: { text: "hello" } }],
        });
        expect(event.text).toBe("hello");
        expect(listener).toHaveBeenCalledWith(event);
        expect(await bot.getLatestContextToken("peer")).toBe("ctx");
    });

    it("监听器异常阻止确认，同一事件可重投且成功后去重", async () => {
        const bot = new IlinkBot();
        const errors = jest.fn();
        let attempts = 0;
        bot.on("message", () => {
            attempts += 1;
            if (attempts === 1) throw new Error("handler failed");
        });
        bot.on("listener_error", errors);

        const event = {
            message_id: 8,
            message_type: 1,
            from_user_id: "peer",
            item_list: [{ type: 1, text_item: { text: "hello" } }],
        };
        await expect(bot.ingest(event)).rejects.toMatchObject({ code: "EVENT_DELIVERY_FAILED" });
        await expect(bot.ingest(event)).resolves.toMatchObject({ id: 8 });
        await expect(bot.ingest(event)).resolves.toBeUndefined();

        expect(attempts).toBe(2);
        expect(errors).toHaveBeenCalledTimes(1);
    });

    it("文本绑定异常同样阻止确认，并保留重投机会", async () => {
        const bot = new IlinkBot();
        let attempts = 0;
        bot.onText(/hello/, async () => {
            attempts += 1;
            if (attempts === 1) throw new Error("matcher failed");
        });

        const event = {
            message_id: 9,
            message_type: 1,
            from_user_id: "peer",
            item_list: [{ type: 1, text_item: { text: "hello" } }],
        };
        await expect(bot.ingest(event)).rejects.toMatchObject({
            code: "EVENT_DELIVERY_FAILED",
            operation: "text_match",
        });
        await expect(bot.ingest(event)).resolves.toMatchObject({ id: 9 });
        await expect(bot.ingest(event)).resolves.toBeUndefined();
        expect(attempts).toBe(2);
    });

    it("ingest 拒绝无法定位或无法回复的畸形事件", async () => {
        const bot = new IlinkBot();
        await expect(bot.ingest(null)).rejects.toMatchObject({ code: "INVALID_EVENT" });
        await expect(bot.ingest({ message_id: 1 })).rejects.toThrow("from_user_id");
        await expect(bot.ingest({ message_type: 1, message_id: 1 })).rejects.toThrow(
            "from_user_id",
        );
        await expect(bot.ingest({ message_type: 1, from_user_id: "peer" })).rejects.toThrow(
            "message_id、seq 或 client_id",
        );
        await expect(
            bot.ingest({
                message_type: 1,
                from_user_id: "peer",
                client_id: "client",
                item_list: {},
            }),
        ).rejects.toThrow("item_list 必须是数组");
    });

    it("使用 client_id 定位无数值 ID 的宿主事件", async () => {
        const bot = new IlinkBot();
        const event = await bot.ingest({
            client_id: "client-message",
            message_type: 1,
            from_user_id: "peer",
            item_list: [{ type: 1, text_item: { text: "hello" } }],
        });
        expect(event.id).toBe("client-message");
    });

    it("忽略 getupdates 回送的 BOT 副本，不污染事件与回复上下文", async () => {
        const bot = new IlinkBot();
        const listener = jest.fn();
        bot.on("message", listener);
        await expect(
            bot.ingest({
                client_id: "outbound",
                message_type: 2,
                from_user_id: "",
                context_token: "must-not-store",
            }),
        ).resolves.toBeUndefined();
        expect(listener).not.toHaveBeenCalled();
        expect(await bot.getLatestContextToken("")).toBeUndefined();
    });

    it("缺少 message_type 的事件按用户消息正常投递", async () => {
        const bot = new IlinkBot();
        const listener = jest.fn();
        bot.on("message", listener);
        const event = await bot.ingest({
            message_id: 11,
            from_user_id: "peer",
            item_list: [{ type: 1, text_item: { text: "no type" } }],
        });
        expect(event.text).toBe("no type");
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("group_id 为空串或 null 时不把真实消息当毒事件丢弃", async () => {
        const bot = new IlinkBot();
        const listener = jest.fn();
        bot.on("message", listener);

        // 线上私聊事件实测会把 group_id 传成空串，context_token 也可能为 null
        const event = await bot.ingest({
            message_id: 21,
            message_type: 1,
            from_user_id: "peer",
            group_id: "",
            context_token: null,
            item_list: [{ type: 1, text_item: { text: "hi" } }],
        });

        expect(event.text).toBe("hi");
        expect(listener).toHaveBeenCalledTimes(1);
    });
});
