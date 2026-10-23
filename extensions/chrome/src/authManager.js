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
    const { token, refreshToken, email, tier, expiresAt, ownerEmail } = payload;
    if (!token) return { ok: false, error: 'Missing token' };

    const { [USER_KEY]: oldUser } = await chrome.storage.local.get(USER_KEY);
    // 🌟 判断这是不是一个完整的业务数据包（比如来自 page-dashboard.js）
    const isFullPayload = tier !== undefined;

    const user = { 
        email: email || oldUser?.email || '',
        // 只有提供了 tier 才更新，否则保留原有数据，防止被 app-init.js 的空包洗掉
        tier: tier !== undefined ? tier : (oldUser?.tier || 'free'), 
        token: token, 
        refreshToken: refreshToken || oldUser?.refreshToken || null,
        expiresAt: expiresAt !== undefined ? expiresAt : (oldUser?.expiresAt || null),
        ownerEmail: ownerEmail !== undefined ? ownerEmail : (oldUser?.ownerEmail || null),
        familyOwnerId: oldUser?.familyOwnerId || null,
        deviceCount: oldUser?.deviceCount || 0,
        lastSync: Date.now() 
    };

    await chrome.storage.local.set({ [USER_KEY]: user });

    let { [SETTINGS_KEY]: settings = {} } = await chrome.storage.local.get(SETTINGS_KEY);
    settings.email = user.email;
    settings.tier = user.tier;
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });

    console.log('✅ [AuthManager] 数据已更新:', user.email, '当前Tier:', user.tier, '(完整包:', isFullPayload, ')');
    
    if (isFullPayload) {
        chrome.runtime.sendMessage({ type: 'AUTH_STATE_CHANGED' }).catch(() => {});
    }
    
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

export async function fetchUserProfile() {
    const { [USER_KEY]: user } = await chrome.storage.local.get(USER_KEY);
    if (!user || !user.token) return null;

    try {
        // 1. 获取 Profile
        const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=*`, {
            headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${user.token}` }
        });
        let updatedUser = { ...user };
        let isFamilySub = false;
        
        if (res.ok) {
            const profiles = await res.json();
            if (profiles && profiles.length > 0) {
                const p = profiles[0];
                // 如果 profile 表里带了 family_owner_id，或者原本缓存里就有，说明是子账号
                updatedUser.familyOwnerId = p.family_owner_id || user.familyOwnerId || null;
                isFamilySub = !!updatedUser.familyOwnerId;

                // 🌟 核心防降级：如果不是子账号，才允许用 profile 里的普通 tier 覆盖
                // 如果是子账号，绝不用 profile 表的 tier 覆盖现有的 family 状态
                if (!isFamilySub) {
                    updatedUser.tier = p.tier || 'free';
                    updatedUser.expiresAt = p.trial_ends_at || null;
                }
            }
        }

        // 2. 获取设备数
        try {
            const devRes = await fetch(`${SUPABASE_URL}/rest/v1/devices?select=id`, {
                headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${user.token}` }
            });
            if (devRes.ok) {
                const devices = await devRes.json();
                updatedUser.deviceCount = devices.length;
            }
        } catch(e) {}

        // 3. 如果是子账号，或者本地缓存本来是 family，必须强查 RPC 更新时间和邮箱
        if (isFamilySub || user.tier === 'family') {
            try {
                const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_family_shared_status`, {
                    method: 'POST',
                    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${user.token}`, 'Content-Type': 'application/json' }
                });
                if (rpcRes.ok) {
                    const shared = await rpcRes.json();
                    if (shared && shared.success) {
                        updatedUser.tier = 'family';
                        updatedUser.ownerEmail = shared.owner_email;
                        updatedUser.expiresAt = shared.owner_expire;
                    }
                }
            } catch(e) { console.warn('获取家庭组状态失败', e); }
        }

        await chrome.storage.local.set({ [USER_KEY]: updatedUser });
        return updatedUser;
    } catch (e) {
        console.warn("拉取用户资料失败:", e);
    }
    return user;
}
