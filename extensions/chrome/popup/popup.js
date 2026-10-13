/**
 * DewSecure Popup
 */

async function init() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // 获取统计和设置
    const { stats, settings } = await chrome.runtime.sendMessage({ type: 'GET_STATS' });

    // 更新 UI
    updateStats(stats);
    updateLimit(settings);
    updateToggles(settings);

    // 检查当前网站是否在白名单
    if (tab?.url) {
        try {
            const host = new URL(tab.url).hostname;
            const isWhitelisted = settings.whitelist.some((d) => host.endsWith(d));
            updateSiteButton(isWhitelisted, host);
        } catch (e) {
            // 忽略无效 URL
        }
    }

    // 绑定事件
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
    const limit = settings.dailyLimit || 100;
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
    // AI 开关
    document.getElementById('aiToggle').addEventListener('change', async (e) => {
        settings.aiEnabled = e.target.checked;
        await chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings });
    });

    // 追踪器开关
    document.getElementById('trackerToggle').addEventListener('change', async (e) => {
        settings.blockTrackers = e.target.checked;
        await chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings });
    });

    // 反反拦截开关
    document.getElementById('antiBypassToggle').addEventListener('change', async (e) => {
        settings.antiBypassEnabled = e.target.checked;
        await chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings });
    });

    // 网站白名单切换
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

    // 升级按钮
    document.getElementById('upgradeBtn').addEventListener('click', () => {
        chrome.tabs.create({ url: 'https://dewsecure.com/upgrade' });
    });

    // 设置链接
    document.getElementById('settingsLink').addEventListener('click', (e) => {
        e.preventDefault();
        chrome.runtime.openOptionsPage();
    });
}

init().catch(console.error);
