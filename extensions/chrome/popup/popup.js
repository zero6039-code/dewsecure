// ==========================================
// 📁 popup.js (主入口 - 终极稳定版)
// ==========================================

import { getCurrentUser } from '../src/authManager.js';
import { updateStats as _updateStats, updateSiteSwitch, disableSiteSwitch, switchView } from './views.js';
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


// 🌟 渲染今日拦截详情（合并相同域名，支持折叠展开）
async function renderTodayLogs() {
    const res = await chrome.storage.local.get('dewsecure_logs');
    const logs = Array.isArray(res.dewsecure_logs) ? res.dewsecure_logs : [];
    const todayStr = new Date().toDateString();
    const todayLogs = logs.filter(l => l.date === todayStr);

    const badge = document.getElementById('logCountBadge');
    if (badge) badge.textContent = `${todayLogs.length} 条`;

    const list = document.getElementById('logsList');
    if (!list) return;

    if (todayLogs.length === 0) {
        list.innerHTML = `<div style="text-align: center; color: #9ca3af; font-size: 12px; padding: 20px;">${window.t('logs_empty') || '暂无拦截记录'}</div>`;
        return;
    }

    const grouped = {};
    todayLogs.forEach(log => {
        if (!grouped[log.domain]) grouped[log.domain] = [];
        grouped[log.domain].push(log);
    });

    const sortedDomains = Object.keys(grouped).map(domain => ({
        domain: domain,
        count: grouped[domain].length,
        records: grouped[domain].reverse()
    })).sort((a, b) => b.count - a.count);

    list.innerHTML = sortedDomains.map((item) => {
        const firstRecord = item.records[0];
        const time = new Date(firstRecord.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const innerHTML = item.records.map(r => {
            const rTime = new Date(r.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return `<div style="display: flex; justify-content: space-between; padding: 6px 10px; font-size: 11px; color: #6b7280; border-bottom: 1px solid rgba(0,0,0,0.05);">
                <span>${r.url || '未知路径'}</span>
                <span>${rTime}</span>
            </div>`;
        }).join('');

        return `
        <details class="hover-card" style="background: rgba(255,255,255,0.6); border-radius: 8px; margin-bottom: 8px; overflow: hidden;">
            <summary style="display: flex; justify-content: space-between; align-items: center; padding: 10px; outline: none; list-style: none;">
                <div style="flex: 1; overflow: hidden;">
                    <div style="font-weight: 600; font-size: 13px; color: #1c1c1e; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.domain}</div>
                    <div style="font-size: 11px; color: #6b7280;">${firstRecord.type}</div>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 12px; font-weight: bold; color: #3b82f6; background: rgba(59,130,246,0.1); padding: 2px 8px; border-radius: 12px;">${item.count} 次</span>
                    <span style="font-size: 11px; color: #9ca3af;">${time}</span>
                </div>
            </summary>
            <div style="background: rgba(255,255,255,0.4); padding: 4px 0;">${innerHTML}</div>
        </details>`;
    }).join('');
}

// 🌟 渲染累计统计与 Top 10 域名
async function renderTotalStats() {
    const res = await chrome.storage.local.get('dewsecure_logs');
    const logs = Array.isArray(res.dewsecure_logs) ? res.dewsecure_logs : [];
    const statsRes = await chrome.storage.local.get('dewsecure_stats');
    const totalBlocked = statsRes.dewsecure_stats?.totalBlocked || logs.length;

    const totalEl = document.getElementById('totalStatsValue');
    if (totalEl) totalEl.textContent = totalBlocked;

    const domainCounts = {};
    logs.forEach(log => {
        if (log.domain && log.domain !== '未知') {
            domainCounts[log.domain] = (domainCounts[log.domain] || 0) + 1;
        }
    });

    const topDomains = Object.entries(domainCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const list = document.getElementById('topDomainsList');
    if (!list) return;

    if (topDomains.length === 0) {
        list.innerHTML = `<div style="text-align: center; color: #9ca3af; font-size: 12px; padding: 10px;">暂无数据</div>`;
        return;
    }

    list.innerHTML = topDomains.map((item, index) => {
        return `<div class="hover-card" style="display: flex; justify-content: space-between; align-items: center; padding: 10px; background: rgba(255,255,255,0.6); border-radius: 8px;">
            <div style="font-size: 13px; font-weight: 500; color: #1c1c1e;">
                <span style="color: #6b7280; margin-right: 5px;">${index + 1}</span> ${item[0]}
            </div>
            <div style="font-size: 13px; font-weight: bold; color: #58a6ff;">${item[1]}</div>
        </div>`;
    }).join('');
}


// 🌟 监听本地存储变化，实现侧边栏数据实时更新
let renderTimeout = null;
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
        // 如果统计或日志发生变化
        if (changes['dewsecure_stats'] || changes['dewsecure_logs']) {
            
            // 防抖：避免瞬间拦截几十个导致前端频繁重绘
            if (renderTimeout) clearTimeout(renderTimeout);
            renderTimeout = setTimeout(() => {
                // 1. 更新主页面的数字
                chrome.storage.local.get('dewsecure_stats').then(res => {
                    if (window.updateStats && res.dewsecure_stats) {
                        window.updateStats(res.dewsecure_stats);
                    }
                });

                // 2. 如果当前在详情页，刷新详情页
                const logsView = document.getElementById('logsView');
                if (logsView && !logsView.classList.contains('hidden')) {
                    renderTodayLogs();
                }

                // 3. 如果当前在统计页，刷新统计页
                const statsView = document.getElementById('statsView');
                if (statsView && !statsView.classList.contains('hidden')) {
                    renderTotalStats();
                }
            }, 300); // 300ms 防抖
        }
    }
});

const updateStats = (stats) => { if (typeof _updateStats === 'function') _updateStats(stats); };
window.updateStats = updateStats;

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

    // 🌟 动态获取并渲染插件版本号
    const versionSpan = document.getElementById('appVersion');
    if (versionSpan && chrome.runtime.getManifest) {
        versionSpan.textContent = 'v' + chrome.runtime.getManifest().version;
    }
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
                // 🌟 通知当前标签页动态恢复拦截
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs[0]?.id) chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_PROTECTION', enabled: true });
                });
            }
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

    // 🌟 补全：上报漏拦/误拦按钮逻辑
    // 🌟 防刷上报逻辑
    async function handleFeedback(btn, type) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url) return;
        const host = new URL(tab.url).hostname;
        
        // 检查防刷缓存 (24 小时)
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
                // 写入防刷缓存
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
