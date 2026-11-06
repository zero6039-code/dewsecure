// ==========================================
// 🧭 导航拦截：tabs.onUpdated AI 检测 + webNavigation 钓鱼拦截
// ==========================================
import { runAICheck } from './ai.js';
import { checkThreatFilter } from './threatIntel.js';
import { HARD_SAFE_DOMAINS } from './aiConfig.js';
import { getCurrentUser } from '../authManager.js';

// 🔒 H1 修复：使用扩展自身 URL 前缀判断，不再用子串匹配（防止 ?warning.html / #warning.html 绕过）
const EXT_ORIGIN = chrome.runtime.getURL('');
const isOwnWarningPage = (u) => {
    if (typeof u !== 'string') return false;
    // 基于扩展 origin 匹配，兼容 use_dynamic_url 动态改写
    return u.startsWith(EXT_ORIGIN) && u.includes('/warning.html');
};

export function initNavigation() {
    // 🌟 P-01 修复：页面加载完成时触发 AI 检测
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
            runAICheck(tab.url, tabId);
        }
    });

    // 🌟 P-01 硬核钓鱼拦截：在页面加载前抢占并重定向
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

                // 🚨 执行钓鱼检测（分级处置）
                // 兼容旧版本直接返回 boolean 的情况，如果有 assess 则调用 assess
                const phishingModule = await import('./phishingDetector.js');
                let isPhish = false;
                let reasons = [];

                if (phishingModule.assess) {
                    const finding = phishingModule.assess(details.url);
                    // 如果 flag 为 true，且理由大于等于 2 个，判定为高危，直接阻断
                    if (finding.flag) {
                        isPhish = true;
                        reasons = finding.reasons;
                    }
                } else if (phishingModule.detectBrandPhishing(details.url)) {
                    isPhish = true;
                    reasons = ['brand-mismatch'];
                }

                if (isPhish) {
                    // 这里可以引入更细的评分，目前先按高危处理
                    console.log('🚨 [Security] 检测到品牌钓鱼，执行强制拦截:', details.url, '理由:', reasons);
                    const reasonStr = encodeURIComponent(reasons.join(', '));
                    const warningUrl = chrome.runtime.getURL(`warning.html?url=${encodeURIComponent(details.url)}&isPro=false&reasons=${reasonStr}`);
                    blockedTabs.set(details.tabId, details.url);
                    chrome.tabs.update(details.tabId, { url: warningUrl });
                }
            } catch (e) {
                console.warn('[Security] 拦截逻辑异常:', e);
            }
        });
    }
}
