import type { Context } from '@deepseek-ai/cordis';
import type { WechatPluginConfig } from './config.ts';
export declare class WechatBridge {
    private readonly ctx;
    private readonly config;
    private readonly accounts;
    private readonly sessionToAccount;
    private readonly disposers;
    constructor(ctx: Context, config: WechatPluginConfig);
    start(signal: AbortSignal): Promise<void>;
    stop(): Promise<void>;
    private enqueue;
    private drain;
    private finishTurn;
    private ensureAgent;
}
