// ==========================================
// 📁 popup.js (主入口 - 终极稳定版)
// ==========================================

import { getCurrentUser } from '../src/authManager.js';
import { updateStats, updateSiteSwitch, disableSiteSwitch, switchView } from './views.js';
import { initAuthUI } from './auth-ui.js';
import { initAccountUI, renderLoggedInView } from './account-ui.js';

let siteInfoReqId = 0;
async function updateSiteInfo() {
    const currentReqId = ++siteInfoReqId;
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.url && /^https?:/.test(tab.url)) {
            const host = new URL(tab.url).hostname;
            const { dewsecure_settings: settings } = await chrome.storage.local.get('dewsecure_settings');
            const finalSettings = settings || {};
            const matchDomain = (d) => host === d || host.endsWith('.' + d);
            const isWhitelisted = (finalSettings.whitelist || []).some(matchDomain);
            const isTempWhitelisted = (finalSettings.tempWhitelist || []).some(matchDomain);
            
            if (currentReqId !== siteInfoReqId) return; // 🌟 竞态守卫
            updateSiteSwitch(!isWhitelisted && !isTempWhitelisted, host);
            document.getElementById('siteDomain').textContent = host;
            document.getElementById('siteDomain').removeAttribute('data-i18n'); // 有真实域名时，移除 i18n 标记防止被覆盖
        } else {
            if (currentReqId !== siteInfoReqId) return;
            disableSiteSwitch();
            document.getElementById('siteDomain').setAttribute('data-i18n', 'site_this');
            document.getElementById('siteDomain').textContent = window.t('site_this');
        }
    } catch (e) {
        console.error("❌ updateSiteInfo 执行出错:", e);
        disableSiteSwitch();
    }
}

async function init() {
    bindMiscEvents();
    initAuthUI();
    initAccountUI();

    const { dewsecure_stats: stats } = await chrome.storage.local.get('dewsecure_stats');
    const currentUser = await getCurrentUser();

    updateStats(stats);
    await updateSiteInfo();
    
    // 初始化一次全局翻译
    if (window.applyI18n) window.applyI18n();

    // 更新登录按钮与升级按钮
    updateUserUI(currentUser);
}

async function updateUserUI(user) {
    const loginText = document.getElementById('loginBtnText');
    if (loginText) loginText.textContent = user ? window.t('btn_status') : window.t('btn_login');

    const upgradeBtn = document.getElementById('upgradeBtn');
    const upgradeText = document.querySelector('.btn-upgrade-text');
    const isPremium = user?.tier === 'pro' || user?.tier === 'family' || user?.tier === 'premium';

    if (upgradeBtn && upgradeText) {
        if (isPremium) {
            upgradeText.textContent = window.t('btn_upgraded');
            upgradeBtn.onclick = () => {
                const baseUrl = 'https://dewsecure.com/dashboard.html';
                if (user.token) {
                    const url = new URL(baseUrl);
                    url.searchParams.set('token', user.token);
                    if (user.refreshToken) url.searchParams.set('refresh', user.refreshToken);
                    chrome.tabs.create({ url: url.toString() });
                } else {
                    chrome.tabs.create({ url: baseUrl });
                }
            };
            upgradeBtn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
        } else {
            upgradeText.textContent = window.t('btn_upgrade');
            upgradeBtn.onclick = () => {
                chrome.tabs.create({ url: 'https://dewsecure.com/pricing.html' });
            };
            upgradeBtn.style.background = 'linear-gradient(135deg, #FFD966, #FFC107)';
        }
    }
}

function bindMiscEvents() {
    // 语言切换
    document.querySelectorAll('.lang-option').forEach(btn => {
        btn.addEventListener('click', () => {
            window.switchLang(btn.getAttribute('data-lang'));
        });
    });

    // 监听语言切换事件，更新动态文本
    document.addEventListener('LANG_CHANGED', async () => {
        const currentUser = await getCurrentUser();
        updateUserUI(currentUser);
        await updateSiteInfo();
        const authModal = document.getElementById('authModal');
        if (authModal && !authModal.classList.contains('hidden')) {
            if (currentUser) renderLoggedInView(currentUser);
        }
    });

    // Setting 弹窗
    document.getElementById('settingsLink')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('settingsModal')?.classList.remove('hidden');
    });
    document.getElementById('settingsClose')?.addEventListener('click', () => {
        document.getElementById('settingsModal')?.classList.add('hidden');
    });
    // 🌟 新增：点击遮罩层空白处关闭 Settings 弹窗
    document.getElementById('settingsModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'settingsModal') {
            e.target.classList.add('hidden');
        }
    });

    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.settings-tab, .settings-pane').forEach(el => el.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(tab.dataset.target)?.classList.add('active');
        });
    });

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

    document.getElementById('modalClose')?.addEventListener('click', () => {
        document.getElementById('authModal').classList.add('hidden');
        getCurrentUser().then(user => {
            if (user && document.getElementById('loginBtnText').textContent === window.t('btn_login')) {
                window.location.reload();
            }
        });
    });
    document.getElementById('authModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'authModal') {
            e.target.classList.add('hidden');
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

// 监听网页端发来的认证消息
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'AUTH_STATE_CHANGED') {
        getCurrentUser().then(user => {
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
        });
    }
});
