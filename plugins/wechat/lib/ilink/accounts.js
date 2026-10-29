import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
export async function loadAccounts(dataDir) {
    try {
        const parsed = JSON.parse(await readFile(join(dataDir, 'wechat', 'accounts.json'), 'utf8'));
        return Array.isArray(parsed.accounts) ? parsed.accounts : [];
    }
    catch {
        return [];
    }
}
export async function loadCredentials(dataDir, accountId) {
    try {
        const parsed = JSON.parse(await readFile(join(dataDir, 'wechat', 'accounts', accountId, 'credentials.json'), 'utf8'));
        if (!parsed.botToken || !parsed.baseUrl)
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
export async function saveAccounts(dataDir, accounts) {
    const filePath = join(dataDir, 'wechat', 'accounts.json');
    await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
    await writeFile(filePath, `${JSON.stringify({ accounts }, null, 2)}\n`, { mode: 0o600 });
}
export async function createAccount(dataDir, label) {
    const account = {
        id: `wx-${randomUUID().slice(0, 8)}`,
        label,
    };
    const accounts = await loadAccounts(dataDir);
    accounts.push(account);
    await saveAccounts(dataDir, accounts);
    await mkdir(join(dataDir, 'wechat', 'accounts', account.id), { recursive: true, mode: 0o700 });
    return account;
}
export async function saveCredentials(dataDir, accountId, credentials) {
    const filePath = join(dataDir, 'wechat', 'accounts', accountId, 'credentials.json');
    await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
    await writeFile(filePath, `${JSON.stringify({ ...credentials, savedAt: Date.now() }, null, 2)}\n`, { mode: 0o600 });
}
