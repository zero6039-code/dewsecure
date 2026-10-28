(function () {
    'use strict';
    
    // 🌟 官网与本地开发环境白名单
    if (['dewsecure.com', 'localhost', '127.0.0.1'].includes(window.location.hostname)) {
        console.log('🛡️ [DewSecure] 官方域名与本地环境，已自动跳过内容清理。');
        return;
    }

    if (window.__dewsecureInjected) return;
    
    // ===== DewSecure Wired Bypass =====
    if (window.location.hostname.includes('wired.com')) {
        console.warn('🛡️ [DewSecure] 检测到 Wired，已自动豁免 DOM 清理以防止 React 水合失败。');
        return; 
    }

    window.__dewsecureInjected = true;

    // ===== 调试开关 =====
    const DEBUG = false;
    const warn = DEBUG ? console.warn.bind(console) : () => {};
    const log  = DEBUG ? console.log.bind(console, '[DewSecure]')  : () => {};

    const AD_PATTERN      = /(^|[-_])(ad|ads|advert|banner|popup|sponsor|promo|overlay|modal|cookie|consent|push|tracking|tracker)([-_]|$)/i;
    const CAPTCHA_PATTERN = /(verify|captcha|challenge|puzzle|recaptcha|hcaptcha|turnstile)/i;

    // ===== 统一封装安全的消息发送 =====
    function safeSendMessage(msg) {
        try {
            if (chrome.runtime && chrome.runtime.id) {
                chrome.runtime.sendMessage(msg).catch(() => {});
            }
        } catch (e) {}
    }

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

    // ===== 注入 CSS 1 =====
    function injectBrutalCSS() {
        const style = document.createElement('style');
        style.id = '__dewsecure_style_1';
        style.textContent = `
            .ad-banner, .ad-container, .ad-slot, .ad-wrapper, .ad-unit,
            .ad-panel, .ad-box, .ad-frame, .ad-iframe, .ad-sticky, .ad-overlay,
            [data-ad], [data-ad-slot], [data-ad-unit], [data-google-query-id],
            ins.adsbygoogle, iframe[src*="doubleclick"], iframe[id*="google_ads_iframe"],
            .native-ad, .sponsored, .promoted, .advertisement {
                display: none !important;
                opacity: 0 !important;
                pointer-events: none !important;
                visibility: hidden !important;
            }
            #cookie-banner, .cookie-consent, [id*="cookie-notice"], [class*="cookie-banner"],
            .gdpr-banner, #gdpr, [class*="gdpr"], .consent-bar, .cookie-snackbar, .cookie-toast,
            #onetrust-consent-sdk, .optanon-alert-box-wrapper, #didomi-notice, #cookiebot,
            .cc-window, .cli-modal, .moove-gdpr-infobar, .borlabs-cookie-box,
            .exit-intent-popup, .exit-overlay, .newsletter-popup, .subscribe-box,
            .notification-prompt, .push-notification-bar, .app-download-banner,
            #onesignal-slidedown-container, .onesignal-slidedown-container,
            #pushcrew-chrome-style-notification, #webpushr-prompt-wrapper,
            #cleverpush-panel, .pushowl-notification-prompt, .fcm-notification-prompt,
            .smart-banner, .promo-banner, .promo-widget, .welcome-mat,
            .adblock-wall, .adblock-notice, .anti-adblock-overlay, .adblock-banner,
            .adblock-warning, .adblock-detected-modal {
                display: none !important;
                pointer-events: none !important;
            }
            .floating-ad, .video-ad, .google_ads_iframe, .OUTBRAIN, .taboola,
            .in-article-ad, .dfp-ad, .gpt-ad {
                display: none !important;
                pointer-events: none !important;
            }
            html, body {
                overflow: auto !important;
                position: static !important;
                touch-action: auto !important;
            }
            .social-widget, .social-bar, .share-bar, .twitter-share-button,
            .fb-like, .fb-share-button, .social-share-overlay {
                display: none !important;
            }
            html, body, #app, #root, .main-wrapper, #page-wrapper {
                overflow-y: visible !important;
                overflow-x: visible !important;
                position: static !important;
                height: auto !important;
                max-height: none !important;
            }
            body.no-scroll, body.modal-open, body.overflow-hidden, body.stopped,
            html.no-scroll, html.modal-open, html.overflow-hidden, html.stopped {
                overflow-y: auto !important;
                overflow-x: auto !important;
                position: static !important;
            }
        `;
        appendStyleWhenReady(style, '__dewsecure_style_1');
    }

    // ===== 注入 CSS 2 =====
    function injectExtraCSS() {
        const style = document.createElement('style');
        style.id = '__dewsecure_style_2';
        style.textContent = `
            #adLeaderboard, #adFrame, #ad-space, #ad-content, #ad-area, #ad-zone,
            #ad-panel, #adUnit, #adSlot, #adBox, #div-gpt-ad, #google_ads_frame,
            #adWrapper, #adBanner, #adContainer, #floating-ad, #popup-ad,
            #in-article-ad, #middle-ad, #left-ad, #right-ad, #top-ad, #sidebar-ad,
            #leaderboard-ad, #banner-ad, #ad-footer, #ad-header, #ad-sidebar,
            #ad-bottom, #ad-top, #advertisement, #ad-wrapper, #ad-slot,
            #ad-banner, #ad-container,
            .text-ad, .textad, .advertorial, .branded-content, .content-recommendation,
            .paid-content, .partner-content, .dianomi-ad, .adblade, .ntv-ad,
            .zergnet-widget, .rc-widget, .mgid-widget, .amazon-adsystem,
            .pubmatic-ad, .criteo-ad, .outbrain-widget, .trc_rbox,
            .google-ads, .google-ad, .adsbygoogle,
            .adverts, .advert, .adcontainer, .adslot, .adunit, .adblock,
            .affiliate-link, .shopping-ad, .product-listing-ad, .companion-ad,
            .postroll-ad, .midroll-ad, .preroll-ad,
            .social-icons-bar, .follow-widget, .adsbox, .adzone,
            [data-ad-source], [data-ad-provider], [data-adzone], [data-ad-placement],
            [data-ad-manager], [data-adunit], [data-dfp-ad], [data-ad-zone],
            [data-ad-id], [data-ad-network], [data-ad-format], [data-ad-size],
            [data-ad-position], [data-ad-type],
            [aria-label="sponsored"], [aria-label="ad"], [aria-label="advertisement"],
            .osano-cm-window, #iubenda-cs-banner, .cky-consent-container,
            #usercentrics-root, #truste-consent-track, #qc-cmp2-container,
            #sd-cmp, #evidon-banner, .fc-consent-root, #consent_blackbar,
            .securiti-cmp, .admiral-cmp, .sp_message_container,
            .cookie-top-bar, .floating-cookie-notice, .privacy-banner,
            #eu-cookie-law, .eu-cookie-law, .ccpa-banner, .generic-cookie-message,
            .generic-cookie-bar, .pipl-banner, .appi-banner, .rgpd-banner,
            .dsgvo-banner, .pdpa-banner, .popia-banner, .lgpd-banner,
            .cookie-notice, .cookie-consent,
            #pushowl-widget, #pushengage-subscribe, #aimtell-prompt,
            #optimonk-popup, #optimonk-popup-container,
            .notification-bell-widget, .push-bell, .push-notification-prompt,
            .adblock-modal,
            #ad-banner, #ad_banner, .ad_banner,
            #popup-ad, .popup-ad, #popupAd, .popupAd,
            #ad_overlay, .ad_overlay, #ad-overlay, .ad-overlay,
            #interstitial-ad, .interstitial-ad, #interstitialAd, .interstitialAd,
            #detected-popup, .detected-popup,
            #adblock-popup, .adblock-popup,
            #adblock-detected, .adblock-detected,
            #anti-adblock, .anti-adblock,
            #adexchanger, .adexchanger,
            div[data-ad-id], div[data-adzone], div[data-ad-client],
            iframe[src*="adexchangerapid"], iframe[src*="ntwkbc"], iframe[src*="usrpubtrk"],
            body > div[style*="position:fixed"][style*="z-index:9"],
            body > div[style*="position: fixed"][style*="z-index: 9"] {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
                pointer-events: none !important;
            }
        `;
        appendStyleWhenReady(style, '__dewsecure_style_2');
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
                    reportDomHidden(el); // 🌟 上报统计
                }
            } catch (_) {}
        }
    }

    // ===== 批处理：新增节点 =====
    const pendingCheck = new Set();
    let checkTimer = null;
    function flushCheck() {
        checkTimer = null;
        if (pendingCheck.size === 0) return;
        const batch = Array.from(pendingCheck);
        pendingCheck.clear();
        for (const el of batch) checkAndKill(el);
    }
    
    function scheduleCheck(el) {
        if (!el) return;
        pendingCheck.add(el);
        if (checkTimer) return;
        checkTimer = setTimeout(flushCheck, 50);
    }

    // ===== 初始化 =====
    function init() {
        safeSendMessage({ type: 'GET_SETTINGS' });
        
        // 由于 sendMessage 没有回调（为了速度），这里用延迟加载或直接依赖 background 的白名单拦截
        // 但我们仍在本地做一次兜底检查
        setTimeout(() => {
            const wl = []; // 依赖后台动态注入 TOGGLE_PROTECTION
            // 这里直接开启清理，如果设置了白名单，后台会发送 TOGGLE_PROTECTION(false) 来挂起
            injectBrutalCSS();
            injectExtraCSS();

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
            if (document.body) { scheduleCheck(document.body); killOverlays(); }
            setInterval(killOverlays, 1500);
        }, 100);
    }

    // ===== 解除页面滚动锁定 =====
    function unlockScroll() {
        if (document.body && getComputedStyle(document.body).overflow === 'hidden') {
            document.body.style.setProperty('overflow', 'auto', 'important');
        }
        if (document.documentElement && getComputedStyle(document.documentElement).overflow === 'hidden') {
            document.documentElement.style.setProperty('overflow', 'auto', 'important');
        }
    }

    // ===== 清理顽固的多层遮罩 / CMP 遮罩 =====
    function killOverlays() {
        unlockScroll();
        const nodes = document.querySelectorAll('div, section, iframe');
        for (const el of nodes) {
            if (el.dataset.dwKilled) continue;
            try {
                const style = window.getComputedStyle(el);
                if (style.position === 'fixed' && (parseInt(style.zIndex) > 9999 || style.zIndex === 'auto')) {
                    const rect = el.getBoundingClientRect();
                    if (rect.width > window.innerWidth * 0.8 && rect.height > window.innerHeight * 0.8) {
                        const text = (el.innerText || '').trim();
                        const isCmp = /(cookie|consent|privacy|gdpr|ccpa|pipl|appi|rgpd|pdpa|popia|onetrust|didomi|cookiebot|usercentrics|quantcast|liveramp|borlabs|moove|klaro|termly)/i.test(text + ' ' + el.className + ' ' + el.id);
                        if (text === '' || parseFloat(style.opacity) < 0.1 || isCmp) {
                            if (!/(verify|captcha|challenge|puzzle|turnstile)/i.test(el.className + ' ' + el.id + ' ' + text)) {
                                el.style.setProperty('display', 'none', 'important');
                                el.dataset.dwKilled = 'true';
                                reportDomHidden(el); // 🌟 上报统计
                                warn('killed overlay/cmp mask');
                            }
                        }
                    }
                }
            } catch (_) {}
        }
    }

    // ===== 强力持久解锁 =====
    function enforceScrollLock() {
        const forceStyle = (el) => {
            if (!el || !el.style) return;
            el.style.setProperty('overflow-y', 'auto', 'important');
            el.style.setProperty('overflow-x', 'auto', 'important');
            el.style.setProperty('position', 'static', 'important');
            el.style.setProperty('touch-action', 'auto', 'important');
        };
        
        forceStyle(document.documentElement);
        if (document.body) forceStyle(document.body);

        if (!window.__dw_scroll_obs) {
            window.__dw_scroll_obs = new MutationObserver(() => {
                forceStyle(document.documentElement);
                if (document.body) forceStyle(document.body);
            });
            window.__dw_scroll_obs.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
            if (document.body) {
                window.__dw_scroll_obs.observe(document.body, { attributes: true, attributeFilter: ['style', 'class'] });
            }
        }

        if (!window.__dw_event_blocked) {
            const blockEvent = e => {
                if (e.target === document || e.target === document.body) {
                    e.stopImmediatePropagation();
                }
            };
            document.addEventListener('touchmove', blockEvent, { capture: true, passive: false });
            document.addEventListener('wheel', blockEvent, { capture: true, passive: false });
            window.__dw_event_blocked = true;
        }
    }
    
    enforceScrollLock();
    setTimeout(enforceScrollLock, 500);
    setTimeout(enforceScrollLock, 2000);

    // ===== Forbes 专项处理 =====
    if (window.location.hostname.includes('forbes.com')) {
        let attempts = 0;
        const bypassForbes = setInterval(() => {
            const skipSelectors = [
                'a[href*="skip"]', 'button[class*="skip"]', 
                '[class*="welcome"] a[class*="continue"]', '[id*="welcome"] a[class*="continue"]'
            ];
            for (const sel of skipSelectors) {
                const btn = document.querySelector(sel);
                if (btn && !btn.dataset.dwClicked) {
                    btn.click();
                    btn.dataset.dwClicked = 'true';
                    break;
                }
            }
            const overlays = document.querySelectorAll('[class*="welcome"], [class*="adblock"], [class*="overlay"], [id*="welcome"]');
            overlays.forEach(el => {
                if (!el.dataset.dwKilled) {
                    el.style.setProperty('display', 'none', 'important');
                    el.remove();
                    el.dataset.dwKilled = 'true';
                    reportDomHidden(el); // 🌟 上报统计
                }
            });
            document.querySelectorAll('article, main, .article-body, [class*="content"]').forEach(el => {
                if (el.style.display === 'none' || el.style.visibility === 'hidden') {
                    el.style.setProperty('display', 'block', 'important');
                    el.style.setProperty('visibility', 'visible', 'important');
                }
            });
            if (++attempts > 20) clearInterval(bypassForbes);
        }, 500);
    }

    // ===== 节点扫描与击毙 =====
    function checkAndKill(root) {
        if (!root) return;
        const elements = root.querySelectorAll ? root.querySelectorAll('div, iframe, ins, section, aside') : [];
        for (const el of elements) {
            if (el.dataset.dwKilled) continue;
            try {
                const style = window.getComputedStyle(el);
                if (style.position !== 'fixed' && style.position !== 'absolute') continue;
                const rect = el.getBoundingClientRect();
                const isLarge = rect.width > window.innerWidth * 0.8 && rect.height > window.innerHeight * 0.8;
                if (!isLarge) continue;
                const isInvisible = parseFloat(style.opacity) < 0.1 || (el.innerText || '').trim() === '';
                const zIndex = parseInt(style.zIndex, 10) || 0;
                if (!isInvisible && zIndex <= 1000) continue;
                if (CAPTCHA_PATTERN.test(el.className + el.id + el.innerText)) continue;

                el.style.setProperty('pointer-events', 'none', 'important');
                el.style.setProperty('display', 'none', 'important');
                el.dataset.dwKilled = 'true';
                reportDomHidden(el); // 🌟 上报统计
                warn('killed overlay');
            } catch (_) {}
        }
        if (root.shadowRoot) checkAndKill(root.shadowRoot);
    }

    init();
})();


