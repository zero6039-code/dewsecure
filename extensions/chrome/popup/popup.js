import { getCurrentUser, fetchUserProfile } from '../src/authManager.js';
import { updateStats as _updateStats } from './views.js';
import { initAuthUI } from './auth-ui.js';
import { initAccountUI, renderLoggedInView } from './account-ui.js';
import { updateSiteInfo, updateUserUI, renderTodayLogs, renderTotalStats } from './modules/ui-render.js';
import { bindMiscEvents } from './modules/events.js';

let renderTimeout = null;
const updateStats = (stats) => { if (typeof _updateStats === 'function') _updateStats(stats); };
window.updateStats = updateStats;

async function syncUserState() {
    let user = await getCurrentUser();
    if (user) {
        user = await fetchUserProfile();
        
        // 🌟 关键修复：如果是 Pro 用户，强制把之前免费版吃掉的状态“吐”出来恢复 true
        if (user && user.tier !== 'free') {
            let { dewsecure_settings: s } = await chrome.storage.local.get('dewsecure_settings');
            s = s || {};
            let changed = false;
            if (s.phishingEnabled === false) { s.phishingEnabled = true; changed = true; }
            if (s.aiFourEnabled === false) { s.aiFourEnabled = true; changed = true; }
            if (s.blockSocialTrackers === false) { s.blockSocialTrackers = true; changed = true; }
            if (changed) await chrome.storage.local.set({ dewsecure_settings: s });
        }
    }
    
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
}

async function init() {
    bindMiscEvents();
    initAuthUI();
    initAccountUI();

    const { dewsecure_stats: stats } = await chrome.storage.local.get('dewsecure_stats');
    updateStats(stats);
    await updateSiteInfo();
    
    if (window.applyI18n) window.applyI18n();
    
    await syncUserState();

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
            syncUserState();
        }
    }
});

init().catch(console.error);

chrome.tabs.onActivated.addListener(() => updateSiteInfo());
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'complete' || changeInfo.url) updateSiteInfo();
});
chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId !== chrome.windows.WINDOW_ID_NONE) updateSiteInfo();
});

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'AUTH_STATE_CHANGED') {
        syncUserState();
    }
});
