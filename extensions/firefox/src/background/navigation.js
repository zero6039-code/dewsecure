// ==========================================
// 🧭 导航拦截：tabs.onUpdated AI 检测 + webNavigation 钓鱼拦截
// ==========================================
import { runAICheck } from './ai.js';
import { checkThreatFilter } from './threatIntel.js';
import { HARD_SAFE_DOMAINS } from './aiConfig.js';
import { getCurrentUser } from '../authManager.js';
import { extractFeatures } from '../phishScoutFeatures.js';
import { loadModel, predict } from '../treeEval.js';
import { getPhishModelData } from './phishModelManager.js';
// 🚀 P-3 优化：静态导入，消除每次导航时的动态 import 开销
import { assess } from './phishingDetector.js';
import { getDomain } from 'tldts';

const EXT_ORIGIN = chrome.runtime.getURL('');
const isOwnWarningPage = (u) => typeof u === 'string' && u.startsWith(EXT_ORIGIN) && u.includes('/warning.html');

// 🚀 P-3 优化：内存缓存，避免每次导航都等待 IPC
let cachedSettings = {};
let cachedUser = null;

async function initCache() {
    // 初始化拉取一次
    const { dewsecure_settings } = await chrome.storage.local.get('dewsecure_settings');
    cachedSettings = dewsecure_settings || {};
    cachedUser = await getCurrentUser();

    // 监听 storage 变化，保持缓存最新
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local') {
            if (changes['dewsecure_settings']) {
                cachedSettings = changes['dewsecure_settings'].newValue || {};
            }
            if (changes['dewsecure_user']) {
                // 用户状态变化是异步的，这里通过 getCurrentUser 刷新
                getCurrentUser().then(u => { cachedUser = u; }).catch(() => {});
            }
        }
    });
}
initCache().catch(console.warn);

// 异步加载模型
let phishModel = null;
(async () => {
    const modelData = await getPhishModelData();
    phishModel = loadModel(modelData);
    console.log('🛡️ [AI] PhishScout 纯 JS 模型已就绪');
})();

// 监听模型热更新
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'PHISH_MODEL_UPDATED') {
        getPhishModelData().then(data => {
            phishModel = loadModel(data);
            console.log('🛡️ [AI] PhishScout 模型已热重载');
        });
    }
});

const redirectChains = new Map(); // tabId -> { hops: [], t }

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
            if (blockedTabs.has(details.tabId) && blockedTabs.get(details.tabId) === details.url) {
                blockedTabs.delete(details.tabId);
                return;
            }

            try {
                const urlObj = new URL(details.url);
                const host = urlObj.hostname;

                if (HARD_SAFE_DOMAINS.some(d => host === d || host.endsWith('.' + d))) return;

                // 🚀 P-3 优化：直接使用内存缓存，消除 await storage 的 IPC 开销
                const s = cachedSettings;
                const matchDomain = (d) => host === d || host.endsWith('.' + d);

                if ((s.whitelist || []).some(matchDomain) || (s.tempWhitelist || []).some(matchDomain)) return;

                if (checkThreatFilter(host)) {
                    blockedTabs.set(details.tabId, details.url);
                    chrome.tabs.update(details.tabId, { url: chrome.runtime.getURL(`warning.html?type=intel&domain=${encodeURIComponent(host)}`) });
                    return;
                }

                // 🚀 P-3 优化：直接使用内存缓存的用户状态
                const user = cachedUser;
                const isPro = user && ['pro', 'trial', 'family', 'premium'].includes(user.tier);
                if (!isPro || s.phishingEnabled !== true || !phishModel) return;

                // 🚀 P-3 优化：静态导入的 assess 函数，消除动态 import
                let heurFlag = false, heurScore = 0, heurReasons = [];

                if (assess) {
                    const finding = assess(details.url);
                    heurFlag = finding.flag;
                    heurScore = finding.score || finding.reasons?.length || (finding.flag ? 2 : 0);
                    heurReasons = finding.reasons || [];
                }

                let aiProb = 0;
                try {
                    const features = extractFeatures(details.url);
                    aiProb = predict(phishModel, features);
                } catch (err) { }

                let isPhish = false;
                let reasons = [...heurReasons];

                if (heurFlag) isPhish = true;
                else if (aiProb >= 0.95 && heurScore >= 1) {
                    isPhish = true;
                    if (reasons.length === 0) reasons.push('ai-high-confidence');
                } else if (aiProb >= 0.85 && heurScore >= 2) {
                    isPhish = true;
                    if (reasons.length === 0) reasons.push('ai-rule-fusion');
                }

                console.debug(`🛡️ [Fusion] ${details.url} | AI: ${aiProb.toFixed(4)} | 规则: ${heurScore} | 拦截: ${isPhish}`);

                if (isPhish) {
                    blockedTabs.set(details.tabId, details.url);
                    chrome.tabs.update(details.tabId, { url: chrome.runtime.getURL(`warning.html?url=${encodeURIComponent(details.url)}&isPro=false&reasons=${encodeURIComponent(reasons.join(', '))}`) });
                }
            } catch (e) { }
        });
    }

    // ==========================================
    // 🛡️ AD-2: TDS (跳转链) 检测机制
    // ==========================================
    if (chrome.webNavigation && chrome.webNavigation.onCommitted) {
        chrome.webNavigation.onCommitted.addListener((d) => {
            if (d.frameId !== 0) return; // 仅关注主框架

            let reg = '';
            try {
                reg = getDomain(new URL(d.url).hostname, { allowPrivateDomains: true }) || '';
            } catch (e) {
                return;
            }
            if (!reg) return;

            const now = Date.now();
            const qualifiers = d.transitionQualifiers || [];
            const redirected = qualifiers.includes('server_redirect') || qualifiers.includes('client_redirect');

            const c = redirectChains.get(d.tabId);

            // 如果不是重定向，或者链断了（超过 15 秒），重置链
            if (!redirected || !c || now - c.t > 15000) {
                redirectChains.set(d.tabId, { hops: [reg], t: now });
                return;
            }

            // 如果是重定向，且当前域不在历史记录最后，则推入链
            if (c.hops[c.hops.length - 1] !== reg) {
                c.hops.push(reg);
            }
            c.t = now;

            // 跨注册域跳转 >= 4 次（即 A -> B -> C -> D，4个不同域名）
            const uniqueDomains = new Set(c.hops);
            if (uniqueDomains.size >= 4) {
                console.warn(`🚨 [TDS] 检测到疑似恶意跳转链 (Tab ${d.tabId}):`, [...uniqueDomains].join(' -> '));
                
                // 这里先只做告警。如果后续需要直接拦截，可以恢复下面这行：
                // chrome.tabs.update(d.tabId, { url: chrome.runtime.getURL('warning.html?type=tds') });
            }
        });

        // 标签页关闭时清理内存
        chrome.tabs.onRemoved.addListener((tabId) => {
            redirectChains.delete(tabId);
        });
    }

}
