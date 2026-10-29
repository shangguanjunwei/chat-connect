import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { joinAssistantStreamText } from '@deepseek-ai/dsh-llm/assistant-stream';
import { createAccount, loadAccounts, loadCredentials, } from "./ilink/accounts.js";
import { loginAccount } from "./ilink/login.js";
import { WechatAccountRuntime, } from "./ilink/runtime.js";
export class WechatBridge {
    ctx;
    config;
    accounts = new Map();
    sessionToAccount = new Map();
    disposers = [];
    constructor(ctx, config) {
        this.ctx = ctx;
        this.config = config;
    }
    async start(signal) {
        this.disposers.push(this.ctx.on('session/event', (session, event) => {
            const accountId = this.sessionToAccount.get(String(session.id));
            if (!accountId)
                return;
            const state = this.accounts.get(accountId);
            if (!state)
                return;
            if (event.type === 'assistant/message') {
                const text = joinAssistantStreamText(event.data.stream).trim();
                if (text)
                    state.pendingText = text;
                return;
            }
            if (event.type === 'turn/end') {
                void this.finishTurn(accountId);
            }
        }));
        let accounts = await loadAccounts(this.config.dataDir);
        if (accounts.length === 0) {
            accounts = [
                await createAccount(this.config.dataDir, this.config.accountIds[0] ?? '微信账号 1'),
            ];
        }
        const selected = this.config.accountIds.length > 0
            ? new Set(this.config.accountIds)
            : null;
        for (const account of accounts) {
            if (selected && !selected.has(account.id))
                continue;
            let credentials = await loadCredentials(this.config.dataDir, account.id);
            if (!credentials) {
                this.ctx.logger.info(`微信账号 ${account.label} 还没有凭据，开始扫码登录`);
                credentials = await loginAccount({
                    dataDir: this.config.dataDir,
                    account,
                    logger: this.ctx.logger,
                });
            }
            const runtime = new WechatAccountRuntime({
                accountId: account.id,
                baseUrl: credentials.baseUrl,
                botToken: credentials.botToken,
                statePath: join(this.config.dataDir, 'wechat', 'accounts', account.id, 'state.json'),
                logger: this.ctx.logger,
                pollTimeoutMs: this.config.pollTimeoutMs,
            });
            const sessionId = `wechat-${account.id}`;
            this.accounts.set(account.id, {
                runtime,
                sessionId,
                queue: [],
                busy: false,
            });
            this.sessionToAccount.set(String(sessionId), account.id);
            await runtime.start((message) => this.enqueue(account.id, message), signal);
            this.ctx.logger.info(`微信账号已接入: ${account.label}`);
        }
    }
    async stop() {
        for (const off of this.disposers.splice(0))
            off();
        for (const state of this.accounts.values()) {
            await state.runtime.stop().catch(() => undefined);
            await state.handle?.dispose().catch(() => undefined);
        }
        this.accounts.clear();
        this.sessionToAccount.clear();
    }
    enqueue(accountId, message) {
        if (!this.config.autoReply)
            return;
        const state = this.accounts.get(accountId);
        if (!state)
            return;
        state.queue.push(message);
        void this.drain(accountId);
    }
    async drain(accountId) {
        const state = this.accounts.get(accountId);
        if (!state || state.busy)
            return;
        const message = state.queue.shift();
        if (!message)
            return;
        state.busy = true;
        state.lastIncoming = message;
        state.pendingText = undefined;
        try {
            const agent = await this.ensureAgent(accountId, state);
            const userMessage = createUserMessage({
                content: [{ type: 'text', text: message.text }],
                source: { kind: 'user' },
            });
            agent.followup(userMessage);
        }
        catch (error) {
            state.busy = false;
            this.ctx.logger.error(`微信消息转 Agent 失败（${accountId}）: ${error instanceof Error ? error.message : String(error)}`);
            void this.drain(accountId);
        }
    }
    async finishTurn(accountId) {
        const state = this.accounts.get(accountId);
        if (!state)
            return;
        const text = state.pendingText;
        const incoming = state.lastIncoming;
        state.pendingText = undefined;
        state.lastIncoming = undefined;
        state.busy = false;
        if (text && incoming) {
            try {
                await state.runtime.sendReply(incoming.raw, text);
            }
            catch (error) {
                this.ctx.logger.error(`微信回复发送失败（${accountId}）: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        void this.drain(accountId);
    }
    async ensureAgent(accountId, state) {
        if (state.handle)
            return state.handle.agent;
        const workspace = join(this.config.workspaceRoot ?? '', accountId);
        await mkdir(workspace, { recursive: true, mode: 0o700 });
        const agentOptions = {
            provider: this.config.provider,
            model: this.config.model,
        };
        try {
            state.handle = await this.ctx.agents.resume({
                resumeSessionId: state.sessionId,
                agentOptions,
            });
        }
        catch {
            state.handle = await this.ctx.agents.create({
                sessionId: state.sessionId,
                meta: { cwd: workspace },
                agentOptions,
            });
        }
        return state.handle.agent;
    }
}
