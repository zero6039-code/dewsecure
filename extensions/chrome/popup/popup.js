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
    document.getElementById('loginBtn').addEventListener('click', () => {
        chrome.tabs.create({ url: 'https://dewsecure.com/login' });
    });

    document.getElementById('upgradeBtn').addEventListener('click', () => {
        chrome.tabs.create({ url: 'https://dewsecure.com/pricing' });
    });

    document.getElementById('settingsLink').addEventListener('click', (e) => {
        e.preventDefault();
        chrome.runtime.openOptionsPage();
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
    const buttons = document.querySelectorAll('.btn-feedback');
    buttons.forEach((b) => (b.disabled = true));

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
            hint.textContent = '✅ 感谢反馈！已帮助改进 AI 模型';
            hint.classList.add('success');
            hint.classList.remove('error');
        } else {
            hint.textContent = '⚠️ 反馈失败，请稍后重试';
            hint.classList.add('error');
            hint.classList.remove('success');
        }
    } catch (e) {
        hint.textContent = '⚠️ 反馈失败: ' + e.message;
        hint.classList.add('error');
    } finally {
        setTimeout(() => {
            buttons.forEach((b) => (b.disabled = false));
        }, 3000);
    }
}

init().catch(console.error);
