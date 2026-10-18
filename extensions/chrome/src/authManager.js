/**
 * DewSecure 认证管理器（本地模拟版本）
 *
 * ⚠️ 本地测试用，正式版将调用 dewsecure.com 后端
 *
 * 流程：
 *   sendOTP(email)   → 生成 OTP（固定 123456），返回
 *   verifyOTP(email, otp) → 校验，成功则登录
 *   loginUser(email) → 写入 user + tier=premium
 *   logoutUser()     → 清除 user + tier=free
 *   getCurrentUser() → 读取当前用户
 */

const USER_KEY = 'dewsecure_user';
const SETTINGS_KEY = 'dewsecure_settings';
const DEVICE_KEY = 'dewsecure_device_id';

// ⚠️ 本地模拟：固定 OTP
const MOCK_OTP = '123456';
const OTP_VALIDITY_MS = 10 * 60 * 1000;      // 10 分钟
const SUBSCRIPTION_DURATION_MS = 365 * 24 * 60 * 60 * 1000;  // 1 年

// 内存中的 pending OTP（Service Worker 重启会清空，本地测试足够）
const pendingOTPs = new Map();

/* ============================================================
   邮箱格式校验
   ============================================================ */
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/* ============================================================
   生成/读取设备 ID
   ============================================================ */
async function getOrCreateDeviceId() {
    const { [DEVICE_KEY]: existing } = await chrome.storage.local.get(DEVICE_KEY);
    if (existing) return existing;

    const newId = (crypto.randomUUID && crypto.randomUUID())
        || `dev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    await chrome.storage.local.set({ [DEVICE_KEY]: newId });
    return newId;
}

/* ============================================================
   发送 OTP（本地模拟）
   ============================================================ */
export async function sendOTP(email) {
    if (!isValidEmail(email)) {
        return { ok: false, error: '邮箱格式不正确' };
    }

    // 模拟网络延迟
    await new Promise((r) => setTimeout(r, 400));

    const expiresAt = Date.now() + OTP_VALIDITY_MS;
    pendingOTPs.set(email.toLowerCase(), { otp: MOCK_OTP, expiresAt });

    console.log(`📧 [模拟] OTP 已发送至 ${email}：${MOCK_OTP}`);

    return { ok: true };
}

/* ============================================================
   验证 OTP
   ============================================================ */
export async function verifyOTP(email, inputOtp) {
    const key = email.toLowerCase();
    const pending = pendingOTPs.get(key);

    if (!pending) {
        return { ok: false, error: '未找到验证请求，请重新发送' };
    }
    if (Date.now() > pending.expiresAt) {
        pendingOTPs.delete(key);
        return { ok: false, error: '验证码已过期，请重新发送' };
    }
    if (String(inputOtp).trim() !== pending.otp) {
        return { ok: false, error: '验证码不正确' };
    }

    pendingOTPs.delete(key);
    await loginUser(email);
    return { ok: true };
}

/* ============================================================
   登录：写入 user + settings.tier
   ============================================================ */

// ===== 完美版登录逻辑（强制下发 Token） =====
export async function loginUser(email) {
    const deviceId = crypto.randomUUID ? crypto.randomUUID() : 'dev_' + Date.now();
    const now = Date.now();
    const isTestAccount = email === 'test2@example.com';
    const tier = isTestAccount ? 'free' : 'premium';
    const expiresAt = isTestAccount ? null : now + 30 * 24 * 60 * 60 * 1000;

    const user = {
        email: email,
        tier: tier,
        createdAt: now,
        expiresAt: expiresAt,
        deviceId: deviceId,
        hasUsedTrial: !isTestAccount,
        token: `mock_jwt_${tier}_${now}` // 🔥 核心修复：强制带上 token
    };

    // 写入用户表
    const USER_KEY = 'dewsecure_user';
    const SETTINGS_KEY = 'dewsecure_settings';

    await chrome.storage.local.set({ [USER_KEY]: user });

    // 同步更新 settings 里的状态
    let { [SETTINGS_KEY]: settings = {} } = await chrome.storage.local.get(SETTINGS_KEY);
    settings.tier = tier;
    settings.email = email;
    settings.activatedAt = now;
    settings.expiresAt = expiresAt;
    settings.deviceId = deviceId;
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });

    console.log('✅ [AuthManager] 登录成功，已下发 Token:', user.token);
    chrome.runtime.sendMessage({ type: 'AUTH_STATE_CHANGED' }).catch(() => {});
    return { ok: true, user };
}


export async function markTrialUsed(email) {
    const key = `trial_used_${email}`;
    await chrome.storage.local.set({ [key]: true });
}

/* ============================================================
   登出
   ============================================================ */
export async function logoutUser() {
    await chrome.storage.local.remove(USER_KEY);
    chrome.runtime.sendMessage({ type: 'AUTH_STATE_CHANGED' }).catch(() => {}); // 彻底删除 user 记录，包括 token

    const { [SETTINGS_KEY]: settings = {} } = await chrome.storage.local.get(SETTINGS_KEY);
    settings.tier = 'free';
    settings.email = null;
    settings.activatedAt = null;
    settings.expiresAt = null;
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });

    return { ok: true };
}

/* ============================================================
   读取当前用户
   ============================================================ */
export async function getCurrentUser() {
    const { [USER_KEY]: user } = await chrome.storage.local.get(USER_KEY);
    return user || null;
}

/* ============================================================
   工具：时间戳格式化
   ============================================================ */
export function formatDate(timestamp) {
    if (!timestamp) return '—';
    const d = new Date(timestamp);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}
