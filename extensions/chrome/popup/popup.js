import { sendOTP, verifyOTP, loginUser, logoutUser, getCurrentUser, formatDate }
    from '../src/authManager.js';

/**
 * DewSecure Popup — 毛玻璃 + iOS Toggle + Tier 锁定
 */

async function init() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const { stats, settings } = await chrome.runtime.sendMessage({ type: 'GET_STATS' });

    updateStats(stats);
    updateLimit(settings);
    updateFeatureToggles(settings);
    applyTierLock(settings);
    updateUpgradeButton(settings);

    // 登录按钮状态（登录后改为「查看状态」）
    const currentUser = await getCurrentUser();
    updateLoginButton(currentUser);

    // ---- 站点开关 ----
    if (tab?.url && /^https?:/.test(tab.url)) {
        try {
            const host = new URL(tab.url).hostname;
            const isWhitelisted = (settings.whitelist || []).some((d) => host.endsWith(d));
            updateSiteSwitch(!isWhitelisted, host);
        } catch (e) {
            disableSiteSwitch();
        }
    } else {
        disableSiteSwitch();
    }

    bindEvents(settings);
}

/* ============================================================
   状态渲染
   ============================================================ */

function updateStats(stats) {
    document.getElementById('todayBlocked').textContent = stats?.todayBlocked || 0;
    document.getElementById('totalBlocked').textContent = stats?.totalBlocked || 0;
}

function updateLimit(settings) {
    const limitCard = document.getElementById('limitBar');
    const limitText = document.getElementById('limitText');
    const fill = document.getElementById('limitFill');

    const isPremium = isPremiumUser(settings);

    if (isPremium) {
        limitCard.classList.add('premium');
        limitText.textContent = '无限';
        fill.style.width = '100%';
        fill.classList.remove('warning');
        return;
    }

    limitCard.classList.remove('premium');
    const used = settings.dailyUsed || 0;
    const limit = settings.dailyLimit || 50;
    const percent = Math.min(100, (used / limit) * 100);

    limitText.textContent = `${used} / ${limit}`;
    fill.style.width = `${percent}%`;
    fill.classList.toggle('warning', percent > 80);
}

function updateSiteSwitch(isProtected, host) {
    const switchEl = document.getElementById('siteSwitch');
    const domainEl = document.getElementById('siteDomain');
    const labelEl  = document.getElementById('siteLabel');
    const statusEl = document.getElementById('status');

    if (domainEl) domainEl.textContent = host || '此网站';

    switchEl.checked = isProtected;
    switchEl.dataset.host = host || '';
    switchEl.dataset.protected = isProtected ? '1' : '0';

    if (isProtected) {
        if (labelEl) labelEl.textContent = '保护已开启';
        statusEl.textContent = '保护中';
        statusEl.classList.remove('paused');
        statusEl.classList.add('active');
    } else {
        if (labelEl) labelEl.textContent = '保护已暂停';
        statusEl.textContent = '已暂停';
        statusEl.classList.remove('active');
        statusEl.classList.add('paused');
    }
}

function disableSiteSwitch() {
    const switchEl = document.getElementById('siteSwitch');
    const domainEl = document.getElementById('siteDomain');
    const labelEl  = document.getElementById('siteLabel');
    const statusEl = document.getElementById('status');

    switchEl.disabled = true;
    switchEl.checked = false;
    switchEl.dataset.host = '';
    switchEl.dataset.protected = '0';

    const wrap = document.getElementById('siteSwitchWrap');
    if (wrap) {
        wrap.style.opacity = '0.35';
        wrap.style.pointerEvents = 'none';
    }

    if (domainEl) domainEl.textContent = '—';
    if (labelEl)  labelEl.textContent = '当前页面不支持';
    statusEl.textContent = '不可用';
    statusEl.classList.remove('active', 'paused');
}

/* ============================================================
   功能开关渲染
   ============================================================ */

