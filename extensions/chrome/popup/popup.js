// ==========================================
// 📁 popup.js (主入口 - 终极稳定版)
// ==========================================

import { getCurrentUser } from '../src/authManager.js';
import { updateStats, updateSiteSwitch, disableSiteSwitch, switchView } from './views.js';
import { initAuthUI } from './auth-ui.js';
import { initAccountUI, renderLoggedInView } from './account-ui.js';

async function updateSiteInfo() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (tab?.url && /^https?:/.test(tab.url)) {
            const host = new URL(tab.url).hostname;
            const { dewsecure_settings: settings } = await chrome.storage.local.get('dewsecure_settings');
            const finalSettings = settings || {};
            const matchDomain = (d) => host === d || host.endsWith('.' + d);
            const isWhitelisted = (finalSettings.whitelist || []).some(matchDomain);
            const isTempWhitelisted = (finalSettings.tempWhitelist || []).some(matchDomain);
            
            updateSiteSwitch(!isWhitelisted && !isTempWhitelisted, host);
        } else {
            disableSiteSwitch();
        }
    } catch (e) {
        console.error("❌ updateSiteInfo 执行出错:", e);
        disableSiteSwitch();
    }
}

async function init() {
    // 🌟 绝对优先绑定事件，防止 await 报错导致按钮变死键！
    bindMiscEvents();

    initAuthUI();
    initAccountUI();

    const { dewsecure_stats: stats } = await chrome.storage.local.get('dewsecure_stats');
    const currentUser = await getCurrentUser();

    updateStats(stats);
    await updateSiteInfo();

    const loginText = document.getElementById('loginBtnText');
    if (loginText) loginText.textContent = currentUser ? '查看状态' : '登录';
}

function bindMiscEvents() {
    document.getElementById('cardToday')?.addEventListener('click', () => switchView('logsView'));
    document.getElementById('backFromLogs')?.addEventListener('click', () => switchView('mainView'));
    document.getElementById('cardTotal')?.addEventListener('click', () => switchView('statsView'));
    document.getElementById('backFromStats')?.addEventListener('click', () => switchView('mainView'));

    document.getElementById('siteSwitch')?.addEventListener('change', (e) => {
        const switchEl = e.target;
        const host = switchEl.dataset.host;
        if (!host) return;

        if (!switchEl.checked) {
            switchEl.checked = true;
            document.getElementById('pauseConfirmModal').classList.remove('hidden');
            document.getElementById('confirmPauseBtn').onclick = () => {
                document.getElementById('pauseConfirmModal').classList.add('hidden');
                chrome.runtime.sendMessage({ type: 'ADD_TEMP_WHITELIST', domain: host }, (res) => {
                    if (res && res.ok) {
                        switchEl.checked = false;
                        updateSiteSwitch(false, host);
                        setTimeout(() => chrome.tabs.reload(), 500);
                    }
                });
            };
            document.getElementById('cancelPauseBtn').onclick = () => {
                document.getElementById('pauseConfirmModal').classList.add('hidden');
            };
            return;
        }

        chrome.runtime.sendMessage({ type: 'REMOVE_TEMP_WHITELIST', domain: host }, (res) => {
            if (res && res.ok) updateSiteSwitch(true, host);
        });
    });

    document.getElementById('loginBtn')?.addEventListener('click', async () => {
        document.getElementById('authModal').classList.remove('hidden');
        const user = await getCurrentUser();
        if (user) {
            document.getElementById('authModal').querySelectorAll('.auth-step').forEach(el => {
                el.classList.toggle('hidden', el.dataset.step !== 'logged-in');
            });
            renderLoggedInView(user);
        } else {
            document.getElementById('authModal').querySelectorAll('.auth-step').forEach(el => {
                el.classList.toggle('hidden', el.dataset.step !== 'email');
            });
        }
    });

    // 🌟 修复：直接使用顶部静态导入的 getCurrentUser，不再使用动态 import
    document.getElementById('modalClose')?.addEventListener('click', () => {
        document.getElementById('authModal').classList.add('hidden');
        getCurrentUser().then(user => {
            if (user && document.getElementById('loginBtnText').textContent === '登录') {
                window.location.reload();
            }
        });
    });
    document.getElementById('authModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'authModal') {
            e.target.classList.add('hidden');
            getCurrentUser().then(user => {
                if (user && document.getElementById('loginBtnText').textContent === '登录') {
                    window.location.reload();
                }
            });
        }
    });
}

// 启动
init().catch(console.error);

// 监听标签页切换
chrome.tabs.onActivated.addListener(() => updateSiteInfo());
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'complete' || changeInfo.url) updateSiteInfo();
});
chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId !== chrome.windows.WINDOW_ID_NONE) updateSiteInfo();
});

// 🌟 监听网页端发来的认证消息并平滑刷新 UI
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'AUTH_STATE_CHANGED') {
        getCurrentUser().then(user => {
            const loginText = document.getElementById('loginBtnText');
            if (loginText) loginText.textContent = user ? '查看状态' : '登录';
            
            const authModal = document.getElementById('authModal');
            if (authModal && !authModal.classList.contains('hidden')) {
                if (user) {
                    authModal.querySelectorAll('.auth-step').forEach(el => {
                        el.classList.toggle('hidden', el.dataset.step !== 'logged-in');
                    });
                    renderLoggedInView(user);
                } else {
                    authModal.querySelectorAll('.auth-step').forEach(el => {
                        el.classList.toggle('hidden', el.dataset.step !== 'email');
                    });
                }
            }
        });
    }
});
