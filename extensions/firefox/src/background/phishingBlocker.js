import { detectBrandPhishing } from './phishingDetector.js';

export function initPhishingBlocker() {
    if (!chrome.webNavigation || !chrome.webNavigation.onBeforeNavigate) return;

    // 记录已拦截的标签页，防止重定向循环
    const blockedTabs = new Set();

    chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
        // 只拦截主框架的真实网页
        if (details.frameId !== 0 || !details.url.startsWith('http')) return;

        // 🔒 防循环
        if (blockedTabs.has(details.tabId)) {
            console.log('[DEBUG] 标签页已拦截过，本次放行:', details.tabId);
            blockedTabs.delete(details.tabId);
            return;
        }

        try {
            // 🛡️ 拦截前置检查 1：解析域名并检查用户白名单与临时暂停
            const urlObj = new URL(details.url);
            const host = urlObj.hostname;
            const { dewsecure_settings: settings } = await chrome.storage.local.get('dewsecure_settings');
            const s = settings || {};
            const matchDomain = (d) => host === d || host.endsWith('.' + d);

            // 命中白名单（或点击了 Site Switch 暂停），绝对不拦截
            if ((s.whitelist || []).some(matchDomain) || (s.tempWhitelist || []).some(matchDomain)) {
                return; 
            }

            // 🛡️ 拦截前置检查 2：细分功能开关
            // 如果用户关掉了 AI 钓鱼检测，直接放行，绝不拦截
            if (s.phishingEnabled === false) {
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
}
