// ==========================================
// 🧭 导航拦截：tabs.onUpdated AI 检测 + webNavigation 钓鱼拦截
// ==========================================
import { runAICheck } from './ai.js';
import { checkThreatFilter } from './threatIntel.js';
import { HARD_SAFE_DOMAINS } from './aiConfig.js';
import { getCurrentUser } from '../authManager.js';
import { extractFeatures } from '../phishScoutFeatures.js';
import { loadModel, predict } from '../treeEval.js';
import realModelData from '../phishscout_local.json';

const EXT_ORIGIN = chrome.runtime.getURL('');
const isOwnWarningPage = (u) => {
    if (typeof u !== 'string') return false;
    return u.startsWith(EXT_ORIGIN) && u.includes('/warning.html');
};

// 启动时加载模型到内存（在 Service Worker 中只执行一次）
const phishModel = loadModel(realModelData);

export function initNavigation() {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
            runAICheck(tab.url, tabId);
        }
    });

    if (chrome.webNavigation && chrome.webNavigation.onBeforeNavigate) {
        const blockedTabs = new Map(); 

        chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
            if (isOwnWarningPage(details.url) && details.frameId === 0) {
                try {
                    const urlParams = new URL(details.url).searchParams;
                    const rawDomain = urlParams.get('domain') || urlParams.get('url') || '';
                    let parsedHost = null;
                    try {
                        parsedHost = new URL(rawDomain.startsWith('http') ? rawDomain : `https://${rawDomain}`).hostname;
                    } catch(e) {}

                    if (parsedHost && HARD_SAFE_DOMAINS.some(d => parsedHost === d || parsedHost.endsWith('.' + d))) {
                        chrome.tabs.update(details.tabId, { url: `https://${parsedHost}` });
                        return;
                    }
                } catch (e) {}

                chrome.tabs.get(details.tabId, (tab) => {
                    if (tab && tab.url && !isOwnWarningPage(tab.url)) {
                        chrome.storage.local.set({ last_blocked_url: tab.url });
                    }
                });
                return;
            }

            if (details.frameId !== 0 || !details.url.startsWith('http')) return;

            if (blockedTabs.has(details.tabId)) {
                const lastUrl = blockedTabs.get(details.tabId);
                if (lastUrl === details.url) {
                    blockedTabs.delete(details.tabId);
                    return;
                }
            }

            try {
                const urlObj = new URL(details.url);
                const host = urlObj.hostname;

                const isHardSafeDomain = (h) => HARD_SAFE_DOMAINS.some(d => h === d || h.endsWith('.' + d));
                if (isHardSafeDomain(host)) return;

                const { dewsecure_settings: settings } = await chrome.storage.local.get('dewsecure_settings');
                const s = settings || {};
                const matchDomain = (d) => host === d || host.endsWith('.' + d);

                if ((s.whitelist || []).some(matchDomain) || (s.tempWhitelist || []).some(matchDomain)) return;

                if (checkThreatFilter(host)) {
                    const warningUrl = chrome.runtime.getURL(`warning.html?type=intel&domain=${encodeURIComponent(host)}`);
                    blockedTabs.set(details.tabId, details.url);
                    chrome.tabs.update(details.tabId, { url: warningUrl });
                    return;
                }

                const user = await getCurrentUser();
                const isPro = user && ['pro', 'trial', 'family', 'premium'].includes(user.tier);
                if (!isPro || s.phishingEnabled !== true) return;

                // 🎣 PhishScout 影子模式
                try {
                    const features = extractFeatures(details.url);
                    const prob = predict(phishModel, features);
                    console.debug(`🎣 [PhishScout Shadow] URL: ${details.url} | 概率: ${prob.toFixed(4)}`);
                } catch (err) {
                    console.warn('🎣 [PhishScout Shadow] 推理失败:', err);
                }

                const phishingModule = await import('./phishingDetector.js');
                let isPhish = false;
                let reasons = [];

                if (phishingModule.assess) {
                    const finding = phishingModule.assess(details.url);
                    if (finding.flag) {
                        isPhish = true;
                        reasons = finding.reasons;
                    }
                } else if (phishingModule.detectBrandPhishing(details.url)) {
                    isPhish = true;
                    reasons = ['brand-mismatch'];
                }

                if (isPhish) {
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
