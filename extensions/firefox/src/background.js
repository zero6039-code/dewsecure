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
import { updateThreatIntel, initThreatFilter, checkThreatFilter } from './background/threatIntel.js';
import { HARD_SAFE_DOMAINS, MINING_DOMAINS } from './background/aiConfig.js';
import { initIntelReporter } from './background/intelReporter.js';
import { ensureAlarm, due } from './background/alarmHelper.js';
import { syncRules, RANGE } from './background/dnrOwner.js';

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
initThreatFilter(); // 🚀 启动时从 IndexedDB 恢复过滤器
initIntelReporter(); // 🚀 启动静默情报上报服务

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
                import('./background/ai.js').then(({ runAICheck, recordHostRef }) => {
                    for (const host of message.hosts) {
                        recordHostRef(host); // 📊 记录跨站引用次数
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


// 威胁情报同步 (URLhaus等) — N-2：闹钟按需创建 + 6 小时节流
(async () => {
    await ensureAlarm('dewsecure_threat_intel', { periodInMinutes: 1440, delayInMinutes: 1 });
    if (await due('last_intel_check', 6 * 3600e3)) {
        updateThreatIntel();
    }
})();
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'dewsecure_threat_intel') updateThreatIntel();
});

// 模型同步 — N-2：闹钟按需创建 + 6 小时节流
(async () => {
    await ensureAlarm('dewsecure_model_update', { periodInMinutes: 1440, delayInMinutes: 1 });
    if (await due('last_model_check', 6 * 3600e3)) {
        checkAndUpdateModel().catch(console.warn);
    }
})();
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

            // 🛡️ 拦截前置检查 2：解析域名并检查用户白名单与临时暂停（N-3：提前到过滤器之前）
            const { dewsecure_settings: settings } = await chrome.storage.local.get('dewsecure_settings');
            const s = settings || {};
            const matchDomain = (d) => host === d || host.endsWith('.' + d);

            if ((s.whitelist || []).some(matchDomain) || (s.tempWhitelist || []).some(matchDomain)) {
                return; // 命中白名单，绝不拦截（用户覆盖优先）
            }

            // 🚀 拦截前置检查 1.5：本地百万级威胁情报过滤器
            if (checkThreatFilter(host)) {
                console.warn('🚨 [Security] 命中本地威胁情报过滤器，强制拦截:', details.url);
                const warningUrl = chrome.runtime.getURL(`warning.html?type=intel&domain=${encodeURIComponent(host)}`);
                blockedTabs.set(details.tabId, details.url);
                chrome.tabs.update(details.tabId, { url: warningUrl });
                return;
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
syncRules(RANGE.official, [{
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
}]);


// 🚀 注入挖矿域名 DNR 拦截
if (MINING_DOMAINS && MINING_DOMAINS.length > 0) {
    const miningRules = MINING_DOMAINS.map((domain, index) => ({
        id: 900000 + index, // 使用 90 万段 ID，避开其他模块
        priority: 2000000,
        action: { type: 'block' },
        condition: {
            requestDomains: [domain],
            resourceTypes: ["sub_frame", "script", "object", "xmlhttprequest", "websocket", "other"]
        }
    }));
    syncRules(RANGE.mining, miningRules);
}




// ==========================================
// 🌐 Background 多语言引擎 (内存缓存)
// ==========================================
let bgDict = {};
async function loadBgI18n() {
    try {
        const res = await chrome.storage.local.get('preferred_lang');
        let lang = res.preferred_lang || navigator.language.split('-')[0].toLowerCase() || 'en';
        if (lang === 'zh_CN') lang = 'zh';
        
        const url = chrome.runtime.getURL(`popup/locales/${lang}.json`);
        const response = await fetch(url);
        if (response.ok) {
            bgDict = await response.json();
        }
    } catch (e) {
        console.warn('[DewSecure] 后台语言包加载失败', e);
    }
}
loadBgI18n(); // 启动时异步加载

// ==========================================
// 🚀 下载与投递链防御 (Download Guard)
// ==========================================


chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    const fullName = (item.filename || item.suggestedFilename || '').toLowerCase();
    console.log('[DewSecure] 拦截下载检查:', fullName);

    if (!fullName) {
        suggest();
        return;
    }

    // 2. 检查双扩展名 (如 invoice.pdf.exe)
    const doubleExtRegex = /\.(pdf|docx?|xlsx?|pptx?|jpg|jpeg|png|gif|txt|csv|zip|rar)\.(exe|scr|js|vbs|bat|cmd|lnk|hta|msi|jar)$/i;
    const isDoubleExt = doubleExtRegex.test(fullName);

    // 3. 检查高危可执行后缀
    const highRiskExts = ['.exe', '.msi', '.vbs', '.hta', '.lnk', '.scr', '.iso'];
    const isHighRisk = highRiskExts.some(ext => fullName.endsWith(ext));

    // 4. 检查脚本后缀
    const scriptExts = ['.js', '.bat', '.cmd', '.ps1'];
    const isScript = scriptExts.some(ext => fullName.endsWith(ext));

    if (!isDoubleExt && !isHighRisk && !isScript) {
        suggest();
        return;
    }

    // 5. 判断来源是否安全
    let isSafeOrigin = false;
    try {
        const originUrl = item.referrer || item.url || '';
        if (originUrl && originUrl.startsWith('http')) {
            const host = new URL(originUrl).hostname;
            isSafeOrigin = HARD_SAFE_DOMAINS.some(d => host === d || host.endsWith('.' + d));
        }
    } catch (e) {}

    if (isSafeOrigin) {
        suggest();
        return;
    }

    // 6. 处置逻辑
    if (isDoubleExt) {
        // 🛡️ 双扩展名：零容忍，直接阻断
        const warningUrl = chrome.runtime.getURL(`warning.html?type=download&filename=${encodeURIComponent(fullName)}`);
        chrome.tabs.create({ url: warningUrl });
        showDownloadNotification('danger', fullName, bgDict.phish_download_danger_title || '🚨 High-Risk Download Blocked', (bgDict.phish_download_danger_desc || 'A double extension file ({filename}) was detected.').replace('{filename}', fullName));
        return;
    } else if (isHighRisk || isScript) {
        // 普通高危后缀：弹窗警告，允许用户继续下载
        showDownloadNotification('warning', fullName, bgDict.phish_download_warn_title || '⚠️ Security Risk', (bgDict.phish_download_warn_desc || 'You are downloading an executable from an unknown source ({filename}).').replace('{filename}', fullName));
        suggest();
    } else {
        suggest();
    }
});

