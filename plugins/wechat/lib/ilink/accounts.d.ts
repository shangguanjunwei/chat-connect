export interface WechatAccountRecord {
    id: string;
    label: string;
    skillsDir?: string;
}
export interface WechatCredentials {
    botToken: string;
    baseUrl: string;
    ilinkBotId?: string;
    ilinkUserId?: string;
}
export declare function loadAccounts(dataDir: string): Promise<WechatAccountRecord[]>;
export declare function loadCredentials(dataDir: string, accountId: string): Promise<WechatCredentials | null>;
export declare function saveAccounts(dataDir: string, accounts: WechatAccountRecord[]): Promise<void>;
export declare function createAccount(dataDir: string, label: string): Promise<WechatAccountRecord>;
export declare function saveCredentials(dataDir: string, accountId: string, credentials: WechatCredentials): Promise<void>;
