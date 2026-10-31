import { getCurrentUser, fetchUserProfile, logoutUser } from '../src/authManager.js';
import { updateStats as _updateStats } from './views.js';
import { initAuthUI } from './auth-ui.js';
import { initAccountUI, renderLoggedInView } from './account-ui.js';
import { updateSiteInfo, updateUserUI, renderTodayLogs, renderTotalStats } from './modules/ui-render.js';
import { bindMiscEvents } from './modules/events.js';
import { showDeviceLimitModal } from './modules/limit-modal.js';
import { reportDeviceSilently } from '../src/deviceManager.js';

let renderTimeout = null;
let isSyncing = false;
window._deviceLimitReached = false;
const updateStats = (stats) => { if (typeof _updateStats === 'function') _updateStats(stats); };
window.updateStats = updateStats;

window.syncUserState = async function syncUserState() {
    if (isSyncing) return; // 阻止并发
    isSyncing = true;
    
    try {
    if (window._skipNextDeviceSync) {
        window._skipNextDeviceSync = false;
        return;
    }
    let user = await getCurrentUser();
    
    if (!user) {
        // 🌟 只要没登录，立刻清理超限标志，防止幽灵拦截
        await chrome.storage.local.remove('dewsecure_device_limit_reached');
        updateUserUI(null);
        return;
    }

    // 🌟 核心修复：每次同步都去后台核实。如果是同一台设备，服务器 Trigger 会直接放行更新！
    console.log("🔄 [Popup] 正在尝试同步设备状态...");
    const reportRes = await reportDeviceSilently(user.token, true);
    
    if (reportRes && reportRes.status === 'LIMIT_EXCEEDED') {
        console.warn("🚫 [Popup] 设备数已满，强制回退 Free 并弹窗。");
        
        // 🌟 回归原始逻辑：刷新UI，隐藏登录框，弹窗，然后立即返回
        updateUserUI(null); 

        const authModal = document.getElementById('authModal');
        if (authModal) authModal.classList.add('hidden');

        const transFn = window.t || ((k) => k);
        showDeviceLimitModal(transFn);
        return; // 🛑 关键：立即终止，防止任何后续操作覆盖弹窗
    }

    // 🌟 只要不是明确超额（无论是成功、网络错误、或者是同设备心跳更新），彻底解除封印！
    console.log("✅ [Popup] 设备已就绪，解除超限锁定");
    await chrome.storage.local.remove('dewsecure_device_limit_reached');

    // 🌟 解除超限时，隐藏静态弹窗
    const glassModal = document.getElementById('glassLimitModal');
    if (glassModal) {
        glassModal.classList.add('hidden');
        glassModal.style.display = 'none';
    }

    // 🌟 强制先去云端拉取最新状态，再渲染，杜绝使用本地旧缓存造成的闪烁
    user = await fetchUserProfile();
    
    // 🔒 修复：移除强制开启用户设置的逻辑，尊重用户意愿
    
    updateUserUI(user);

    const authModal = document.getElementById('authModal');
    if (authModal && !authModal.classList.contains('hidden')) {
        if (user) {
            authModal.querySelectorAll('.auth-step').forEach(el => el.classList.toggle('hidden', el.dataset.step !== 'logged-in'));
            renderLoggedInView(user);
        } else {
            authModal.querySelectorAll('.auth-step').forEach(el => el.classList.toggle('hidden', el.dataset.step !== 'email'));
        }
    }
    } finally {
        isSyncing = false;
    }
}

async function init() {
    bindMiscEvents();
    initAuthUI();
    initAccountUI();

    const { dewsecure_stats: stats } = await chrome.storage.local.get('dewsecure_stats');
    updateStats(stats);
    await updateSiteInfo();
    
    if (window.applyI18n) window.applyI18n();
    
    // 启动时强制核实一次状态
    await window.syncUserState();

    const versionSpan = document.getElementById('appVersion');
    if (versionSpan && chrome.runtime.getManifest) {
        versionSpan.textContent = 'v' + chrome.runtime.getManifest().version;
    }
}

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
        if (changes['dewsecure_stats'] || changes['dewsecure_logs']) {
            if (renderTimeout) clearTimeout(renderTimeout);
            renderTimeout = setTimeout(() => {
                chrome.storage.local.get('dewsecure_stats').then(res => {
                    if (window.updateStats && res.dewsecure_stats) {
                        window.updateStats(res.dewsecure_stats);
                    }
                });

                const logsView = document.getElementById('logsView');
                if (logsView && !logsView.classList.contains('hidden')) renderTodayLogs();

                const statsView = document.getElementById('statsView');
                if (statsView && !statsView.classList.contains('hidden')) renderTotalStats();
            }, 300);
        }

        if (changes['dewsecure_user']) {
            if (!window._deviceLimitReached) {
                window.syncUserState();
            }
        }

        // 🔒 当后台保存设置后，实时同步给 UI，且不触发 change 事件
        if (changes['dewsecure_settings']) {
            const newSettings = changes['dewsecure_settings'].newValue || {};
            const oldSettings = changes['dewsecure_settings'].oldValue || {};
            const toggleMap = {
                'dnrToggle': 'dnrEnabled', 'antiHijackToggle': 'antiHijackEnabled',
                'phishingToggle': 'phishingEnabled', 'intelToggle': 'intelEnabled', 'aiFourToggle': 'aiFourEnabled',
                'trackerToggle': 'blockTrackers', 'antiBypassToggle': 'antiBypassEnabled',
                'cookieToggle': 'hideCookieNotices', 'placeholderToggle': 'hideAdPlaceholders',
                'socialToggle': 'blockSocialTrackers'
            };
            // 🌟 绝对解耦：只有值真正发生改变的 key，才去更新 UI。绝不误伤其他开关！
            for (const [id, key] of Object.entries(toggleMap)) {
                if (newSettings[key] !== oldSettings[key]) {
                    const el = document.getElementById(id);
                    if (el && !el.disabled) {
                        el.checked = newSettings[key] !== false;
                    }
                }
            }
        }
    }
});

init().catch(console.error);

chrome.tabs.onActivated.addListener(() => updateSiteInfo());
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'complete' || changeInfo.url) updateSiteInfo();
});
chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId !== chrome.windows.WINDOW_ID_NONE) {
        updateSiteInfo();
        // 🔒 移除 syncUserState()，防止高频网络请求导致 UI 覆盖
    }
});

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'AUTH_STATE_CHANGED') {
        window.syncUserState();
    }
});
