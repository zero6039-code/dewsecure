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
        'intelToggle': 'intelEnabled',
        'aiFourToggle': 'aiFourEnabled',
        'trackerToggle': 'blockTrackers',
        'antiBypassToggle': 'antiBypassEnabled',
        'cookieToggle': 'hideCookieNotices',
        'placeholderToggle': 'hideAdPlaceholders',
        'socialToggle': 'blockSocialTrackers'
    };
    
    // 🔒 PRO 专属的高级防御开关
    const PRO_ONLY_TOGGLES = ['phishingEnabled', 'intelEnabled', 'aiFourEnabled', 'blockSocialTrackers', 'antiBypassEnabled'];

    Object.keys(toggleIdMap).forEach(id => {
        document.getElementById(id)?.addEventListener('change', async (e) => {
            const settingKey = toggleIdMap[id];
            const isChecked = e.target.checked;

            // 如果是 PRO 专属开关，检查用户权限
            if (PRO_ONLY_TOGGLES.includes(settingKey)) {
                const user = await getCurrentUser();
                const isPro = user && user.tier !== 'free';

                if (!isPro && isChecked) {
                    // 阻止切换，回退 UI 状态
                    e.target.checked = false;
                    if (window.showUpgradeModal) window.showUpgradeModal();
                    else alert('此功能为 PRO 专属，请升级以解锁。');
                    return;
                }
            }

            // 🔒 核心修复：点击瞬间立刻写入本地缓存，防止被异步的 updateUserUI 强行覆盖
            const { dewsecure_settings: s } = await chrome.storage.local.get('dewsecure_settings');
            const newSettings = s || {};
            newSettings[settingKey] = isChecked;
            await chrome.storage.local.set({ dewsecure_settings: newSettings });

            // 然后再发送给后台去执行 DNR 等操作
            chrome.runtime.sendMessage({ 
                type: 'UPDATE_SETTING_KEY', 
                key: settingKey, 
                value: isChecked 
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
                        // 强制绕过缓存刷新，确保新规则立刻生效
                        setTimeout(() => {
                            chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
                                if (tabs[0]?.id) chrome.tabs.reload(tabs[0].id, { bypassCache: true });
                            });
                        }, 500);
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
        const t = window.t || ((k) => k);
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url) return;
        const host = new URL(tab.url).hostname;
        
        const cacheKey = `last_report_${host}_${type}`;
        const { [cacheKey]: lastTime } = await chrome.storage.local.get(cacheKey);
        
        // 🔒 核心修复：动态从语言包获取原始文字，不再依赖 dataset
        const originalText = type === 'missed' 
            ? (t('feedback_missed') || '😤 Missed Ad') 
            : (t('feedback_false') || '😡 False Block');

        // 处于 24 小时冷却期
        if (lastTime && Date.now() - lastTime < 24 * 60 * 60 * 1000) {
            btn.innerText = t('feedback_cooldown') || '⏳ 24h cooldown';
            // 3秒后恢复为对应的语言包文字
            setTimeout(() => { 
                btn.innerText = originalText; 
                btn.disabled = false; 
            }, 3000);
            return;
        }

        // 正常提交
        btn.disabled = true;
        btn.innerText = t('feedback_submitting') || '⏳ Submitting...';
        
        chrome.runtime.sendMessage({ type: 'REPORT_FEEDBACK', feedbackType: type }, (res) => {
            const success = res && res.ok;
            if (success) {
                chrome.storage.local.set({ [cacheKey]: Date.now() });
            }
            
            btn.innerText = success 
                ? (t('feedback_thanks') || '✅ Thanks!') 
                : (t('feedback_failed') || '❌ Failed');
                
            // 统一在 3 秒后还原并解除禁用
            setTimeout(() => { 
                btn.innerText = originalText; 
                btn.disabled = false; 
            }, 3000);
        });
    }

    document.getElementById('reportMissed')?.addEventListener('click', (e) => handleFeedback(e.currentTarget, 'missed'));
    document.getElementById('reportFalse')?.addEventListener('click', (e) => handleFeedback(e.currentTarget, 'false_positive'));
}
