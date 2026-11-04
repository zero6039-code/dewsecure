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
import { updateDNRRulesets } from './background/messageHandler.js';
import { initSecurityListeners } from './background/security.js';
import { initStatsListener } from './background/stats.js';
import { restoreSessionRules } from './background/dnr.js';
import { runAICheck } from './background/ai.js';
import { detectBrandPhishing } from './background/phishingDetector.js';
import { handleMessage } from './background/messageHandler.js';
import { updateThreatIntel } from './background/threatIntel.js';
import { HARD_SAFE_DOMAINS } from './background/aiConfig.js';

// 🚀 AI 已改为纯 JS 推理，无需创建 Offscreen 页面

// 初始化
initSettings().then(async () => {
    // 🛡️ 修复：冷启动时同步 DNR 规则状态，防止重启浏览器后规则又默认开启
    const s = await getSettings();
    updateDNRRulesets(s.dnrEnabled, s.blockTrackers);
});
chrome.action.setBadgeText({ text: '' });
initSecurityListeners();
initStatsListener();
restoreSessionRules();

// 🚀 性能优化：合并消息分发，消除多个监听器竞争和无效的 return true
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        // --- 1. AI 异步处理 ---
        case 'THIRD_PARTY_HOSTS':
            if (!sender.tab) return false;
            chrome.storage.local.get('dewsecure_settings').then(res => {
                const settings = res.dewsecure_settings || {};
                if (settings.aiFourEnabled === false || settings.aiEnabled === false) {
                    sendResponse({ ok: true });
                    return;
                }
                import('./background/ai.js').then(({ runAICheck }) => {
                    for (const host of message.hosts) {
                        runAICheck(host, sender.tab.id, true);
                    }
                    sendResponse({ ok: true });
                }).catch(() => sendResponse({ ok: false }));
            });
            return true; // 异步，保持信道

        case 'CHECK_URL_AI':
            runAICheck(message.url, sender?.tab?.id);
            sendResponse({ ok: true });
            return false; // 同步结束，无需 hold

        // --- 2. 登录/模型状态同步 ---
        case 'MODEL_UPDATED':
            import('./background/ai.js').then(m => m.invalidateAIModelCache()).catch(() => {});
            sendResponse({ ok: true });
            return false;

        case 'AUTH_STATE_CHANGED':
            setTimeout(updateThreatIntel, 1000);
            checkAndUpdateModel().catch(console.warn);
            (async () => {
                const user = await getCurrentUser();
                if (user && user.token) reportDeviceSilently(user.token);
            })().catch(e => console.warn(e));
            sendResponse({ ok: true });
            return false;

        // --- 3. 其余核心业务全部交由 handleMessage 处理 ---
        default:
            handleMessage(message, sender).then(sendResponse).catch(() => sendResponse({ ok: false }));
            return true; // handleMessage 是异步 Promise
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
        // 🛡️ L-3 修复：确保 payload 存在且包含合法的 token
        if (!message.payload || typeof message.payload.token !== 'string') {
            console.warn('❌ [拦截] 非法 SYNC_AUTH 载荷');
            return false;
        }
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
        runAICheck(tab.url, tabId);
    }
});

// 🌟 P-01 硬核钓鱼拦截：在页面加载前抢占并重定向
// 🔒 H1 修复：使用扩展自身 URL 前缀判断，不再用子串匹配（防止 ?warning.html / #warning.html 绕过）
const EXT_ORIGIN = chrome.runtime.getURL('');
const isOwnWarningPage = (u) => {
    if (typeof u !== 'string') return false;
    // 基于扩展 origin 匹配，兼容 use_dynamic_url 动态改写
    return u.startsWith(EXT_ORIGIN) && u.includes('/warning.html');
};

