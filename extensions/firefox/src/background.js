// 🌟 动态适配 Chrome 与 Edge 的 Side Panel
if (typeof chrome !== 'undefined' && chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.warn);
}

import { checkAndUpdateModel } from './modelManager.js';
import { reportDeviceSilently } from './deviceManager.js';
import { saveExternalAuth, logoutUser, getCurrentUser } from './authManager.js';

import { initSettings, getSettings, SETTINGS_KEY } from './background/settings.js';
import { initSecurityListeners } from './background/security.js';
import { initStatsListener } from './background/stats.js';
import { restoreSessionRules } from './background/dnr.js';
import { runAICheck } from './background/ai.js';
import { handleMessage } from './background/messageHandler.js';

// 初始化
initSettings();
chrome.action.setBadgeText({ text: '' });
initSecurityListeners();
initStatsListener();
restoreSessionRules();

// 消息中心
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender).then(sendResponse);
    return true;
});

// AI 通信
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'CHECK_URL_AI') {
        runAICheck(msg.url);
        sendResponse({ ok: true });
        return true;
    }
});

// 模型同步
setTimeout(() => { checkAndUpdateModel().catch(console.warn); }, 5000);
chrome.alarms.create('dewsecure_model_update', { periodInMinutes: 1440 });
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'dewsecure_model_update') checkAndUpdateModel().catch(console.warn);
});

// 登录/登出监听
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'AUTH_STATE_CHANGED') {
        checkAndUpdateModel().catch(console.warn);
        (async () => {
            const user = await getCurrentUser();
            if (user && user.token) reportDeviceSilently(user.token);
        })().catch(e => console.warn(e));
        sendResponse({ ok: true });
        return true;
    }
});

// 🔒 S-01: 外部消息来源白名单（生产域名）
const ALLOWED_EXTERNAL_ORIGINS = new Set([
    'https://dewsecure.com',
    'https://www.dewsecure.com',
    'http://localhost:8888',
    'http://127.0.0.1:8888'
]);

function isTrustedExternalSender(sender) {
    if (!sender) return false;
    if (typeof sender.origin === 'string' && sender.origin) {
        return ALLOWED_EXTERNAL_ORIGINS.has(sender.origin);
    }
    if (typeof sender.url === 'string' && sender.url) {
        try { return ALLOWED_EXTERNAL_ORIGINS.has(new URL(sender.url).origin); }
        catch { return false; }
    }
    return false;
}

// 外部通信
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    console.log('🚨 [外部请求] 收到:', message.type, '来源:', sender?.origin || sender?.url);
    if (!isTrustedExternalSender(sender)) {
        console.warn('❌ [拦截] 来源不合法，已阻断！');
        return false;
    }
    if (message.type === 'SYNC_AUTH') {
        saveExternalAuth(message.payload).then(res => sendResponse({ ok: res.ok }));
        return true;
    }
    if (message.type === 'LOGOUT') {
        logoutUser().then(() => sendResponse({ ok: true }));
        return true;
    }
    // 🌟 接收网页端的设备解绑通知，立刻广播给侧边栏去刷新并重新抢占坑位
    if (message.type === 'REFRESH_DEVICES') {
        chrome.runtime.sendMessage({ type: 'AUTH_STATE_CHANGED' }).catch(() => {});
        // 强制再次上报当前设备（此时如果网页端腾出了空位，这里就能插进去了）
        (async () => {
            const user = await getCurrentUser();
            if (user && user.token) {
                reportDeviceSilently(user.token, true);
            }
        })().catch(() => {});
        sendResponse({ ok: true });
        return true;
    }
});

// 启动强制设备上报
(async () => {
    const user = await getCurrentUser();
    if (user && user.token) {
        await chrome.storage.local.remove('dewsecure_last_device_report');
        reportDeviceSilently(user.token).catch(console.warn);
    }
})();

// 🌟 Firefox 侧边栏自动打开逻辑（加了严格判断）
if (typeof chrome !== 'undefined' && chrome.sidebarAction && chrome.action && chrome.action.onClicked) {
    chrome.action.onClicked.addListener(() => {
        if (chrome.sidebarAction.open) {
            chrome.sidebarAction.open();
        }
    });
}
