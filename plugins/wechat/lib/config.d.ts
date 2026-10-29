export interface WechatPluginConfig {
    dataDir: string;
    workspaceRoot?: string;
    accountIds: string[];
    provider: string;
    model: string;
    autoReply: boolean;
    pollTimeoutMs: number;
    requestTimeoutMs: number;
}