function updateFeatureToggles(settings) {
    document.getElementById('aiToggle').checked          = settings.aiEnabled !== false;
    document.getElementById('trackerToggle').checked     = settings.blockTrackers !== false;
    document.getElementById('antiBypassToggle').checked  = settings.antiBypassEnabled !== false;
    document.getElementById('cookieToggle').checked      = settings.hideCookieNotices !== false;
    document.getElementById('placeholderToggle').checked = settings.hideAdPlaceholders !== false;
    document.getElementById('socialToggle').checked      = settings.blockSocialTrackers !== false;
}

/* ============================================================
   Tier 功能锁定
   ============================================================ */

function isPremiumUser(settings) {
    return settings.tier === 'premium'
        || settings.tier === 'family'
        || settings.subscription === 'premium';
}

function applyTierLock(settings) {
    const isPremium = isPremiumUser(settings);
    const lockedRows = document.querySelectorAll('[data-requires="premium"]');

    lockedRows.forEach((row) => {
        if (isPremium) {
            row.classList.remove('locked');
        } else {
            row.classList.add('locked');
        }
    });
}

function updateUpgradeButton(settings) {
    const btn = document.getElementById('upgradeBtn');
    if (!btn) return;

    const isPremium = isPremiumUser(settings);
    const textEl = btn.querySelector('.btn-upgrade-text');

    if (isPremium) {
        btn.classList.add('upgraded');
        btn.disabled = true;
        if (textEl) textEl.textContent = '已升级到高级版';
    } else {
        btn.classList.remove('upgraded');
        btn.disabled = false;
        if (textEl) textEl.textContent = '升级到高级版';
    }
}

/**
 * 登录按钮状态
 * - 未登录：登录
 * - 已登录：查看状态
 */
function updateLoginButton(user) {
    const textEl = document.getElementById('loginBtnText');
    if (!textEl) return;
    textEl.textContent = user ? '查看状态' : '登录';
}

/* ============================================================
   事件绑定
   ============================================================ */

