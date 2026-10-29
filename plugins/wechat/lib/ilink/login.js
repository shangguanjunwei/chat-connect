import qrcode from 'qrcode-terminal';
import { saveCredentials } from "./accounts.js";
import { IlinkClient } from "./client.js";
/**
 * 扫码绑定一个微信账号。二维码打印在 DSH 终端里。
 * 当前没有 Web UI，先保证插件自己能完成新账号登录。
 */
export async function loginAccount(options) {
    const baseUrl = options.baseUrl ?? 'https://ilinkai.weixin.qq.com';
    const pollIntervalMs = options.pollIntervalMs ?? 1500;
    const timeoutMs = options.timeoutMs ?? 180_000;
    const client = new IlinkClient({ baseUrl });
    const qr = await client.getBotQrcode();
    const content = qr.qrcode_img_content || qr.qrcode;
    options.logger.info(`请用微信扫描二维码绑定「${options.account.label}」:`);
    options.logger.info(`二维码链接: ${content}`);
    qrcode.generate(content, { small: true });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const status = await client.getQrcodeStatus(qr.qrcode);
        if (status.status === 'confirmed') {
            if (!status.bot_token) {
                throw new Error('扫码已确认，但 iLink 没有返回 bot_token');
            }
            const credentials = {
                botToken: status.bot_token,
                baseUrl: status.baseurl || baseUrl,
                ilinkBotId: status.ilink_bot_id,
                ilinkUserId: status.ilink_user_id,
            };
            await saveCredentials(options.dataDir, options.account.id, credentials);
            options.logger.info(`微信账号「${options.account.label}」登录成功`);
            return credentials;
        }
        if (status.status === 'expired') {
            throw new Error('二维码已过期，请重启插件重新扫码');
        }
        if (status.status === 'scaned') {
            options.logger.info('二维码已扫描，等待手机确认...');
        }
        await delay(pollIntervalMs);
    }
    throw new Error(`等待扫码超时（${Math.round(timeoutMs / 1000)}s）`);
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
