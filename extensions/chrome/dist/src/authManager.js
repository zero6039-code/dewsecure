/**
 * DewSecure 认证管理器（真实线上版）
 */
const USER_KEY = 'dewsecure_user';
const SETTINGS_KEY = 'dewsecure_settings';

const SUPABASE_URL = 'https://uvbaioqqjqseapcancvi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_xiiA-yt_jRKkzRdkYkoWJA_CVZjNjq8';

export async function sendOTP(email) {
    try {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
            method: 'POST',
            headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        
        if (!res.ok) {
            const err = await res.json();
            if (res.status === 429 || (err.message && err.message.toLowerCase().includes('rate limit'))) {
                return { ok: false, error: '请求过于频繁，请在 60 秒后再试' };
            }
            return { ok: false, error: err.message || err.msg || '发送失败，请稍后再试' };
        }
        return { ok: true };
    } catch (e) {
        return { ok: false, error: '网络错误，请稍后再试' };
    }
}

export async function verifyOTP(email, token) {
    try {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
            method: 'POST',
            headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, token, type: 'email' })
        });
        
        const data = await res.json();
        if (!res.ok) return { ok: false, error: data.msg || data.error_description || '验证码错误或已过期' };
        if (!data.access_token) return { ok: false, error: '未获取到 Token' };
        
        let tier = 'free';
        try {
            const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${data.user.id}&select=tier`, {
                headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${data.access_token}` }
            });
            const profiles = await profileRes.json();
            if (profiles && profiles.length > 0) tier = profiles[0].tier;
        } catch (e) {}

        await saveExternalAuth({ token: data.access_token, email: data.user.email, tier: tier });
        return { ok: true };
    } catch (e) {
        return { ok: false, error: '网络连接失败' };
    }
}

export async function saveExternalAuth(payload) {
    const { token, refreshToken, email, tier } = payload;
    if (!token) return { ok: false, error: 'Missing token' };

    const user = { 
        email: email, 
        tier: tier || 'premium', 
        token: token, 
        refreshToken: refreshToken, 
        lastSync: Date.now() 
    };

    await chrome.storage.local.set({ [USER_KEY]: user });

    let { [SETTINGS_KEY]: settings = {} } = await chrome.storage.local.get(SETTINGS_KEY);
    settings.email = email;
    settings.tier = user.tier;
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });

    console.log('✅ [AuthManager] 登录成功，已保存 Token 与 RefreshToken:', email);
    chrome.runtime.sendMessage({ type: 'AUTH_STATE_CHANGED' }).catch(() => {});
    return { ok: true, user };
}

export async function logoutUser() {
    await chrome.storage.local.remove(USER_KEY);
    chrome.runtime.sendMessage({ type: 'AUTH_STATE_CHANGED' }).catch(() => {});

    const { [SETTINGS_KEY]: settings = {} } = await chrome.storage.local.get(SETTINGS_KEY);
    settings.tier = 'free';
    settings.email = null;
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    return { ok: true };
}

export async function getCurrentUser() {
    const { [USER_KEY]: user } = await chrome.storage.local.get(USER_KEY);
    return user || null;
}

export function formatDate(timestamp) {
    if (!timestamp) return '—';
    const d = new Date(timestamp);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 从 Supabase 拉取最新的用户资料
 */
export async function fetchUserProfile() {
    const { [USER_KEY]: user } = await chrome.storage.local.get(USER_KEY);
    if (!user || !user.token) return null;

    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=*`, {
            headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${user.token}` }
        });
        
        if (!res.ok) return user;
        
        const profiles = await res.json();
        if (profiles && profiles.length > 0) {
            const p = profiles[0];
            const updatedUser = { ...user, tier: p.tier || 'free', expiresAt: p.trial_ends_at || null };
            await chrome.storage.local.set({ [USER_KEY]: updatedUser });
            return updatedUser;
        }
    } catch (e) {
        console.warn("拉取用户资料失败:", e);
    }
    return user;
}