function bindEvents(settings) {
    // ---- 站点 Toggle ----
    document.getElementById('siteSwitch').addEventListener('change', async (e) => {
        const switchEl = e.target;
        const host = switchEl.dataset.host;
        if (!host) return;

        const willProtect = switchEl.checked;
        updateSiteSwitch(willProtect, host);

        try {
            if (willProtect) {
                await chrome.runtime.sendMessage({ type: 'REMOVE_WHITELIST', domain: host });
            } else {
                await chrome.runtime.sendMessage({ type: 'ADD_WHITELIST', domain: host });
            }
        } catch (err) {
            updateSiteSwitch(!willProtect, host);
        }
    });

    // ---- 功能开关 ----
    const bindFeature = (id, key) => {
        document.getElementById(id).addEventListener('change', async (e) => {
            settings[key] = e.target.checked;
            await chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings });
        });
    };

    bindFeature('aiToggle',          'aiEnabled');
    bindFeature('trackerToggle',     'blockTrackers');
    bindFeature('antiBypassToggle',  'antiBypassEnabled');
    bindFeature('cookieToggle',      'hideCookieNotices');
    bindFeature('placeholderToggle', 'hideAdPlaceholders');
    bindFeature('socialToggle',      'blockSocialTrackers');

    // ---- 登录 / 升级 ----
    document.getElementById('loginBtn').addEventListener('click', openAuthModal);
    document.getElementById('modalClose').addEventListener('click', closeAuthModal);

    // 点击遮罩层关闭 authModal
    document.getElementById('authModal').addEventListener('click', (e) => {
        if (e.target.id === 'authModal') closeAuthModal();
    });

    // ESC 键关闭所有弹窗
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeAuthModal();
            closeConfirmModal();
            closeSettingsModal();
        }
    });
    document.getElementById('sendOtpBtn').addEventListener('click', handleSendOtp);
    document.getElementById('verifyOtpBtn').addEventListener('click', handleVerifyOtp);
    document.getElementById('resendOtpBtn').addEventListener('click', handleResendOtp);
    document.getElementById('backToEmailBtn').addEventListener('click', () => showAuthStep('email'));
    document.getElementById('googleLoginBtn').addEventListener('click', handleGoogleLogin);
    document.getElementById('manageAccountBtn').addEventListener('click', () => {
        chrome.tabs.create({ url: 'https://dewsecure.com/dashboard' });
    });
    document.getElementById('logoutBtn').addEventListener('click', openConfirmModal);
    document.getElementById('confirmLogoutBtn').addEventListener('click', handleLogoutConfirmed);
    document.getElementById('cancelLogoutBtn').addEventListener('click', closeConfirmModal);

    // 点击遮罩关闭 confirm
    document.getElementById('confirmModal').addEventListener('click', (e) => {
        if (e.target.id === 'confirmModal') closeConfirmModal();
    });

    // ============ 设置弹窗 ============
    document.getElementById('settingsLink').addEventListener('click', (e) => {
        e.preventDefault();
        openSettingsModal();
    });
    document.getElementById('settingsClose').addEventListener('click', closeSettingsModal);
    document.getElementById('settingsModal').addEventListener('click', (e) => {
        if (e.target.id === 'settingsModal') closeSettingsModal();
    });

    // 语言选择
    document.querySelectorAll('.lang-option').forEach((btn) => {
        btn.addEventListener('click', () => handleLanguageSelect(btn));
    });

    // 反馈链接
    document.getElementById('reportLinkBtn').addEventListener('click', () => {
        chrome.tabs.create({ url: 'https://dewsecure.com/report' });
    });

    // 回车提交
    document.getElementById('authEmail').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleSendOtp();
    });
    document.getElementById('otpInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleVerifyOtp();
    });
    // OTP 自动跳焦
    document.getElementById('otpInput').addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
    });

    document.getElementById('upgradeBtn').addEventListener('click', () => {
        chrome.tabs.create({ url: 'https://dewsecure.com/pricing' });
    });



    // ---- 反馈 ----
    document.getElementById('reportMissed').addEventListener('click', () => handleReport('missed'));
    document.getElementById('reportFalse').addEventListener('click', () => handleReport('false_positive'));
}

/* ============================================================
   反馈处理
   ============================================================ */

async function handleReport(type) {
    const hint = document.getElementById('feedbackHint');
    const button = type === 'missed'
        ? document.getElementById('reportMissed')
        : document.getElementById('reportFalse');
    const buttons = document.querySelectorAll('.btn-feedback');

    // 记下原始文字
    const originalText = button.textContent;

    // 立即禁用所有反馈按钮
    buttons.forEach((b) => (b.disabled = true));
    button.textContent = '⏳ 上报中...';

    // 清空提示
    hint.textContent = '';
    hint.classList.remove('success', 'error');

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const url = tab?.url || '';

        const response = await chrome.runtime.sendMessage({
            type: 'REPORT_FEEDBACK',
            reportType: type,
            url,
            timestamp: Date.now(),
        });

        if (response?.ok) {
            // 成功：按钮变绿 + 显示对勾
            button.textContent = '✅ 已记录';
            button.classList.add('success');
            hint.textContent = '感谢反馈！已帮助改进 AI 模型';
            hint.classList.add('success');
            hint.classList.remove('error');

            // 2.5 秒后恢复按钮
            setTimeout(() => {
                button.textContent = originalText;
                button.classList.remove('success');
                buttons.forEach((b) => (b.disabled = false));
            }, 2500);

            // 6 秒后清空提示
            setTimeout(() => {
                hint.textContent = '您的反馈将匿名上传，帮助 AI 持续进化';
                hint.classList.remove('success', 'error');
            }, 6000);
        } else {
            // 失败
            button.textContent = '⚠️ 失败';
            button.classList.add('error');
            hint.textContent = response?.error || '反馈失败，请稍后重试';
            hint.classList.add('error');
            hint.classList.remove('success');

            setTimeout(() => {
                button.textContent = originalText;
                button.classList.remove('error');
                buttons.forEach((b) => (b.disabled = false));
            }, 2500);
        }
    } catch (e) {
        button.textContent = '⚠️ 失败';
        button.classList.add('error');
        hint.textContent = '反馈失败：' + e.message;
        hint.classList.add('error');

        setTimeout(() => {
            button.textContent = originalText;
            button.classList.remove('error');
            buttons.forEach((b) => (b.disabled = false));
        }, 2500);
    }
}


