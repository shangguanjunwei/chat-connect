import type { IlinkMessage } from './types.ts';
export interface IncomingWechatMessage {
    accountId: string;
    text: string;
    senderId: string;
    chatType: 'single' | 'group';
    chatId: string;
    raw: IlinkMessage;
}
interface RuntimeOptions {
    accountId: string;
    baseUrl: string;
    botToken: string;
    statePath: string;
    logger: {
        info(message: string): void;
        warn(message: string): void;
        error(message: string): void;
    };
    pollTimeoutMs?: number;
}
export declare class WechatAccountRuntime {
    private readonly options;
    private readonly client;
    private cursor;
    private running;
    private readonly seen;
    private loop?;
    constructor(options: RuntimeOptions);
    start(onMessage: (message: IncomingWechatMessage) => void, signal: AbortSignal): Promise<void>;
    stop(): Promise<void>;
    sendReply(raw: IlinkMessage, text: string): Promise<void>;
}
export {};