// ==========================================
// 钓鱼网站全屏警告拦截 (PRO 卖点)
// ==========================================
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'PHISHING_DETECTED') {
        if (document.getElementById('__dewsecure_phishing_wall')) return;
        
        const wall = document.createElement('div');
        wall.id = '__dewsecure_phishing_wall';
        wall.innerHTML = `
            <div style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:#c0392b;color:white;z-index:2147483647;display:flex;flex-direction:column;justify-content:center;align-items:center;font-family:-apple-system,BlinkMacSystemFont,sans-serif;text-align:center;padding:20px;box-sizing:border-box;">
                <div style="font-size:80px;margin-bottom:20px;">⚠️</div>
                <h1 style="font-size:36px;margin:0 0 16px 0;font-weight:bold;">极度危险：钓鱼网站</h1>
                <p style="font-size:18px;max-width:600px;line-height:1.5;opacity:0.9;">DewSecure AI 引擎检测到该网站试图伪装成合法机构，以窃取您的密码、信用卡或个人信息。为了保护您的财产安全，页面已被强制锁定。</p>
                <button id="__dewsecure_ignore_phishing" style="margin-top:30px;padding:12px 24px;font-size:16px;border:none;border-radius:8px;background:rgba(255,255,255,0.2);color:white;cursor:pointer;">我是专家，忽略风险继续访问</button>
            </div>
        `;
        document.documentElement.appendChild(wall);
        document.documentElement.style.setProperty('overflow', 'hidden', 'important');
        
        document.getElementById('__dewsecure_ignore_phishing').onclick = () => {
            wall.remove();
            document.documentElement.style.removeProperty('overflow');
        };
    }
});


// 🌟 动态挂起/恢复拦截
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'TOGGLE_PROTECTION') {
        if (msg.enabled === false) {
            document.documentElement.setAttribute('data-dewsecure-paused', 'true');
            const s1 = document.getElementById('__dewsecure_style_1');
            const s2 = document.getElementById('__dewsecure_style_2');
            if (s1) s1.remove();
            if (s2) s2.remove();
            if (document.body) {
                document.body.style.setProperty('overflow', 'auto', 'important');
                document.documentElement.style.setProperty('overflow', 'auto', 'important');
            }
            window.postMessage({ type: 'DEWSECURE_PAUSE' }, '*');
            console.warn('🛡️ [DewSecure] 已动态挂起，还原网页状态。');
        } else {
            location.reload();
        }
        sendResponse({ ok: true });
    }
});
