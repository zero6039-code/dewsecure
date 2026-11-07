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
            // 1. 警告页自身处理逻辑（略）
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

            // 2. 防循环拦截机制
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

                // 3. 白名单与豁免检查
                const isHardSafeDomain = (h) => HARD_SAFE_DOMAINS.some(d => h === d || h.endsWith('.' + d));
                if (isHardSafeDomain(host)) return;

                const { dewsecure_settings: settings } = await chrome.storage.local.get('dewsecure_settings');
                const s = settings || {};
                const matchDomain = (d) => host === d || host.endsWith('.' + d);

                if ((s.whitelist || []).some(matchDomain) || (s.tempWhitelist || []).some(matchDomain)) return;

                // 4. 本地威胁情报拦截
                if (checkThreatFilter(host)) {
                    const warningUrl = chrome.runtime.getURL(`warning.html?type=intel&domain=${encodeURIComponent(host)}`);
                    blockedTabs.set(details.tabId, details.url);
                    chrome.tabs.update(details.tabId, { url: warningUrl });
                    return;
                }

                // 5. PRO 用户与开关检测
                const user = await getCurrentUser();
                const isPro = user && ['pro', 'trial', 'family', 'premium'].includes(user.tier);
                if (!isPro || s.phishingEnabled !== true) return;

                // 6. 🚨 核心 AI + 规则引擎融合检测
                const phishingModule = await import('./phishingDetector.js');
                
                // 提取现有规则引擎结果
                let heurFlag = false;
                let heurScore = 0;
                let heurReasons = [];

                if (phishingModule.assess) {
                    const finding = phishingModule.assess(details.url);
                    heurFlag = finding.flag;
                    heurScore = finding.score || finding.reasons?.length || (finding.flag ? 2 : 0);
                    heurReasons = finding.reasons || [];
                } else if (phishingModule.detectBrandPhishing(details.url)) {
                    heurFlag = true;
                    heurScore = 2; // 模拟默认分数
                    heurReasons = ['brand-mismatch'];
                }

                // 提取本地 AI 概率
                let aiProb = 0;
                try {
                    const features = extractFeatures(details.url);
                    aiProb = predict(phishModel, features);
                } catch (err) {
                    console.warn('🎣 [PhishScout] 推理失败:', err);
                }

                let isPhish = false;
                let reasons = [...heurReasons];

                // ======= 🧠 融合决策逻辑 =======
                // 1. 规则引擎直接命中高危
                if (heurFlag) {
                    isPhish = true;
                } 
                // 2. 极高 AI 概率 + 规则引擎有嫌疑
                else if (aiProb >= 0.95 && heurScore >= 1) {
                    isPhish = true;
                    if (reasons.length === 0) reasons.push('ai-high-confidence');
                }
                // 3. 高 AI 概率 + 规则引擎极度可疑
                else if (aiProb >= 0.85 && heurScore >= 2) {
                    isPhish = true;
                    if (reasons.length === 0) reasons.push('ai-rule-fusion');
                }

                // 打印最终决策过程，方便调试
                console.debug(`🛡️ [Fusion] URL: ${details.url} | AI概率: ${aiProb.toFixed(4)} | 规则得分: ${heurScore} | 最终拦截: ${isPhish}`);

                if (isPhish) {
                    console.log('🚨 [Security] 拦截钓鱼网站:', details.url, '理由:', reasons);
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
