(function () {
    'use strict';
    
    // 🌟 官网与本地开发环境白名单
    const hostname = window.location.hostname;
    if (
        hostname === 'dewsecure.com' || 
        hostname.endsWith('.dewsecure.com') ||
        hostname === 'localhost' ||
        hostname === '127.0.0.1'
        // 注意：为了让本地测试生效，我们已经移除了 localhost 的豁免
    ) {
        console.log('🛡️ [DewSecure] 官方域名与本地环境，已自动跳过内容清理。');
        return;
    }

    if (window.__dewsecureInjected) return;
    
    // ===== DewSecure 复杂 SPA 豁免名单 =====
    // Forbes 拥有极其严格的 Datadome 反爬和 React 水合机制，任何 DOM 篡改都会导致白屏
    const SPA_SAFE_LIST = ['wired.com', 'forbes.com'];
    if (SPA_SAFE_LIST.some(d => window.location.hostname.includes(d))) {
        console.warn('🛡️ [DewSecure] 检测到复杂 SPA 站点，已自动豁免 DOM 清理以防止白屏。');
        return; 
    }

    window.__dewsecureInjected = true;

    // ===== 调试开关 =====
    const DEBUG = false;
    const warn = DEBUG ? console.warn.bind(console) : () => {};
    
    const AD_PATTERN      = /(^|[-_])(ad|ads|advert|banner|popup|sponsor|promo|cookie|consent|push|tracking|tracker|ad-slot|ad-box|ad-wrap|ad-frame|ad-banner)([-_]|$)/i;
    const CAPTCHA_PATTERN = /(verify|captcha|challenge|puzzle|recaptcha|hcaptcha|turnstile)/i;

    // ===== 统一封装安全的消息发送 =====
    function safeSendMessage(msg) {
        try {
            if (chrome.runtime && chrome.runtime.id) {
                chrome.runtime.sendMessage(msg).catch(() => {});
            }
        } catch (e) {}
    }

    // 🌟 F1 修复：监听页面发出的所有第三方网络请求（结合 AI 拦截广告）
    try {
        const seenThirdParty = new Set();
        const observer = new PerformanceObserver((list) => {
            const newHosts = [];
            for (const entry of list.getEntries()) {
                try {
                    const urlObj = new URL(entry.name);
                    const host = urlObj.hostname;
                    // 提取主域进行比较，防止 recommendation.forbes.com 被当成第三方
                    const getBaseDomain = (h) => h ? h.split('.').slice(-2).join('.') : '';
                    if (host && getBaseDomain(host) !== getBaseDomain(window.location.hostname)) {
                        if (!seenThirdParty.has(host)) {
                            seenThirdParty.add(host);
                            newHosts.push(host);
                        }
                    }
                } catch (e) {}
            }
            if (newHosts.length > 0) {
                safeSendMessage({ type: 'THIRD_PARTY_HOSTS', hosts: newHosts });
            }
        });
        observer.observe({ type: 'resource', buffered: true });
    } catch (e) {}

    // ===== DOM 净化统计上报 =====
    function reportDomHidden(element) {
        if (!element || element.dataset.dewsecureReported) return;
        element.dataset.dewsecureReported = 'true';
        safeSendMessage({
            type: 'DOM_AD_HIDDEN',
            url: window.location.href,
            tagName: element.tagName || 'DIV'
        });
    }

    // ===== CSS 注入工具 =====
    function appendStyleWhenReady(style, id) {
        if (document.getElementById(id)) return;
        const tryAppend = () => {
            if (document.getElementById(id)) return true;
            const target = document.head || document.documentElement;
            if (target) { target.appendChild(style); return true; }
            return false;
        };
        if (tryAppend()) return;
        const obs = new MutationObserver(() => {
            if (tryAppend()) obs.disconnect();
        });
        obs.observe(document.documentElement, { childList: true, subtree: true });
        setTimeout(tryAppend, 100);
    }

    // ===== 动态注入 CSS（根据真实开关生效） =====
    function injectDynamicCSS(settings = {}) {
        const style = document.createElement('style');
        style.id = '__dewsecure_style_all';
        
        let css = `
            /* 基础广告拦截 */
            .ad-banner, .ad-container, .ad-slot, .ad-wrapper, .ad-unit,
            .ad-panel, .ad-box, .ad-frame, .ad-iframe, .ad-sticky, .ad-overlay,
            [data-ad], [data-ad-slot], [data-ad-unit], [data-google-query-id],
            ins.adsbygoogle, iframe[src*="doubleclick"], iframe[id*="google_ads_iframe"],
            .native-ad, .sponsored, .promoted, .advertisement,
            .floating-ad, .video-ad, .google_ads_iframe, .OUTBRAIN, .taboola,
            .in-article-ad, .dfp-ad, .gpt-ad,
            #adLeaderboard, #adFrame, #ad-space, #ad-content, #ad-area, #ad-zone,
            .text-ad, .textad, .advertorial, .branded-content,
            [data-ad-source], [data-ad-provider], [aria-label="sponsored"] {
                display: none !important;
                opacity: 0 !important;
                pointer-events: none !important;
                visibility: hidden !important;
            }
        `;

        if (settings.hideCookieNotices !== false) {
            css += `
                /* Cookie 弹窗拦截 */
                #cookie-banner, .cookie-consent, [id*="cookie-notice"], [class*="cookie-banner"],
                .gdpr-banner, #gdpr, [class*="gdpr"], .consent-bar, .cookie-snackbar, .cookie-toast,
                #onetrust-consent-sdk, .optanon-alert-box-wrapper, #didomi-notice, #cookiebot,
                .cc-window, .cli-modal, .moove-gdpr-infobar, .borlabs-cookie-box,
                .osano-cm-window, #iubenda-cs-banner, .cky-consent-container,
                #usercentrics-root, #truste-consent-track, #qc-cmp2-container,
                .cookie-top-bar, .floating-cookie-notice, .privacy-banner,
                #eu-cookie-law, .eu-cookie-law, .ccpa-banner, .generic-cookie-message {
                    display: none !important;
                    pointer-events: none !important;
                }
            `;
        }

        if (settings.blockSocialTrackers !== false) {
            css += `
                /* 社交追踪拦截 */
                .social-widget, .social-bar, .share-bar, .twitter-share-button,
                .fb-like, .fb-share-button, .social-share-overlay,
                .social-icons-bar, .follow-widget {
                    display: none !important;
                }
            `;
        }

        style.textContent = css;
        appendStyleWhenReady(style, '__dewsecure_style_all');
    }

    // ===== 批处理：属性变化 =====
    const pendingAttr = new Set();
    let attrTimer = null;
    function flushAttr() {
        attrTimer = null;
        if (pendingAttr.size === 0) return;
        const batch = Array.from(pendingAttr);
        pendingAttr.clear();
        for (const el of batch) {
            if (!el || !el.isConnected || el.dataset.dwKilled) continue;
            try {
                if (AD_PATTERN.test((el.className || '') + ' ' + (el.id || ''))) {
                    el.style.setProperty('display', 'none', 'important');
                    el.dataset.dwKilled = 'true';
                    reportDomHidden(el);
                }
            } catch (_) {}
        }
    }

    // ===== 批处理：新增节点 =====
    const pendingCheck = new Set();
    let idleCallbackId = null;
    let checkTimer = null;

    function processIdleQueue(deadline) {
        idleCallbackId = null;
        if (pendingCheck.size === 0) return;
        while ((deadline.timeRemaining() > 0 || deadline.didTimeout) && pendingCheck.size > 0) {
            const node = pendingCheck.values().next().value;
            pendingCheck.delete(node);
            checkAndKill(node);
        }
        if (pendingCheck.size > 0) {
            idleCallbackId = requestIdleCallback(processIdleQueue, { timeout: 100 });
        }
    }

    function flushCheck() {
        checkTimer = null;
        if (pendingCheck.size === 0) return;
        if (idleCallbackId) return;
        idleCallbackId = requestIdleCallback(processIdleQueue, { timeout: 100 });
    }
    
    function scheduleCheck(el) {
        if (!el) return;
        pendingCheck.add(el);
        if (checkTimer) return;
        checkTimer = setTimeout(flushCheck, 50);
    }

    // ===== 节点扫描与击毙 =====
    function checkAndKill(root) {
        if (!root) return;
        const elements = root.querySelectorAll ? root.querySelectorAll('div, iframe, ins, section, aside') : [];
        const killList = [];
        
        for (const el of elements) {
            if (el.dataset.dwKilled) continue;
            const inlinePos = el.style.position;
            if (inlinePos && inlinePos !== 'fixed' && inlinePos !== 'absolute') continue;
            
            try {
                const style = window.getComputedStyle(el);
                if (style.position !== 'fixed' && style.position !== 'absolute') continue;
                
                const rect = el.getBoundingClientRect();
                const isLarge = rect.width > window.innerWidth * 0.8 && rect.height > window.innerHeight * 0.8;
                if (!isLarge) continue;
                
                const isInvisible = parseFloat(style.opacity) < 0.1;
                const zIndex = parseInt(style.zIndex, 10) || 0;
                
                if (!isInvisible && zIndex <= 1000) continue;

                // 🚀 修复假验证码绕过：只豁免真正的官方验证码 iframe
                let isOfficialCaptcha = false;
                if (el.tagName === 'IFRAME') {
                    const src = (el.src || '').toLowerCase();
                    const officialCaptchaHosts = ['google.com/recaptcha', 'recaptcha.net', 'hcaptcha.com', 'challenges.cloudflare.com'];
                    if (officialCaptchaHosts.some(h => src.includes(h))) isOfficialCaptcha = true;
                }
                if (isOfficialCaptcha) continue;

                killList.push(el);
            } catch (_) {}
        }
        
        for (const el of killList) {
            el.style.setProperty('pointer-events', 'none', 'important');
            el.style.setProperty('display', 'none', 'important');
            el.dataset.dwKilled = 'true';
            reportDomHidden(el);
            warn('killed overlay');
        }
        
        if (root.shadowRoot) checkAndKill(root.shadowRoot);
    }

    // ==========================================
    // 🚀 页面级本地钓鱼识别 (启发式规则打分)
    // ==========================================
    function analyzePageForPhishing() {
        const hostname = window.location.hostname;
        
        const passwordInputs = document.querySelectorAll('input[type="password"]');
        if (passwordInputs.length === 0) return;

        let score = 40;
        const reasons = ['检测到密码输入框'];

        const forms = document.querySelectorAll('form');
        let hasSuspiciousForm = false;
        for (const form of forms) {
            const action = form.getAttribute('action');
            if (!action) continue;
            
            if (action.startsWith('data:') || action.startsWith('blob:')) {
                score += 20;
                reasons.push('表单使用了 data:/blob: 提交');
                hasSuspiciousForm = true;
            } else {
                try {
                    const actionUrl = new URL(action, window.location.href);
                    const getBaseDomain = (h) => h ? h.split('.').slice(-2).join('.') : '';
                    if (getBaseDomain(actionUrl.hostname) !== getBaseDomain(hostname)) {
                        score += 30;
                        reasons.push(`表单跨域提交至 ${actionUrl.hostname}`);
                        hasSuspiciousForm = true;
                    }
                } catch (e) {}
            }
        }

        const title = document.title.toLowerCase();
        const BRANDS = ['paypal', 'apple', 'microsoft', 'google', 'amazon', 'netflix', 'binance', 'coinbase', 'facebook', 'instagram'];
        for (const brand of BRANDS) {
            if (title.includes(brand) && !hostname.includes(brand)) {
                score += 20;
                reasons.push(`页面标题包含品牌词 [${brand}] 但域名不匹配`);
                break;
            }
        }

        const iframes = document.querySelectorAll('iframe');
        for (const iframe of iframes) {
            try {
                const src = iframe.src;
                if (src && src.startsWith('http')) {
                    const iframeUrl = new URL(src);
                    const getBaseDomain = (h) => h ? h.split('.').slice(-2).join('.') : '';
                    if (getBaseDomain(iframeUrl.hostname) !== getBaseDomain(hostname)) {
                        const style = window.getComputedStyle(iframe);
                        if (style.display === 'none' || style.visibility === 'hidden' || parseInt(style.width) <= 1) {
                            score += 10;
                            reasons.push('检测到隐藏的跨域 iframe');
                            break;
                        }
                    }
                }
            } catch(e) {}
        }

        if (score >= 60) {
            console.warn(`🚨 [DewSecure] 本地启发式检测到疑似钓鱼行为 (得分: ${score})`, reasons);
            triggerPhishingWarning(score, reasons, passwordInputs);
        }
    }

    function triggerPhishingWarning(score, reasons, passwordInputs) {
        passwordInputs.forEach(input => {
            input.disabled = true;
            input.style.backgroundColor = '#ffebee';
            input.style.border = '2px solid #ef4444';
            input.placeholder = '⚠️ DewSecure 已锁定该输入框';
        });
        document.querySelectorAll('form button[type="submit"], form input[type="submit"]').forEach(btn => {
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
        });

        if (document.getElementById('dewsecure-phishing-warning')) return;

        const banner = document.createElement('div');
        banner.id = 'dewsecure-phishing-warning';
        banner.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
            background: #ef4444; color: white; padding: 12px 20px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 14px; display: flex; justify-content: space-between; align-items: center;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        `;
        banner.innerHTML = `
            <div>
                <strong>🚨 安全警告：</strong>此页面疑似钓鱼网站，您的密码可能会被窃取。
                <div style="font-size: 12px; opacity: 0.8; margin-top: 4px;">原因: ${reasons.join(', ')}</div>
            </div>
            <button id="dewsecure-phishing-ignore" style="background: transparent; border: 1px solid white; color: white; padding: 4px 12px; border-radius: 4px; cursor: pointer;">我确定安全，继续</button>
        `;
        document.body.appendChild(banner);

        document.getElementById('dewsecure-phishing-ignore').addEventListener('click', () => {
            banner.remove();
            passwordInputs.forEach(input => {
                input.disabled = false;
                input.style.backgroundColor = '';
                input.style.border = '';
                input.placeholder = '';
            });
            document.querySelectorAll('form button[type="submit"], form input[type="submit"]').forEach(btn => {
                btn.disabled = false;
                btn.style.opacity = '';
                btn.style.cursor = '';
            });
            console.warn('🛡️ [DewSecure] 用户选择了忽略警告，已恢复表单输入。');
        });
    }

    // ===== 核心初始化 =====
    function init() {
        const skipDomains = ['google.com', 'youtube.com', 'facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'wired.com'];
        if (skipDomains.some(d => window.location.hostname.endsWith(d))) {
            console.log('🛡️ [DewSecure] 核心站点豁免 DOM 清理，防止 SPA 崩溃。');
            return;
        }

        try {
            chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (settings) => {
                if (chrome.runtime.lastError || !settings) return;
                
                const host = window.location.hostname;
                const m = d => host === d || host.endsWith('.' + d);
                if ((settings.whitelist || []).some(m) || (settings.tempWhitelist || []).some(m)) {
                    document.documentElement.setAttribute('data-dewsecure-paused', 'true');
                    console.log('🛡️ [DewSecure] 命中白名单，已停止注入 CSS 与 Hook。');
                    window.postMessage({ type: 'DEWSECURE_PAUSE' }, '*');
                    return;
                }

                window.postMessage({ type: 'DEWSECURE_SETTINGS', settings }, '*');

                // 🚀 启动页面级钓鱼检测
                setTimeout(() => {
                    try { analyzePageForPhishing(); } catch (e) { console.warn(e); }
                }, 1000);

                setTimeout(() => {
                    if (settings.hideCookieNotices !== false || settings.hideAdPlaceholders !== false || settings.blockSocialTrackers !== false) {
                        injectDynamicCSS(settings);
                    }

                    const observer = new MutationObserver((mutations) => {
                        for (const m of mutations) {
                            if (m.type === 'childList') {
                                for (const node of m.addedNodes) {
                                    if (node.nodeType === Node.ELEMENT_NODE) scheduleCheck(node);
                                }
                            } else if (m.type === 'attributes') {
                                if (m.target.nodeType === Node.ELEMENT_NODE) {
                                    pendingAttr.add(m.target);
                                    if (!attrTimer) attrTimer = setTimeout(flushAttr, 80);
                                }
                            }
                        }
                    });
                    observer.observe(document.documentElement, {
                        childList: true, subtree: true,
                        attributes: true, attributeFilter: ['class', 'id'],
                    });
                    if (document.body) { scheduleCheck(document.body); }
                }, 100);
            });
        } catch(e) {}
    }

    init();
})();

// ==========================================
// 监听消息（放在 IIFE 外部）
// ==========================================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'TOGGLE_PROTECTION') {
        if (msg.enabled === false) {
            document.documentElement.setAttribute('data-dewsecure-paused', 'true');
            const s1 = document.getElementById('__dewsecure_style_all');
            if (s1) s1.remove();
            if (document.body) {
                document.body.style.setProperty('overflow', 'auto', 'important');
                document.documentElement.style.setProperty('overflow', 'auto', 'important');
            }
            console.warn('🛡️ [DewSecure] 已动态挂起，还原网页状态。');
        } else {
            location.reload();
        }
        sendResponse({ ok: true });
    }
});

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'HIDE_AI_AD' && msg.domain) {
        if (document.documentElement.getAttribute('data-dewsecure-paused') === 'true') return;
        const domain = msg.domain;
        console.log(`🛡️ [DewSecure] 正在执行 AI 软隐藏: ${domain}`);
        document.querySelectorAll('img').forEach(el => {
            if (el.src && el.src.includes(domain) && el.width <= 2 && el.height <= 2) {
                el.style.setProperty('display', 'none', 'important');
            }
        });
    }
});
