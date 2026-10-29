import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { IlinkAuthError, IlinkClient } from "./client.js";
export class WechatAccountRuntime {
    options;
    client;
    cursor = '';
    running = false;
    seen = new Set();
    loop;
    constructor(options) {
        this.options = options;
        this.client = new IlinkClient({
            baseUrl: options.baseUrl,
            botToken: options.botToken,
            pollTimeoutMs: options.pollTimeoutMs,
        });
    }
    async start(onMessage, signal) {
        if (this.running)
            return;
        this.running = true;
        await mkdir(dirname(this.options.statePath), {
            recursive: true,
            mode: 0o700,
        });
        this.cursor = await readFile(this.options.statePath, 'utf8').catch(() => '');
        this.loop = (async () => {
            while (this.running && !signal.aborted) {
                try {
                    const response = await this.client.getUpdates(this.cursor, signal);
                    if (typeof response.get_updates_buf === 'string' &&
                        response.get_updates_buf.length > 0) {
                        this.cursor = response.get_updates_buf;
                        await writeFile(this.options.statePath, this.cursor, {
                            mode: 0o600,
                        });
                    }
                    for (const raw of response.msgs ?? []) {
                        const message = normalize(raw);
                        if (!message)
                            continue;
                        const key = String(raw.message_id ?? `${raw.seq}:${raw.client_id}`);
                        if (this.seen.has(key))
                            continue;
                        this.seen.add(key);
                        if (this.seen.size > 1000) {
                            const first = this.seen.values().next().value;
                            if (first !== undefined)
                                this.seen.delete(first);
                        }
                        onMessage({ ...message, accountId: this.options.accountId });
                    }
                }
                catch (error) {
                    if (!this.running || signal.aborted)
                        break;
                    if (error instanceof IlinkAuthError) {
                        this.options.logger.error(`微信账号 ${this.options.accountId} 登录态失效: ${error.message}`);
                        break;
                    }
                    this.options.logger.warn(`微信账号 ${this.options.accountId} 轮询失败: ${error instanceof Error ? error.message : String(error)}`);
                    await delay(2000, signal);
                }
            }
        })();
    }
    async stop() {
        this.running = false;
        await this.loop;
    }
    async sendReply(raw, text) {
        await this.client.sendText(raw, text, this.cursor);
    }
}
function normalize(raw) {
    if (raw.message_type === 2)
        return null;
    if (raw.message_state !== undefined && raw.message_state !== 2)
        return null;
    const text = (raw.item_list ?? [])
        .map((item) => item.text_item?.text)
        .filter((value) => typeof value === 'string' && !!value)
        .join('\n')
        .trim();
    if (!text)
        return null;
    const group = typeof raw.group_id === 'string' && raw.group_id.length > 0;
    return {
        text,
        senderId: raw.from_user_id ?? 'unknown',
        chatType: group ? 'group' : 'single',
        chatId: group ? raw.group_id : raw.from_user_id ?? 'unknown',
        raw,
    };
}
function delay(ms, signal) {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve();
        }, { once: true });
    });
}
