/**
 * DewSecure 认证管理器（Token 自动续期版 + 多账号无缝切换）
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

        await saveExternalAuth({ 
            token: data.access_token, 
            refreshToken: data.refresh_token,
            email: data.user.email, 
            tier: tier,
            tokenExpiresAt: Date.now() + (data.expires_in * 1000)
        });
        return { ok: true };
    } catch (e) {
        return { ok: false, error: '网络连接失败' };
    }
}

export async function saveExternalAuth(payload) {
    const { token, refreshToken, email, tokenExpiresAt } = payload;
    if (!token) return { ok: false, error: 'Missing token' };

    const { [USER_KEY]: oldUser } = await chrome.storage.local.get(USER_KEY);
    const emailChanged = email && oldUser && oldUser.email !== email;

    // 1. 只保存核心认证信息，绝不保存业务数据（tier等）
    const user = { 
        email: email || oldUser?.email || '',
        tier: emailChanged ? 'free' : (oldUser?.tier || 'free'), 
        token: token, 
        refreshToken: refreshToken || oldUser?.refreshToken || null,
        tokenExpiresAt: tokenExpiresAt || Date.now() + 3600 * 1000
    };

    await chrome.storage.local.set({ [USER_KEY]: user });

    // 2. 🌟 核心修复：强制等待云端拉取最新权限数据
    try {
        await fetchUserProfile();
    } catch (e) {
        console.warn('拉取最新权限失败:', e);
    }
    
    // 3. 云端拉取完毕，通知 UI 刷新
    chrome.runtime.sendMessage({ type: 'AUTH_STATE_CHANGED' }).catch(() => {});
    
    return { ok: true };
}

export async function logoutUser() {
    // 🔒 S-06 修复：先向 Supabase 发送服务端注销，吊销 Token
    try {
        const { [USER_KEY]: user } = await chrome.storage.local.get(USER_KEY);
        if (user && user.token) {
            await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
                method: 'POST',
                headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${user.token}` }
            });
        }
    } catch (e) {
        console.warn('服务端登出失败（可能已离线），继续执行本地清理:', e);
    }

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

// 🌟 核心：无感刷新 Token
async function refreshAccessToken(user) {
    if (!user.refreshToken) return null;
    try {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
            method: 'POST',
            headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: user.refreshToken })
        });
        if (!res.ok) throw new Error('Refresh failed');
        
        const data = await res.json();
        const newUser = {
            ...user,
            token: data.access_token,
            refreshToken: data.refresh_token,
            tokenExpiresAt: Date.now() + (data.expires_in * 1000)
        };
        await chrome.storage.local.set({ [USER_KEY]: newUser });
        return newUser;
    } catch (e) {
        console.warn("Token 续期失败:", e);
        return null;
    }
}

// 拦截请求，如果 401 或提前 5 分钟过期则自动续期重试
async function fetchWithAuth(url, options, user) {
    let currentUser = { ...user };
    
    if (Date.now() >= (currentUser.tokenExpiresAt - 5 * 60 * 1000) && currentUser.refreshToken) {
        const refreshed = await refreshAccessToken(currentUser);
        if (refreshed) currentUser = refreshed;
    }

    const doFetch = () => fetch(url, {
        ...options,
        headers: { ...options.headers, 'Authorization': `Bearer ${currentUser.token}` }
    });

    let res = await doFetch();

    if (res.status === 401 && currentUser.refreshToken) {
        const refreshed = await refreshAccessToken(currentUser);
        if (refreshed) {
            currentUser = refreshed;
            res = await doFetch();
        } else {
            console.warn("Refresh token 已失效，需要重新登录");
        }
    }
    return res;
}

export async function fetchUserProfile() {
    const { [USER_KEY]: user } = await chrome.storage.local.get(USER_KEY);
    if (!user || !user.token) return null;

    try {
        // 🌟 核心修复：必须带上当前用户的 ID 过滤，否则会被 RLS 拦截导致查不到数据！
        const userId = JSON.parse(atob(user.token.split('.')[1])).sub;
        const res = await fetchWithAuth(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=tier,subscription_ends_at,trial_ends_at,referral_days_balance,family_owner_id,created_at,stripe_customer_id`, {
            headers: { 'apikey': SUPABASE_ANON_KEY }
        }, user);
        
        let updatedUser = { ...user };
        let isFamilySub = false;
        
        if (res.ok) {
            const profiles = await res.json();
            if (profiles && profiles.length > 0) {
                const p = profiles[0];
                updatedUser.familyOwnerId = p.family_owner_id || user.familyOwnerId || null;
                isFamilySub = !!updatedUser.familyOwnerId;

                if (!isFamilySub) {
                    updatedUser.tier = p.tier || 'free';
                    
                    const nowTs = Date.now();
                    const balance = p.referral_days_balance || 0;
                    let expireDate = null;

                    if (p.subscription_ends_at) {
                        let subEnd = new Date(p.subscription_ends_at).getTime();
                        let baseTime = subEnd > nowTs ? subEnd : nowTs; 
                        expireDate = baseTime + (balance * 86400000);
                    } else if (p.trial_ends_at) {
                        let trialEnd = new Date(p.trial_ends_at).getTime();
                        let baseTime = trialEnd > nowTs ? trialEnd : nowTs;
                        expireDate = baseTime + (balance * 86400000);
                    } else if (balance > 0) {
                        const regTime = new Date(p.created_at || nowTs).getTime();
                        let calculatedExpire = regTime + (balance * 86400000);
                        expireDate = calculatedExpire > nowTs ? calculatedExpire : nowTs + (balance * 86400000);
                    }

                    const isPremium = (expireDate && expireDate > nowTs);

                    if (isPremium) {
                        updatedUser.expiresAt = new Date(expireDate).toISOString();
                        if (updatedUser.tier === 'free') {
                            updatedUser.tier = 'pro';
                        }
                    } else {
                        updatedUser.expiresAt = p.subscription_ends_at || p.trial_ends_at || null;
                        if (updatedUser.tier === 'pro' || updatedUser.tier === 'trial') {
                            updatedUser.tier = 'free';
                        }
                    }
                    
                    // 判断是否是试用
                    updatedUser.isTrial = (updatedUser.tier === 'trial') || (p.trial_ends_at && !p.stripe_customer_id);
                }
            }
        } else if (res.status === 401) {
             return null;
        }

        try {
            const devRes = await fetchWithAuth(`${SUPABASE_URL}/rest/v1/devices?select=id`, {
                headers: { 'apikey': SUPABASE_ANON_KEY }
            }, updatedUser);
            if (devRes.ok) {
                const devices = await devRes.json();
                updatedUser.deviceCount = devices.length;
            }
        } catch(e) {}

        if (isFamilySub || updatedUser.tier === 'family') {
            try {
                const rpcRes = await fetchWithAuth(`${SUPABASE_URL}/rest/v1/rpc/get_family_shared_status`, {
                    method: 'POST',
                    headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }
                }, updatedUser);
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
