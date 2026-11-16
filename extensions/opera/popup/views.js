// ==========================================
// 📁 views.js
// 职责：纯视图渲染函数，不包含网络请求，只负责把数据画到页面上。
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

    switchEl.disabled = false;
    const wrap = document.getElementById('siteSwitchWrap');
    if (wrap) {
        wrap.style.opacity = '';
        wrap.style.pointerEvents = '';
    }

    if (domainEl) domainEl.textContent = host || window.t('site_this');

    switchEl.checked = isProtected;
    switchEl.dataset.host = host || '';
    switchEl.dataset.protected = isProtected ? '1' : '0';

    if (isProtected) {
        if (labelEl) labelEl.textContent = window.t('site_on');
        statusEl.textContent = window.t('status_active');
        statusEl.className = 'status-badge active';
        if (featuresCard) featuresCard.classList.remove('disabled');
    } else {
        if (labelEl) labelEl.textContent = window.t('site_off');
        statusEl.textContent = window.t('status_paused');
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
    if (document.getElementById('siteLabel')) document.getElementById('siteLabel').textContent = window.t('unsupported_page');
    const statusEl = document.getElementById('status');
    if (statusEl) {
        statusEl.textContent = window.t('status_unavailable');
        statusEl.classList.remove('active', 'paused');
    }
}

export function switchView(viewId) {
    const allViews = ['mainView', 'logsView', 'statsView', 'settingsView', 'protectView', 'savingsDetailsView'];
    allViews.forEach(id => document.getElementById(id)?.classList.add('hidden'));

    const target = document.getElementById(viewId);
    if (target) target.classList.remove('hidden');

    document.querySelectorAll('.bottom-nav-item').forEach(el => el.classList.remove('active'));
    
    let activeNavId = '';
    if (['mainView', 'logsView', 'statsView'].includes(viewId)) activeNavId = 'navHome';
    else if (viewId === 'protectView') activeNavId = 'navProtect';
    else if (viewId === 'settingsView') activeNavId = 'navSettings';

    if (activeNavId) document.getElementById(activeNavId)?.classList.add('active');
}
