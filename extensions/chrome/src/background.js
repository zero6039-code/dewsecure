if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
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
        import('./authManager.js').then(async ({ getCurrentUser }) => {
            const user = await getCurrentUser();
            if (user && user.token) reportDeviceSilently(user.token);
        }).catch(e => console.warn(e));
        sendResponse({ ok: true });
        return true;
    }
});

// 外部通信
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    if (message.type === 'SYNC_AUTH') {
        saveExternalAuth(message.payload).then(res => sendResponse({ ok: res.ok }));
        return true;
    }
    if (message.type === 'LOGOUT') {
        logoutUser().then(() => sendResponse({ ok: true }));
        return true;
    }
});

// 启动强制设备上报
import('./authManager.js').then(async ({ getCurrentUser }) => {
    const user = await getCurrentUser();
    if (user && user.token) {
        await chrome.storage.local.remove('dewsecure_last_device_report');
        reportDeviceSilently(user.token).catch(console.warn);
    }
});