if (chrome.webNavigation && chrome.webNavigation.onBeforeNavigate) {
    const blockedTabs = new Map(); // 🔒 M6 修复：改用 Map 记录 tabId -> 上次拦截的 URL

    chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
        // 如果是警告页，记录一下真实被拦截的 URL，供 warning.js 使用
        if (isOwnWarningPage(details.url) && details.frameId === 0) {
            // 🛡️ 核弹级防线：强行拦截对核心大厂的误跳转
            try {
                const urlParams = new URL(details.url).searchParams;
                const rawDomain = urlParams.get('domain') || urlParams.get('url') || '';
                let parsedHost = null;
                try {
                    // 🛡️ L-1 修复：解析出纯净的 hostname，防止 evil.com/x.github.com 绕过
                    parsedHost = new URL(rawDomain.startsWith('http') ? rawDomain : `https://${rawDomain}`).hostname;
                } catch(e) {}

                
                
                if (parsedHost && HARD_SAFE_DOMAINS.some(d => parsedHost === d || parsedHost.endsWith('.' + d))) {
                    console.warn('🛡️ [Security] 强行拦下对核心大厂的警告页跳转，放行！', parsedHost);
                    // 强制只用提取出的 hostname 跳转，绝不带路径
                    chrome.tabs.update(details.tabId, { url: `https://${parsedHost}` });
                    return;
                }
            } catch (e) {
                console.warn('警告页参数解析失败', e);
            }

            chrome.tabs.get(details.tabId, (tab) => {
                if (tab && tab.url && !isOwnWarningPage(tab.url)) {
                    chrome.storage.local.set({ last_blocked_url: tab.url });
                }
            });
            return;
        }

        // 只拦截主框架的真实网页
        if (details.frameId !== 0 || !details.url.startsWith('http')) return;

        // 🔒 M6 修复：防循环逻辑改为比对 URL
        if (blockedTabs.has(details.tabId)) {
            const lastUrl = blockedTabs.get(details.tabId);
            if (lastUrl === details.url) {
                console.log('[DEBUG] 用户主动放行同一 URL，解除防循环:', details.url);
                blockedTabs.delete(details.tabId);
                return;
            } else {
                console.log('[DEBUG] 发现该标签页产生新恶意跳转，重新执行拦截:', details.url);
                // 继续往下走，重新拦截
            }
        }

        try {
            // 🛡️ 拦截前置检查 1：绝对放行官方与核心开发者域名（防情报误杀）
            const urlObj = new URL(details.url);
            const host = urlObj.hostname;
            
            // 🔒 H2 修复：移除 github.io / githubusercontent.com；删除 includes('zero6039') 子串豁免
            // 官方 Worker 用 zero6039.workers.dev 精确放行（点分隔，不误放 evil-zero6039.workers.dev）
            
            const isHardSafeDomain = (h) =>
                HARD_SAFE_DOMAINS.some(d => h === d || h.endsWith('.' + d));
            
            if (isHardSafeDomain(host)) {
                // 豁免核心站点，直接放行，绝不拦截
                return;
            }

            // 🛡️ 拦截前置检查 2：解析域名并检查用户白名单与临时暂停
            const { dewsecure_settings: settings } = await chrome.storage.local.get('dewsecure_settings');
            const s = settings || {};
            const matchDomain = (d) => host === d || host.endsWith('.' + d);

            if ((s.whitelist || []).some(matchDomain) || (s.tempWhitelist || []).some(matchDomain)) {
                return; // 命中白名单，绝不拦截
            }

            // 🛡️ F3 修复：只有 PRO 用户且明确开启了 phishingEnabled 才拦截
            const user = await getCurrentUser();
            const isPro = user && ['pro', 'trial', 'family', 'premium'].includes(user.tier);
            if (!isPro) { // 🔒 F3 强制拦截：非 PRO 用户绝对不允许执行钓鱼检测
                return;
            }
            if (s.phishingEnabled !== true) {
                return; 
            }

            // 🚨 执行钓鱼检测
            if (detectBrandPhishing(details.url)) {
                console.log('🚨 [Security] 检测到品牌钓鱼，执行强制拦截:', details.url);
                const warningUrl = chrome.runtime.getURL(`warning.html?url=${encodeURIComponent(details.url)}&isPro=false`);
                blockedTabs.set(details.tabId, details.url);
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

// 🛡️ 核心修复：清理 AI 之前注入且可能导致误杀的 sessionRules
chrome.declarativeNetRequest.getSessionRules().then(rules => {
    const aiRules = rules.filter(r => r.id >= 8000000);
    if (aiRules.length > 0) {
        console.warn(`[DNR] 清理了 ${aiRules.length} 条 AI 误杀历史规则，页面将恢复正常加载。`);
        chrome.declarativeNetRequest.updateSessionRules({
            removeRuleIds: aiRules.map(r => r.id)
        });
        // 同时清空可能污染的持久化缓存
        if (chrome.storage.session) {
            chrome.storage.session.remove('ai_checked_domains');
        }
    }
});

// 🛡️ 核心修复：清理 AI 之前注入且可能导致误杀的 sessionRules
chrome.declarativeNetRequest.getSessionRules().then(rules => {
    const aiRules = rules.filter(r => r.id >= 8000000);
    if (aiRules.length > 0) {
        console.warn(`[DNR] 清理了 ${aiRules.length} 条 AI 误杀历史规则，页面将恢复正常加载。`);
        chrome.declarativeNetRequest.updateSessionRules({
            removeRuleIds: aiRules.map(r => r.id)
        });
        // 同时清空可能污染的持久化缓存
        if (chrome.storage.session) {
            chrome.storage.session.remove('ai_checked_domains');
        }
    }
});

// 🌟 防线 3：全局最高优先级豁免 (防止未来任何新模块误伤官方)
// 改用 DynamicRules 并设置最高优先级，确保在 DNR 底层绝对放行
chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [999999],
    addRules: [{
        "id": 999999,
        "priority": 2147483647, // 最高优先级，碾压一切静态/动态拦截规则
        "action": { "type": "allow" }, // 改为 allow，全资源放行
        "condition": {
            "requestDomains": [
                "dewsecure.com", "api.dewsecure.com", "dewsecure-api.zero6039.workers.dev",
                "dropbox.com", "dropboxstatic.com", "dropboxusercontent.com"
            ],
            "resourceTypes": ["main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "other"]
        }
    }]
}).catch(e => console.warn('设置官方豁免失败:', e));