function showDownloadNotification(level, filename, title, message) {
    // 🛡️ 修复 MV3 CSP 限制：不能使用 data: 开头的 Base64 图片，必须使用扩展本地的静态图标
    const iconUrl = chrome.runtime.getURL('icons/icon-128.png');

    chrome.notifications.create({
        type: 'basic',
        iconUrl: iconUrl,
        title: title,
        message: message,
        priority: level === 'danger' ? 2 : 0
    });
}


// 🚀 注入隐私净化动态规则 (不受静态额度限制，绝不与 11 万条规则冲突)
const privacyRules = [
    // 1. 剔除追踪参数 (优先级 100，最高，且移除 urlFilter，让引擎自动识别参数)
    {
        "id": 10002, "priority": 100,
        "action": { 
            "type": "redirect", 
            "redirect": { 
                "transform": { 
                    "queryTransform": { 
                        "removeParams": ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid", "yclid", "msclkid", "mc_cid", "mc_eid", "igshid", "mkt_tok", "oly_enc_id", "oly_anon_id"] 
                    } 
                } 
            } 
        },
        "condition": { 
            "resourceTypes": ["main_frame", "sub_frame"] 
        }
    },
    // 2. 强制 HTTPS 升级 (优先级 10)
    {
        "id": 10001, "priority": 10, "action": { "type": "upgradeScheme" },
        "condition": { 
            "resourceTypes": ["main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "other"] 
        }
    },
    // 3. 注入 Sec-GPC 隐私信号 (优先级 1)
    {
        "id": 10003, "priority": 1,
        "action": { "type": "modifyHeaders", "requestHeaders": [{ "header": "Sec-GPC", "operation": "set", "value": "1" }] },
        "condition": { 
            "resourceTypes": ["main_frame", "sub_frame", "xmlhttprequest"] 
        }
    }
];

syncRules(RANGE.privacy, privacyRules);
