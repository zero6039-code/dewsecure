// ==========================================
// 📁 views.js
// 职责：纯视图渲染函数，不包含网络请求，只负责把数据画到页面上。
// 包含：更新统计数据、更新站点开关状态、更新功能开关、日志渲染。
// ==========================================

export function updateStats(stats) {
    const todayEl = document.getElementById('todayBlocked');
    const totalEl = document.getElementById('totalBlocked');
    if (todayEl) todayEl.textContent = stats?.todayBlocked || 0;
    if (totalEl) totalEl.textContent = stats?.totalBlocked || 0;
}

export function updateSiteSwitch(isProtected, host) {
    const switchEl = document.getElementById('siteSwitch');
    const domainEl = document.getElementById('siteDomain');
    const labelEl  = document.getElementById('siteLabel');
    const statusEl = document.getElementById('status');
    const featuresCard = document.querySelector('.features-card');

    if (!switchEl || !statusEl) return;

    if (domainEl) domainEl.textContent = host || '此网站';

    switchEl.checked = isProtected;
    switchEl.dataset.host = host || '';
    switchEl.dataset.protected = isProtected ? '1' : '0';

    if (isProtected) {
        if (labelEl) labelEl.textContent = '保护已开启';
        statusEl.textContent = '保护中';
        statusEl.className = 'status-badge active';
        if (featuresCard) featuresCard.classList.remove('disabled');
    } else {
        if (labelEl) labelEl.textContent = '保护已暂停';
        statusEl.textContent = '已暂停';
        statusEl.className = 'status-badge paused';
        if (featuresCard) featuresCard.classList.add('disabled');
    }
}

export function disableSiteSwitch() {
    const switchEl = document.getElementById('siteSwitch');
    if (switchEl) {
        switchEl.disabled = true;
        switchEl.checked = false;
        switchEl.dataset.host = '';
        switchEl.dataset.protected = '0';
    }
    const wrap = document.getElementById('siteSwitchWrap');
    if (wrap) {
        wrap.style.opacity = '0.35';
        wrap.style.pointerEvents = 'none';
    }
    if (document.getElementById('siteDomain')) document.getElementById('siteDomain').textContent = '—';
    if (document.getElementById('siteLabel')) document.getElementById('siteLabel').textContent = '当前页面不支持';
    const statusEl = document.getElementById('status');
    if (statusEl) {
        statusEl.textContent = '不可用';
        statusEl.classList.remove('active', 'paused');
    }
}

export function switchView(viewId) {
    document.getElementById('mainView').classList.add('hidden');
    document.getElementById('logsView').classList.add('hidden');
    document.getElementById('statsView').classList.add('hidden');
    const target = document.getElementById(viewId);
    if (target) target.classList.remove('hidden');
}
