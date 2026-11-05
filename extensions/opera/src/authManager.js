/**
 * DewSecure 认证管理器（Token 自动续期版 + 多账号无缝切换）
 */
const USER_KEY = 'dewsecure_user';
const SETTINGS_KEY = 'dewsecure_settings';

const SUPABASE_URL = 'https://uvbaioqqjqseapcancvi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_xiiA-yt_jRKkzRdkYkoWJA_CVZjNjq8';

// 🔒 M-3 修复：安全的 JWT 解析工具，处理 Base64URL 与 UTF-8 字符
export function jwtPayload(token) {
    try {
        const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
        return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    } catch (e) {
        return null;
    }
}

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
    const { token, refreshToken, email } = payload;
    if (!token) return { ok: false, error: 'Missing token' };

    // 🛡️ C4 修复：严格校验 JWT 的 iss、aud、exp，不再信任页面传来的 tokenExpiresAt
    const claims = jwtPayload(token);
    if (!claims) return { ok: false, error: 'Invalid JWT format' };
    
    if (claims.iss && !claims.iss.startsWith(SUPABASE_URL)) {
        return { ok: false, error: 'Invalid JWT issuer' };
    }
    if (claims.aud && claims.aud !== 'authenticated') {
        return { ok: false, error: 'Invalid JWT audience' };
    }
    if (!claims.exp || claims.exp * 1000 <= Date.now()) {
        return { ok: false, error: 'JWT expired' };
    }

    const tokenExpiresAt = claims.exp * 1000;

    const { [USER_KEY]: oldUser } = await chrome.storage.local.get(USER_KEY);
    const emailChanged = email && oldUser && oldUser.email !== email;

    const user = { 
        email: email || oldUser?.email || '',
        tier: emailChanged ? 'free' : (oldUser?.tier || 'free'), 
        token: token, 
        refreshToken: refreshToken || oldUser?.refreshToken || null,
        tokenExpiresAt: tokenExpiresAt
    };

    await chrome.storage.local.set({ [USER_KEY]: user });

    try {
        await fetchUserProfile();
    } catch (e) {
        console.warn('拉取最新权限失败:', e);
    }
    
    chrome.runtime.sendMessage({ type: 'AUTH_STATE_CHANGED' }).catch(() => {});
    
    return { ok: true };
}

export async function logoutUser() {
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
    
    // 🛡️ C4 修复：登出时清理模型缓存与情报过滤器，防止串号
    await chrome.storage.local.remove('dewsecure_intel_cache');
    try {
        indexedDB.deleteDatabase('dewsecure_threat_db');
        indexedDB.deleteDatabase('dewsecure_model_db');
    } catch (e) {}

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
        // 🔒 M-3 修复：使用 jwtPayload
        const payload = jwtPayload(user.token);
        if (!payload || !payload.sub) return null;
        
        const userId = payload.sub;
        const res = await fetchWithAuth(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=tier,subscription_ends_at,trial_ends_at,referral_days_balance,family_owner_id,created_at,stripe_customer_id`, {
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
