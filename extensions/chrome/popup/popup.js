/**
 * DewSecure Popup
 */

async function init() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const { stats, settings } = await chrome.runtime.sendMessage({ type: 'GET_STATS' });

    updateStats(stats);
    updateLimit(settings);
    updateToggles(settings);

    if (tab?.url) {
        try {
            const host = new URL(tab.url).hostname;
            const isWhitelisted = settings.whitelist.some((d) => host.endsWith(d));
            updateSiteButton(isWhitelisted, host);
        } catch (e) {}
    }

    bindEvents(settings);
}

function updateStats(stats) {
    document.getElementById('todayBlocked').textContent = stats?.todayBlocked || 0;
    document.getElementById('totalBlocked').textContent = stats?.totalBlocked || 0;
}

function updateLimit(settings) {
    const limitBar = document.getElementById('limitBar');
    if (settings.subscription === 'premium') {
        limitBar.classList.add('premium');
        return;
    }

    limitBar.classList.remove('premium');
    const used = settings.dailyUsed || 0;
    const limit = settings.dailyLimit || 50;
    const percent = Math.min(100, (used / limit) * 100);

    document.getElementById('limitText').textContent = `${used} / ${limit}`;
    const fill = document.getElementById('limitFill');
    fill.style.width = `${percent}%`;
    fill.classList.toggle('warning', percent > 80);
}

function updateToggles(settings) {
    document.getElementById('aiToggle').checked = settings.aiEnabled;
    document.getElementById('trackerToggle').checked = settings.blockTrackers;
    document.getElementById('antiBypassToggle').checked = settings.antiBypassEnabled;
}

function updateSiteButton(isWhitelisted, host) {
    const btn = document.getElementById('toggleSite');
    if (isWhitelisted) {
        btn.textContent = '在此网站启用';
        btn.dataset.action = 'enable';
        document.getElementById('status').textContent = '已暂停';
        document.getElementById('status').classList.add('paused');
    } else {
        btn.textContent = '在此网站暂停';
        btn.dataset.action = 'disable';
    }
    btn.dataset.host = host;
}

function bindEvents(settings) {
    document.getElementById('aiToggle').addEventListener('change', async (e) => {
        settings.aiEnabled = e.target.checked;
        await chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings });
    });

    document.getElementById('trackerToggle').addEventListener('change', async (e) => {
        settings.blockTrackers = e.target.checked;
        await chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings });
    });

    document.getElementById('antiBypassToggle').addEventListener('change', async (e) => {
        settings.antiBypassEnabled = e.target.checked;
        await chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings });
    });

    document.getElementById('toggleSite').addEventListener('click', async (e) => {
        const btn = e.target;
        const host = btn.dataset.host;
        if (!host) return;

        if (btn.dataset.action === 'disable') {
            await chrome.runtime.sendMessage({ type: 'ADD_WHITELIST', domain: host });
            updateSiteButton(true, host);
        } else {
            await chrome.runtime.sendMessage({ type: 'REMOVE_WHITELIST', domain: host });
            updateSiteButton(false, host);
        }
    });

    document.getElementById('upgradeBtn').addEventListener('click', () => {
        chrome.tabs.create({ url: 'https://dewsecure.com/upgrade' });
    });

    document.getElementById('settingsLink').addEventListener('click', (e) => {
        e.preventDefault();
        chrome.runtime.openOptionsPage();
    });

    // ============ 用户反馈按钮 ============
    document.getElementById('reportMissed').addEventListener('click', () => {
        handleReport('missed');
    });

    document.getElementById('reportFalse').addEventListener('click', () => {
        handleReport('false_positive');
    });
}

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
