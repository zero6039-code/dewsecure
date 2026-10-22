/**
 * DewSecure 认证管理器（真实线上版）
 */
const USER_KEY = 'dewsecure_user';
const SETTINGS_KEY = 'dewsecure_settings';

// ⚠️ 填入你的 Supabase 信息
const SUPABASE_URL = 'https://uvbaioqqjqseapcancvi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_xiiA-yt_jRKkzRdkYkoWJA_CVZjNjq8';

/**
 * 发送真实的 OTP 邮件（通过 Supabase 触发 Resend）
 */
export async function sendOTP(email) {
    try {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email })
        });
        if (!res.ok) {
            const err = await res.json();
            return { ok: false, error: err.message || '发送失败，请检查邮箱' };
        }
        return { ok: true };
    } catch (e) {
        return { ok: false, error: '网络错误，请稍后再试' };
    }
}

/**
 * 校验真实的 OTP 并保存 Token
 */
export async function verifyOTP(email, token) {
    try {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, token, type: 'email' })
        });
        if (!res.ok) {
            return { ok: false, error: '验证码错误或已过期' };
        }
        const data = await res.json();
        
        // 校验成功，保存真实 Token
        await saveExternalAuth({
            token: data.access_token,
            email: data.user.email,
            tier: 'premium' // 这里初始可设为 premium，真正校验由 Worker 接管
        });
        
        return { ok: true };
    } catch (e) {
        return { ok: false, error: '网络错误' };
    }
}

/**
 * 保存认证数据 (同时供外部消息调用)
 */
export async function saveExternalAuth(payload) {
    const { token, email, tier } = payload;
    if (!token) return { ok: false, error: 'Missing token' };

    const now = Date.now();
    const user = {
        email: email,
        tier: tier || 'premium',
        token: token,
        lastSync: now
    };

    await chrome.storage.local.set({ [USER_KEY]: user });

    let { [SETTINGS_KEY]: settings = {} } = await chrome.storage.local.get(SETTINGS_KEY);
    settings.email = email;
    settings.tier = user.tier;
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });

    console.log('✅ [AuthManager] 登录成功，已保存真实 Token:', email);
    chrome.runtime.sendMessage({ type: 'AUTH_STATE_CHANGED' }).catch(() => {});
    return { ok: true, user };
}

/**
 * 清除本地登录状态
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

/**
 * 兼容 popup.js 的历史格式（报错的原因）
 */
export function formatDate(timestamp) {
    if (!timestamp) return '—';
    const d = new Date(timestamp);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
