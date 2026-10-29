import type { WechatAccountRecord, WechatCredentials } from './accounts.ts';
interface LoginLogger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}
interface LoginOptions {
    dataDir: string;
    account: WechatAccountRecord;
    logger: LoginLogger;
    baseUrl?: string;
    pollIntervalMs?: number;
    timeoutMs?: number;
}
/**
 * 扫码绑定一个微信账号。二维码打印在 DSH 终端里。
 * 当前没有 Web UI，先保证插件自己能完成新账号登录。
 */
export declare function loginAccount(options: LoginOptions): Promise<WechatCredentials>;
export {};
