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

const EXT_ORIGIN = chrome.runtime.getURL('');
const isOwnWarningPage = (u) => typeof u === 'string' && u.startsWith(EXT_ORIGIN) && u.includes('/warning.html');

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

                const { dewsecure_settings: settings } = await chrome.storage.local.get('dewsecure_settings');
                const s = settings || {};
                const matchDomain = (d) => host === d || host.endsWith('.' + d);

                if ((s.whitelist || []).some(matchDomain) || (s.tempWhitelist || []).some(matchDomain)) return;

                if (checkThreatFilter(host)) {
                    blockedTabs.set(details.tabId, details.url);
                    chrome.tabs.update(details.tabId, { url: chrome.runtime.getURL(`warning.html?type=intel&domain=${encodeURIComponent(host)}`) });
                    return;
                }

                const user = await getCurrentUser();
                const isPro = user && ['pro', 'trial', 'family', 'premium'].includes(user.tier);
                if (!isPro || s.phishingEnabled !== true || !phishModel) return;

                const phishingModule = await import('./phishingDetector.js');
                let heurFlag = false, heurScore = 0, heurReasons = [];

                if (phishingModule.assess) {
                    const finding = phishingModule.assess(details.url);
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
}
