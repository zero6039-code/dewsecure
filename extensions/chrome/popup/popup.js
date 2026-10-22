// ==========================================
// 📁 popup.js (主入口)
// 职责：只负责初始化、读取 storage 数据、并调用各个模块。
// 彻底分离了 UI 逻辑、认证逻辑、账户逻辑。
// ==========================================

import { getCurrentUser } from '../src/authManager.js';
import { updateStats, updateSiteSwitch, disableSiteSwitch, switchView } from './views.js';
import { initAuthUI } from './auth-ui.js';
import { initAccountUI, renderLoggedInView } from './account-ui.js';


// ==========================================
// 🌟 抽离出独立的当前站点刷新函数
// ==========================================

// ==========================================
// 🌟 抽离出独立的当前站点刷新函数
// ==========================================
async function updateSiteInfo() {
    try {
        // 使用 lastFocusedWindow 提高在侧边栏场景下的命中率
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        console.log("🔄 正在抓取当前活动标签页:", tab?.url);

        if (tab?.url && /^https?:/.test(tab.url)) {
            const host = new URL(tab.url).hostname;
            console.log("✅ 解析出域名:", host);

            const { dewsecure_settings: settings } = await chrome.storage.local.get('dewsecure_settings');
            const finalSettings = settings || {};
            const matchDomain = (d) => host === d || host.endsWith('.' + d);
            const isWhitelisted = (finalSettings.whitelist || []).some(matchDomain);
            const isTempWhitelisted = (finalSettings.tempWhitelist || []).some(matchDomain);
            
            updateSiteSwitch(!isWhitelisted && !isTempWhitelisted, host);
        } else {
            console.log("⚠️ 当前标签页不是 http/https，或者 URL 为空");
            disableSiteSwitch();
        }
    } catch (e) {
        console.error("❌ updateSiteInfo 执行出错:", e);
        disableSiteSwitch();
    }
}


async function init() {
    // 1. 初始化独立的 UI 模块
    initAuthUI();
    initAccountUI();

    // 2. 读取数据
    const { dewsecure_stats: stats, dewsecure_settings: settings } = await chrome.storage.local.get(['dewsecure_stats', 'dewsecure_settings']);
    const finalSettings = settings || {};
    
    
    const currentUser = await getCurrentUser();



    // 3. 渲染主视图数据
    updateStats(stats);
    
    // 4. 渲染站点状态
    await updateSiteInfo();

    // 5. 更新登录按钮状态
    const loginText = document.getElementById('loginBtnText');
    if (loginText) loginText.textContent = currentUser ? '查看状态' : '登录';

    // 6. 绑定其他杂项事件（日志视图、站点开关、反馈等）
    bindMiscEvents(finalSettings);
}

function bindMiscEvents(settings) {
    // 日志卡片点击
    document.getElementById('cardToday')?.addEventListener('click', () => switchView('logsView'));
    document.getElementById('backFromLogs')?.addEventListener('click', () => switchView('mainView'));
    document.getElementById('cardTotal')?.addEventListener('click', () => switchView('statsView'));
    document.getElementById('backFromStats')?.addEventListener('click', () => switchView('mainView'));

    // 站点开关
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

    // 登录按钮点击打开弹窗
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

    // 关闭弹窗
    document.getElementById('modalClose')?.addEventListener('click', () => {
        document.getElementById('authModal').classList.add('hidden');
        // 如果刚刚登录成功，关闭弹窗后刷新主界面状态
        import('../src/authManager.js').then(({ getCurrentUser }) => {
            getCurrentUser().then(user => {
                if (user && document.getElementById('loginBtnText').textContent === '登录') {
                    window.location.reload();
                }
            });
        });
    });
    document.getElementById('authModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'authModal') {
            e.target.classList.add('hidden');
            import('../src/authManager.js').then(({ getCurrentUser }) => {
                getCurrentUser().then(user => {
                    if (user && document.getElementById('loginBtnText').textContent === '登录') {
                        window.location.reload();
                    }
                });
            });
        }
    });
}

// 启动
init().catch(console.error);

// ==========================================
// 🌟 实时监听标签页切换，刷新 Side Panel UI
// ==========================================

// ==========================================
// 🌟 实时监听标签页切换，刷新 Side Panel UI
// ==========================================
chrome.tabs.onActivated.addListener(() => {
    console.log("🔄 检测到标签页切换 (onActivated)");
    updateSiteInfo();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // 只在页面加载完成或 URL 改变时触发
    if (changeInfo.status === 'complete' || changeInfo.url) {
        console.log("🔄 检测到网页加载/URL变更 (onUpdated)");
        updateSiteInfo();
    }
});

chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId !== chrome.windows.WINDOW_ID_NONE) {
        console.log("🔄 检测到窗口焦点切换 (onFocusChanged)");
        updateSiteInfo();
    }
});
