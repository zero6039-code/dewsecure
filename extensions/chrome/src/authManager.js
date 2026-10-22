/**
 * DewSecure 认证管理器（真实线上版）
 * 负责接收并存储来自官网 (dewsecure.com) 的真实 Supabase JWT Token
 */
const USER_KEY = 'dewsecure_user';
const SETTINGS_KEY = 'dewsecure_settings';

/**
 * 保存来自官网的真实登录数据
 */
export async function saveExternalAuth(payload) {
    const { token, email, tier } = payload;
    if (!token) return { ok: false, error: 'Missing token' };

    const now = Date.now();
    const user = {
        email: email,
        tier: tier || 'free', // 默认为 free，Worker 会再次校验
        token: token,
        lastSync: now
    };

    // 写入本地存储，供 modelManager.js 读取
    await chrome.storage.local.set({ [USER_KEY]: user });

    // 同步更新 settings 中的邮箱，UI 可能会用到
    let { [SETTINGS_KEY]: settings = {} } = await chrome.storage.local.get(SETTINGS_KEY);
    settings.email = email;
    settings.tier = user.tier;
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });

    console.log('✅ [AuthManager] 已从官网接收真实 Token，用户:', email);
    chrome.runtime.sendMessage({ type: 'AUTH_STATE_CHANGED' }).catch(() => {});
    return { ok: true, user };
}

/**
 * 清除本地登录状态（登出时调用）
 */
export async function logoutUser() {
    await chrome.storage.local.remove(USER_KEY);
    chrome.runtime.sendMessage({ type: 'AUTH_STATE_CHANGED' }).catch(() => {});

    const { [SETTINGS_KEY]: settings = {} } = await chrome.storage.local.get(SETTINGS_KEY);
    settings.tier = 'free';
    settings.email = null;
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });

    return { ok: true };
}

/**
 * 读取当前用户
 */
export async function getCurrentUser() {
    const { [USER_KEY]: user } = await chrome.storage.local.get(USER_KEY);
    return user || null;
}