/* ============================================================
   认证模态框逻辑
   ============================================================ */

let currentAuthEmail = '';
let justLoggedIn = false;

async function openAuthModal() {
    const modal = document.getElementById('authModal');
    modal.classList.remove('hidden');

    const user = await getCurrentUser();
    if (user) {
        showAuthStep('logged-in');
        populateLoggedInView(user);
    } else {
        showAuthStep('email');
        document.getElementById('authEmail').value = '';
        document.getElementById('emailHint').textContent = '';
        document.getElementById('emailHint').classList.remove('error', 'success');
    }
}

function closeAuthModal() {
    document.getElementById('authModal').classList.add('hidden');

    // 如果刚刚登录成功，用户关闭弹窗后才刷新主界面
    if (justLoggedIn) {
        justLoggedIn = false;
        setTimeout(() => window.location.reload(), 200);
    }
}

/**
 * 触发抖动动画（每次都强制重新播放）
 */
function triggerShake(el) {
    if (!el) return;
    el.classList.remove('error');
    void el.offsetWidth;   // 强制 reflow，让动画能重新触发
    el.classList.add('error');
}

function showAuthStep(step) {
    const authModal = document.getElementById('authModal');
    if (!authModal) return;

    // 只处理 authModal 内部的 auth-step，避免影响其他弹窗
    authModal.querySelectorAll('.auth-step').forEach((el) => {
        el.classList.toggle('hidden', el.dataset.step !== step);
    });
    const input = document.getElementById('otpInput');
    if (step === 'otp' && input) {
        setTimeout(() => input.focus(), 100);
        input.value = '';
        input.classList.remove('error');
        document.getElementById('otpHint').innerHTML =
            '💡 本地测试模式：验证码为 <strong>123456</strong>';
        document.getElementById('otpHint').classList.remove('error', 'success');
    }
}

/* ---- 发送 OTP ---- */
async function handleSendOtp() {
    const emailInput = document.getElementById('authEmail');
    const hint = document.getElementById('emailHint');
    const btn = document.getElementById('sendOtpBtn');
    const email = emailInput.value.trim();

    hint.textContent = '';
    hint.classList.remove('error', 'success');
    emailInput.classList.remove('error');

    if (!email) {
        hint.textContent = '请输入邮箱';
        hint.classList.add('error');
        triggerShake(emailInput);
        return;
    }

    btn.disabled = true;
    btn.textContent = '发送中...';

    const result = await sendOTP(email);

    btn.disabled = false;
    btn.textContent = '发送验证码';

    if (!result.ok) {
        hint.textContent = result.error;
        hint.classList.add('error');
        triggerShake(emailInput);
        return;
    }

    currentAuthEmail = email;
    document.getElementById('sentEmail').textContent = email;
    showAuthStep('otp');
}

/* ---- 验证 OTP ---- */
async function handleVerifyOtp() {
    const input = document.getElementById('otpInput');
    const hint = document.getElementById('otpHint');
    const btn = document.getElementById('verifyOtpBtn');
    const otp = input.value.trim();

    hint.textContent = '';
    hint.classList.remove('error', 'success');
    input.classList.remove('error');

    if (otp.length !== 6) {
        hint.textContent = '请输入 6 位验证码';
        hint.classList.add('error');
        triggerShake(input);
        return;
    }

    btn.disabled = true;
    btn.textContent = '验证中...';

    const result = await verifyOTP(currentAuthEmail, otp);

    btn.disabled = false;
    btn.textContent = '验证';

    if (!result.ok) {
        hint.textContent = result.error;
        hint.classList.add('error');
        triggerShake(input);
        return;
    }

    // 验证成功 → 切换到"已登录"界面（保持弹窗打开）
    const user = await getCurrentUser();
    justLoggedIn = true;
    showAuthStep('logged-in');
    populateLoggedInView(user);
    // ⚠️ 不自动刷新，让用户看到"已登录"界面，手动关闭后再刷新
}

