import { getCurrentUser } from '../../src/authManager.js';
import { renderLoggedInView } from '../account-ui.js';
import { updateSiteInfo, updateUserUI, renderTodayLogs, renderTotalStats } from './ui-render.js';
import { updateSiteSwitch, switchView } from '../views.js';

export function bindMiscEvents() {
    // 语言切换
    document.querySelectorAll('.lang-option').forEach(btn => {
        btn.addEventListener('click', () => {
            window.switchLang(btn.getAttribute('data-lang'));
        });
    });

    // 监听语言切换事件
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
    document.getElementById('settingsModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'settingsModal') e.target.classList.add('hidden');
    });

    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.settings-tab, .settings-pane').forEach(el => el.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(tab.dataset.target)?.classList.add('active');
        });
    });

    // 设置开关绑定逻辑
    const toggleIdMap = {
        'dnrToggle': 'dnrEnabled',
        'antiHijackToggle': 'antiHijackEnabled',
        'phishingToggle': 'phishingEnabled',
        'aiFourToggle': 'aiFourEnabled',
        'trackerToggle': 'blockTrackers',
        'antiBypassToggle': 'antiBypassEnabled',
        'cookieToggle': 'hideCookieNotices',
        'placeholderToggle': 'hideAdPlaceholders',
        'socialToggle': 'blockSocialTrackers'
    };
    
    Object.keys(toggleIdMap).forEach(id => {
        document.getElementById(id)?.addEventListener('change', (e) => {
            chrome.runtime.sendMessage({ 
                type: 'UPDATE_SETTING_KEY', 
                key: toggleIdMap[id], 
                value: e.target.checked 
            });
        });
    });

    document.getElementById('cardToday')?.addEventListener('click', () => {
        switchView('logsView');
        renderTodayLogs();
    });
    document.getElementById('backFromLogs')?.addEventListener('click', () => switchView('mainView'));
    
    document.getElementById('cardTotal')?.addEventListener('click', () => {
        switchView('statsView');
        renderTotalStats();
    });
    document.getElementById('backFromStats')?.addEventListener('click', () => switchView('mainView'));

    // 当前网站暂停/恢复
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
            if (res && res.ok) {
                updateSiteSwitch(true, host);
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs[0]?.id) chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_PROTECTION', enabled: true });
                });
            }
        });
    });

    // 登录相关
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

    // 🌟 移除之前的 window.location.reload() 逻辑
    document.getElementById('modalClose')?.addEventListener('click', () => {
        document.getElementById('authModal').classList.add('hidden');
    });
    document.getElementById('authModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'authModal') e.target.classList.add('hidden');
    });

    // 防刷上报
    async function handleFeedback(btn, type) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url) return;
        const host = new URL(tab.url).hostname;
        
        const cacheKey = `last_report_${host}_${type}`;
        const { [cacheKey]: lastTime } = await chrome.storage.local.get(cacheKey);
        if (lastTime && Date.now() - lastTime < 24 * 60 * 60 * 1000) {
            btn.innerText = '⏳ 已上报过，24小时内请勿重复提交';
            setTimeout(() => { btn.innerText = btn.dataset.originalText || btn.innerText; btn.disabled = false; }, 3000);
            return;
        }

        btn.disabled = true;
        btn.dataset.originalText = btn.innerText;
        btn.innerText = '⏳ 上报中...';
        
        chrome.runtime.sendMessage({ type: 'REPORT_FEEDBACK', feedbackType: type }, (res) => {
            if (res && res.ok) {
                chrome.storage.local.set({ [cacheKey]: Date.now() });
                btn.innerText = '✅ 已收到，感谢！';
                setTimeout(() => { btn.innerText = btn.dataset.originalText; btn.disabled = false; }, 3000);
            } else {
                btn.innerText = '❌ 上报失败';
                setTimeout(() => { btn.innerText = btn.dataset.originalText; btn.disabled = false; }, 3000);
            }
        });
    }

    document.getElementById('reportMissed')?.addEventListener('click', (e) => handleFeedback(e.currentTarget, 'missed'));
    document.getElementById('reportFalse')?.addEventListener('click', (e) => handleFeedback(e.currentTarget, 'false_positive'));
}
