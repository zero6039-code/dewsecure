import { getCurrentUser } from '../../src/authManager.js';
import { renderLoggedInView } from '../account-ui.js';
import { updateSiteInfo, updateUserUI, renderTodayLogs, renderTotalStats } from './ui-render.js';
import { updateSiteSwitch, switchView } from '../views.js';

// 🔒 毛玻璃 Toast 提示组件
function showGlassToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
        background: rgba(30, 30, 30, 0.75); color: #fff; padding: 12px 24px;
        border-radius: 12px; font-size: 14px; font-weight: 500; z-index: 999999;
        backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3); border: 1px solid rgba(255, 255, 255, 0.1);
        opacity: 0; transition: opacity 0.3s ease, transform 0.3s ease;
        pointer-events: none; text-align: center; max-width: 80%; word-wrap: break-word;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translate(-50%, 5px)'; });
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translate(-50%, 0)'; setTimeout(() => toast.remove(), 300); }, 3000);
}

export function bindMiscEvents() {

    // ==========================================
    // 🛡️ 白名单渲染与交互逻辑（极致修复版）
    // ==========================================
    const renderWhitelist = async (list) => {
        // 如果没传 list，主动去后台请求最新数据（触发云端拉取）
        if (!list) {
            chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (res) => {
                if (res && res.whitelist) {
                    renderWhitelist(res.whitelist); // 拿到最新数据后重新渲染
                }
            });
            // 先用本地兜底显示，防止闪烁
            const { dewsecure_settings: s } = await chrome.storage.local.get('dewsecure_settings');
            list = s?.whitelist || [];
        }

        const container = document.getElementById('whitelistList');
        if (!container) return;

        if (list.length === 0) {
            container.innerHTML = `<div data-i18n="settings_wl_empty" style="text-align:center;color:#9ca3af;font-size:12px;padding: 20px 0;">暂无白名单</div>`;
            if (window.applyI18n) window.applyI18n();
            return;
        }

        container.innerHTML = list.map(domain => `
            <div class="whitelist-item" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: rgba(255,255,255,0.6); border-radius: 8px; border: 1px solid rgba(0,0,0,0.05); margin-bottom: 8px;">
                <span style="font-size: 13px; color: #1c1c1e; font-weight: 500;">${window.escapeHTML ? window.escapeHTML(domain) : domain}</span>
                <button class="btn-remove-wl" data-domain="${domain}" style="background: transparent; border: none; color: #F0603E; cursor: pointer; font-size: 14px; font-weight: bold; padding: 4px;">✕</button>
            </div>
        `).join('');

        // 绑定删除按钮
        container.querySelectorAll('.btn-remove-wl').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const domain = e.target.getAttribute('data-domain');
                if (!domain) return;
                chrome.runtime.sendMessage({ type: 'REMOVE_WHITELIST', domain }, () => {
                    renderWhitelist(); // 重新从后台请求最新数据
                });
            });
        });
    };

    // 首次进入设置页时渲染
    renderWhitelist();
    window.refreshWhitelistUI = renderWhitelist;

    // 监听添加按钮
    document.getElementById('addWhitelistBtn')?.addEventListener('click', async () => {
        const input = document.getElementById('whitelistInput');
        const domain = input.value.trim().toLowerCase();
        if (!domain) return;

        chrome.runtime.sendMessage({ type: 'ADD_WHITELIST', domain }, (res) => {
            if (res && res.ok) {
                input.value = '';
                renderWhitelist(); // 重新从后台请求最新数据
            } else {
                alert('添加失败，请检查域名格式');
            }
        });
    });

    // 监听回车键添加
    document.getElementById('whitelistInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('addWhitelistBtn')?.click();
        }
    });

    // Setting 独立页面跳转
    document.getElementById('settingsLink')?.addEventListener('click', (e) => {
        e.preventDefault();
        switchView('settingsView');
        renderWhitelist(); // 🚀 每次打开设置页时，强制拉取一次云端数据！
    });
    document.getElementById('backFromSettings')?.addEventListener('click', () => {
        switchView('mainView');
    });

    // 侧边栏图标切换
    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.settings-tab').forEach(el => el.classList.remove('active'));
            tab.classList.add('active');

            document.querySelectorAll('.settings-pane').forEach(el => el.classList.remove('active'));
            const target = document.getElementById(tab.dataset.target);
            if (target) target.classList.add('active');
            
            // 🚀 如果切换到白名单 tab，强制刷新一次
            if (tab.dataset.target === 'tabWhitelist') {
                renderWhitelist();
            }
        });
    });

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

    // 设置开关绑定逻辑
    const toggleIdMap = {
        'dnrToggle': 'dnrEnabled', 'antiHijackToggle': 'antiHijackEnabled',
        'phishingToggle': 'phishingEnabled', 'intelToggle': 'intelEnabled', 'aiFourToggle': 'aiFourEnabled',
        'trackerToggle': 'blockTrackers', 'antiBypassToggle': 'antiBypassEnabled',
        'cookieToggle': 'hideCookieNotices', 'placeholderToggle': 'hideAdPlaceholders',
        'socialToggle': 'blockSocialTrackers'
    };

    const PRO_ONLY_TOGGLES = ['phishingEnabled', 'intelEnabled', 'aiFourEnabled', 'blockSocialTrackers'];

    Object.keys(toggleIdMap).forEach(id => {
        document.getElementById(id)?.addEventListener('change', async (e) => {
            const settingKey = toggleIdMap[id];
            const isChecked = e.target.checked;

            if (PRO_ONLY_TOGGLES.includes(settingKey)) {
                const user = await getCurrentUser();
                const isPro = user && ['pro', 'trial', 'family', 'premium'].includes(user.tier);
                if (!isPro && isChecked) {
                    e.target.checked = false;
                    if (window.showUpgradeModal) {
                        window.showUpgradeModal();
                    } else {
                        document.getElementById('upgradeBtn')?.click();
                    }
                    return;
                }
            }

            const { dewsecure_settings: s } = await chrome.storage.local.get('dewsecure_settings');
            const newSettings = s || {};
            newSettings[settingKey] = isChecked;
            await chrome.storage.local.set({ dewsecure_settings: newSettings });

            chrome.runtime.sendMessage({ type: 'UPDATE_SETTING_KEY', key: settingKey, value: isChecked });
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
                        setTimeout(() => {
                            chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
                                if (tabs[0]?.id) chrome.tabs.reload(tabs[0].id, { bypassCache: true });
                            });
                        }, 500);
                    } else {
                        updateSiteInfo();
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
            } else {
                updateSiteInfo();
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

        let host = new URL(tab.url).hostname;

        if (tab.url.includes('warning.html')) {
            const urlParams = new URL(tab.url).searchParams;
            const realDomain = urlParams.get('domain') || urlParams.get('url');
            if (realDomain && realDomain !== 'Known Malicious Site') {
                try {
                    host = new URL(realDomain.startsWith('http') ? realDomain : `https://${realDomain}`).hostname;
                } catch(e) {
                    host = realDomain;
                }
            }
        }

        const cacheKey = `last_report_${host}_${type}`;
        const { [cacheKey]: lastTime } = await chrome.storage.local.get(cacheKey);

        const originalText = type === 'missed'
            ? (t('feedback_missed') || '😤 Missed Ad')
            : (t('feedback_false') || '😡 False Block');

        if (lastTime && Date.now() - lastTime < 24 * 60 * 60 * 1000) {
            btn.innerText = t('feedback_cooldown') || '⏳ 24h cooldown';
            setTimeout(() => {
                btn.innerText = originalText;
                btn.disabled = false;
            }, 3000);
            return;
        }

        btn.disabled = true;
        btn.innerText = t('feedback_submitting') || '⏳ Submitting...';

        chrome.runtime.sendMessage({ type: 'REPORT_FEEDBACK', feedbackType: type, domain: host }, (res) => {
            const success = res && res.ok;
            if (success) {
                chrome.storage.local.set({ [cacheKey]: Date.now() });
            }

            if (success) {
                btn.innerText = t('feedback_thanks') || '✅ Thanks!';
            } else {
                if (res && res.error && res.error.toLowerCase().includes('login')) {
                    showGlassToast(t('feedback_login_required') || 'Please log in to submit feedback.');
                    btn.innerText = originalText;
                    btn.disabled = false;
                    return;
                } else {
                    btn.innerText = t('feedback_failed') || '❌ Failed';
                }
            }

            if (success || btn.innerText !== originalText) {
                setTimeout(() => {
                    btn.innerText = originalText;
                    btn.disabled = false;
                }, 3000);
            }
        });
    }

    document.getElementById('reportMissed')?.addEventListener('click', (e) => handleFeedback(e.currentTarget, 'missed'));
    document.getElementById('reportFalse')?.addEventListener('click', (e) => handleFeedback(e.currentTarget, 'false_positive'));
}
