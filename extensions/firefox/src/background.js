// 🔒 S-06 修复：限制 content script 读取 storage.local，保护 Token 安全
if (chrome.storage && chrome.storage.local && chrome.storage.local.setAccessLevel) {
    chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(e => {
        console.warn('⚠️ 设置 storage 访问级别失败:', e);
    });
}

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
import { detectBrandPhishing } from './background/phishingDetector.js';
import { handleMessage } from './background/messageHandler.js';
import { updateThreatIntel } from './background/threatIntel.js';

// 初始化 Offscreen (用于运行 ONNX 模型)
if (chrome.offscreen) {
    chrome.offscreen.hasDocument().then(has => {
        if (!has) {
            chrome.offscreen.createDocument({
                url: 'src/offscreen.html',
                reasons: ['WORKERS'],
                justification: 'AI Model Inference'
            }).catch(console.warn);
        }
    });
}

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

// 威胁情报同步 (URLhaus等)
setTimeout(updateThreatIntel, 3000);
chrome.alarms.create('dewsecure_threat_intel', { periodInMinutes: 1440 });
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'dewsecure_threat_intel') updateThreatIntel();
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
        // 🌟 核心修复：用户登录或状态改变时，立刻尝试拉取一次威胁情报
        setTimeout(updateThreatIntel, 1000);
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

// 🌟 P-01 修复：页面加载完成时触发 AI 检测
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
        runAICheck(tab.url);
    }
});

// 🌟 P-01 硬核钓鱼拦截：在页面加载前抢占并重定向
if (chrome.webNavigation && chrome.webNavigation.onBeforeNavigate) {
    const blockedTabs = new Set();

    chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
        // 如果是警告页，记录一下真实被拦截的 URL，供 warning.js 使用
        if (details.url.includes('warning.html') && details.frameId === 0) {
            chrome.tabs.get(details.tabId, (tab) => {
                if (tab && tab.url && !tab.url.includes('warning.html')) {
                    chrome.storage.local.set({ last_blocked_url: tab.url });
                }
            });
            return;
        }

        // 只拦截主框架的真实网页
        if (details.frameId !== 0 || !details.url.startsWith('http')) return;

        // 🔒 防循环
        if (blockedTabs.has(details.tabId)) {
            console.log('[DEBUG] 标签页已拦截过，本次放行:', details.tabId);
            blockedTabs.delete(details.tabId);
            return;
        }

        try {
            // 🛡️ 拦截前置检查 1：绝对放行我们自己的官网
            const urlObj = new URL(details.url);
            const host = urlObj.hostname;
            if (host === 'dewsecure.com' || host.endsWith('.dewsecure.com') || host.includes('zero6039')) {
                return;
            }

            // 🛡️ 拦截前置检查 2：解析域名并检查用户白名单与临时暂停
            const { dewsecure_settings: settings } = await chrome.storage.local.get('dewsecure_settings');
            const s = settings || {};
            const matchDomain = (d) => host === d || host.endsWith('.' + d);

            if ((s.whitelist || []).some(matchDomain) || (s.tempWhitelist || []).some(matchDomain)) {
                return; // 命中白名单，绝不拦截
            }

            // 🛡️ 拦截前置检查 3：彻底修复开关失效问题！
            // 因为 UI 里的 phishingEnabled 可能没写进 storage（undefined），导致一直拦截。
            // 只要不是明确的 true（比如是 false 或者 undefined），就默认不拦截！
            if (s.phishingEnabled !== true && s.aiEnabled !== true) {
                console.log('🛡️ [Security] 检测开关未开启，放行该网页:', host);
                return; 
            }

            // 🚨 执行钓鱼检测
            if (detectBrandPhishing(details.url)) {
                console.log('🚨 [Security] 检测到品牌钓鱼，执行强制拦截:', details.url);
                const warningUrl = chrome.runtime.getURL(`warning.html?url=${encodeURIComponent(details.url)}&isPro=false`);
                blockedTabs.add(details.tabId);
                chrome.tabs.update(details.tabId, { url: warningUrl });
            }
        } catch (e) {
            console.warn('[Security] 拦截逻辑异常:', e);
        }
    });
} // 🌟 这里补上了缺失的大括号！

// 强制清理可能误伤的 DNR 规则
chrome.declarativeNetRequest.getDynamicRules().then(rules => {
    const badRules = rules.filter(r => JSON.stringify(r).includes('dewsecure'));
    if (badRules.length > 0) {
        chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: badRules.map(r => r.id)
        });
    }
});

// 🌟 防线 3：全局最高优先级豁免 (防止未来任何新模块误伤官方)
chrome.declarativeNetRequest.updateSessionRules({
    addRules: [{
        "id": 999999,
        "priority": 1000000, // 一百万级碾压，高于任何 AI (10000) 或暂停 (100000) 规则
        "action": { "type": "allow" },
        "condition": {
            "requestDomains": ["dewsecure.com", "dewsecure-api.zero6039.workers.dev"],
            "resourceTypes": ["main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "other"]
        }
    }]
}).catch(e => console.warn('设置官方豁免失败:', e));
