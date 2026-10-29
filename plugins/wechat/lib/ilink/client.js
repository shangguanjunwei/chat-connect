import { randomInt, randomUUID } from 'node:crypto';
export class IlinkError extends Error {
    code;
    constructor(message, code) {
        super(message);
        this.name = 'IlinkError';
        this.code = code;
    }
}
export class IlinkAuthError extends IlinkError {
    constructor(message, code) {
        super(message, code);
        this.name = 'IlinkAuthError';
    }
}
export class IlinkClient {
    baseUrl;
    botToken;
    channelVersion;
    requestTimeoutMs;
    pollTimeoutMs;
    constructor(options) {
        this.baseUrl = options.baseUrl.replace(/\/+$/, '');
        this.botToken = options.botToken;
        this.channelVersion = options.channelVersion ?? '2.0.2';
        this.requestTimeoutMs = options.requestTimeoutMs ?? 20_000;
        this.pollTimeoutMs = options.pollTimeoutMs ?? 35_000;
    }
    getBotQrcode(botType = 3) {
        return this.request('/ilink/bot/get_bot_qrcode', {
            method: 'POST',
            query: { bot_type: botType },
            body: {},
        });
    }
    getQrcodeStatus(qrcode) {
        return this.request('/ilink/bot/get_qrcode_status', { query: { qrcode } });
    }
    getUpdates(getUpdatesBuf, signal) {
        return this.request('/ilink/bot/getupdates', {
            method: 'POST',
            body: {
                get_updates_buf: getUpdatesBuf,
                base_info: { channel_version: this.channelVersion },
            },
            timeoutMs: this.pollTimeoutMs,
            signal,
        });
    }
    async sendText(raw, text, getUpdatesBuf = '') {
        if (!raw.context_token)
            throw new Error('原消息缺少 context_token');
        if (!raw.from_user_id)
            throw new Error('原消息缺少 from_user_id');
        const itemList = [{ type: 1, text_item: { text } }];
        const numericMessageId = typeof raw.message_id === 'string' && /^\d+$/.test(raw.message_id)
            ? Number(raw.message_id)
            : raw.message_id;
        const attempts = [
            {
                get_updates_buf: getUpdatesBuf,
                base_info: { channel_version: this.channelVersion },
                msg: {
                    seq: raw.seq,
                    from_user_id: raw.to_user_id ?? '',
                    to_user_id: raw.from_user_id,
                    client_id: raw.client_id ?? randomUUID(),
                    message_id: numericMessageId,
                    session_id: raw.session_id,
                    group_id: raw.group_id,
                    message_type: 2,
                    message_state: 2,
                    context_token: raw.context_token,
                    item_list: itemList,
                },
            },
            {
                base_info: { channel_version: this.channelVersion },
                msg: {
                    from_user_id: raw.to_user_id ?? '',
                    to_user_id: raw.from_user_id,
                    client_id: randomUUID(),
                    message_type: 2,
                    message_state: 2,
                    context_token: raw.context_token,
                    item_list: itemList,
                },
            },
        ];
        let lastError;
        for (const body of attempts) {
            try {
                await this.request('/ilink/bot/sendmessage', { method: 'POST', body });
                return;
            }
            catch (error) {
                lastError = error;
                if (!(error instanceof IlinkError) || error.code !== -1)
                    throw error;
            }
        }
        throw lastError instanceof Error ? lastError : new Error('sendmessage 失败');
    }
    async request(path, options = {}) {
        const url = new URL(`${this.baseUrl}${path}`);
        for (const [key, value] of Object.entries(options.query ?? {})) {
            if (value !== undefined)
                url.searchParams.set(key, String(value));
        }
        const headers = {
            'Content-Type': 'application/json',
            AuthorizationType: 'ilink_bot_token',
            'X-WECHAT-UIN': Buffer.from(String(randomInt(0, 2 ** 32))).toString('base64'),
            ...(this.botToken ? { Authorization: `Bearer ${this.botToken}` } : {}),
        };
        const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs;
        const controller = new AbortController();
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, timeoutMs);
        const onAbort = () => controller.abort();
        options.signal?.addEventListener('abort', onAbort, { once: true });
        try {
            const response = await fetch(url, {
                method: options.method ?? 'GET',
                headers,
                body: options.body === undefined
                    ? undefined
                    : JSON.stringify(options.body),
                signal: controller.signal,
            });
            const raw = await response.text();
            const payload = (raw ? JSON.parse(raw) : {});
            if (!response.ok) {
                throw new IlinkError(`iLink HTTP ${response.status}: ${raw.slice(0, 200)}`);
            }
            if (typeof payload.errcode === 'number' && payload.errcode !== 0) {
                const message = `iLink errcode=${payload.errcode}: ${payload.errmsg ?? ''}`;
                if (payload.errcode === -14)
                    throw new IlinkAuthError(message, -14);
                throw new IlinkError(message, payload.errcode);
            }
            if (typeof payload.ret === 'number' && payload.ret !== 0) {
                throw new IlinkError(`iLink ret=${payload.ret}: ${path}${payload.errmsg ? ` (${payload.errmsg})` : ''}`, payload.ret);
            }
            return payload;
        }
        catch (error) {
            if (timedOut)
                throw new IlinkError(`请求超时: ${path}`);
            if (error instanceof IlinkError)
                throw error;
            throw new IlinkError(`请求失败: ${path}: ${error instanceof Error ? error.message : String(error)}`);
        }
        finally {
            clearTimeout(timer);
            options.signal?.removeEventListener('abort', onAbort);
        }
    }
}