/* ---- 重发 OTP ---- */
async function handleResendOtp() {
    const hint = document.getElementById('otpHint');
    hint.textContent = '重新发送中...';
    hint.classList.remove('error', 'success');

    const result = await sendOTP(currentAuthEmail);
    if (result.ok) {
        hint.innerHTML = '✅ 已重新发送 · 本地测试：<strong>123456</strong>';
        hint.classList.add('success');
    } else {
        hint.textContent = result.error || '发送失败';
        hint.classList.add('error');
    }
}

/* ---- Google 登录 ---- */
/* ⚠️ 本地测试模式：模拟登录
 *  正式上线时改成：
 *    chrome.tabs.create({ url: 'https://dewsecure.com/login?provider=google&from=extension' });
 */
async function handleGoogleLogin() {
    const btn = document.getElementById('googleLoginBtn');
    const hint = document.getElementById('emailHint');
    const originalText = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = '⏳ 连接 Google...';
    hint.textContent = '';
    hint.classList.remove('error', 'success');

    // 模拟 OAuth 授权延迟
    await new Promise((r) => setTimeout(r, 1200));

    // 模拟 Google 返回的邮箱
    const mockEmail = 'google.user@gmail.com';

    // 调用 authManager 登录（后端接入后，这一步会由真实 OAuth 回调触发）
    const { loginUser } = await import('../src/authManager.js');
    await loginUser(mockEmail);

    btn.disabled = false;
    btn.innerHTML = originalText;

    // 显示已登录（保持弹窗打开）
    const user = await getCurrentUser();
    justLoggedIn = true;
    showAuthStep('logged-in');
    populateLoggedInView(user);
}

/* ---- 填充已登录视图 ---- */
function populateLoggedInView(user) {
    document.getElementById('loggedInEmail').textContent = user.email;
    document.getElementById('accountTier').textContent =
        user.tier === 'premium' ? '⭐ 高级版' : '免费版';
    document.getElementById('accountTier').classList.toggle('free', user.tier !== 'premium');
    document.getElementById('accountExpiry').textContent = formatDate(user.expiresAt);
    document.getElementById('accountDevices').textContent = '1 / 3';
}

/* ---- 登出 ---- */
/* ---- 退出登录（自定义毛玻璃确认弹窗） ---- */
function openConfirmModal() {
    document.getElementById('confirmModal').classList.remove('hidden');
}

function closeConfirmModal() {
    document.getElementById('confirmModal').classList.add('hidden');
}

async function handleLogoutConfirmed() {
    closeConfirmModal();
    await logoutUser();
    closeAuthModal();
    setTimeout(() => window.location.reload(), 200);
}

/* ============================================================
   设置弹窗逻辑
   ============================================================ */

const LANG_KEY = 'dewsecure_language';

async function openSettingsModal() {
    document.getElementById('settingsModal').classList.remove('hidden');

    const { [LANG_KEY]: savedLang = 'zh-CN' } = await chrome.storage.local.get(LANG_KEY);
    document.querySelectorAll('.lang-option').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.lang === savedLang);
    });
}

function closeSettingsModal() {
    document.getElementById('settingsModal').classList.add('hidden');
}

async function handleLanguageSelect(btn) {
    const lang = btn.dataset.lang;

    document.querySelectorAll('.lang-option').forEach((b) => {
        b.classList.toggle('active', b === btn);
    });

    await chrome.storage.local.set({ [LANG_KEY]: lang });
    console.log('🌐 语言已切换为:', lang);
}

init().catch(console.error);
