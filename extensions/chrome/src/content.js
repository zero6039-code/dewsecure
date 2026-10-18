/**
 * =========================================================================
 * ⚠️ [DewSecure 终极稳定版 V1.0.0 - 严禁破坏] ⚠️
 * =========================================================================
 * 此文件已封版。目前的逻辑经过数十次真实测试（Skidrow、Spiegel、Wired 等），
 * 完美实现了：多标签页绝对隔离、白名单动态注入、暂停即刷新。
 * 
 * 🚫 严禁修改以下逻辑：
 * 1. popup.js 里的 setInterval(forceUpdateUI) 强制重绘逻辑。
 * 2. content.js 开头的 chrome.storage.local.get 异步白名单检查。
 * 3. 不要在此文件随意追加新的监听器，容易引发变量冲突。
 * =========================================================================
 */

(function () {
    'use strict';
    if (window.__dewsecureInjected) return;
    
    // ===== DewSecure Wired Bypass =====
    if (window.location.hostname.includes('wired.com')) {
        console.warn('🛡️ [DewSecure] 检测到 Wired，已自动豁免 DOM 清理以防止 React 水合失败。');
        return; // 退出，不执行任何 DOM 清理
    }
    // ===================================

    window.__dewsecureInjected = true;

    // ===== 调试开关（生产环境必须 false）=====
    const DEBUG = false;
    const warn = DEBUG ? console.warn.bind(console) : () => {};

    // ===== 调试开关（生产环境保持 false）=====
    const log  = DEBUG ? console.log.bind(console, '[DewSecure]')  : () => {};

    const AD_PATTERN      = /(^|[-_])(ad|ads|advert|banner|popup|sponsor|promo|overlay|modal|cookie|consent|push|tracking|tracker)([-_]|$)/i;
    const CAPTCHA_PATTERN = /(verify|captcha|challenge|puzzle|recaptcha|hcaptcha|turnstile)/i;

    // ===== CSS 注入：等 head 出现再 append（修复注入时机问题）=====
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

    // ===== CSS 1：基础广告 + 烦扰元素 =====
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

            /* ===== 终极强制滚动解锁（覆盖所有内联样式） ===== */
            html, body {
                overflow: auto !important;
                position: static !important;
                touch-action: auto !important;
            }
            .social-widget, .social-bar, .share-bar, .twitter-share-button,
            .fb-like, .fb-share-button, .social-share-overlay {
                display: none !important;
            }

            /* ===== 强力解除滚动锁定（应对 Guardian 等流氓网站） ===== */
            html, body {
                overflow-y: auto !important;
                overflow-x: auto !important;
                position: static !important;
                touch-action: auto !important;
            }

            /* ===== 终极解锁：针对 Spiegel 等极顽固网站 ===== */
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

    // ===== CSS 2：Ad Eraser 补分 + Skidrow 专用反反拦截 =====
    function injectExtraCSS() {
        const style = document.createElement('style');
        style.id = '__dewsecure_style_2';
        style.textContent = `
            /* --- Ad Eraser 补分 --- */
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

            /* --- Skidrow 专用反反拦截：诱饵 + 崩溃触发的兜底弹窗 --- */
            /* 诱饵元素（让它检测不到，脚本自然不会崩溃）*/
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
            iframe[src*="adexchangerapid"],
            iframe[src*="ntwkbc"],
            iframe[src*="usrpubtrk"],
            /* 全屏劫持层 / 弹窗遮罩 */
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

    injectBrutalCSS();
    injectExtraCSS();

    // ===== 批处理：属性变化（80ms 合并）=====
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
                }
            } catch (_) {}
        }
    }

    // ===== 批处理：新增节点（50ms 合并）=====
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

    function init() {
        chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (settings) => {
            if (!settings) return;
            const host = window.location.hostname;
            const matchDomain = (d) => host === d || host.endsWith('.' + d);
            const wl  = Array.isArray(settings.whitelist)     ? settings.whitelist     : [];
            const twl = Array.isArray(settings.tempWhitelist) ? settings.tempWhitelist : [];
            if (wl.some(matchDomain) || twl.some(matchDomain)) return;

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
            setInterval(killOverlays, 1500); // 兜底定期清理
        });
    }

    // ===== 新增：解除页面滚动锁定 =====
    function unlockScroll() {
        if (document.body && getComputedStyle(document.body).overflow === 'hidden') {
            document.body.style.setProperty('overflow', 'auto', 'important');
        }
        if (document.documentElement && getComputedStyle(document.documentElement).overflow === 'hidden') {
            document.documentElement.style.setProperty('overflow', 'auto', 'important');
        }
    }

    // ===== 新增：清理顽固的多层遮罩 / CMP 遮罩 =====


    function killOverlays() {
        unlockScroll(); // 每次清理时顺便解锁滚动
        const nodes = document.querySelectorAll('div, section, iframe');
        for (const el of nodes) {
            if (el.dataset.dwKilled) continue;
            try {
                const style = window.getComputedStyle(el);
                // 锁定全屏 / 高z-index遮罩
                if (style.position === 'fixed' && (parseInt(style.zIndex) > 9999 || style.zIndex === 'auto')) {
                    const rect = el.getBoundingClientRect();
                    if (rect.width > window.innerWidth * 0.8 && rect.height > window.innerHeight * 0.8) {
                        const text = (el.innerText || '').trim();
                        // 扩充特征词，精准识别各种语言和厂商的 CMP
                        const isCmp = /(cookie|consent|privacy|gdpr|ccpa|pipl|appi|rgpd|pdpa|popia|onetrust|didomi|cookiebot|usercentrics|quantcast|liveramp|borlabs|moove|klaro|termly)/i.test(text + ' ' + el.className + ' ' + el.id);
                        if (text === '' || parseFloat(style.opacity) < 0.1 || isCmp) {
                            if (!/(verify|captcha|challenge|puzzle|turnstile)/i.test(el.className + ' ' + el.id + ' ' + text)) {
                                el.style.setProperty('display', 'none', 'important');
                                el.dataset.dwKilled = 'true';
                                warn('killed overlay/cmp mask');
                            }
                        }
                    }
                }
            } catch (_) {}
        }
    }


    // ===== 强力持久解锁（针对 Spiegel 等动态锁定） =====
    function enforceScrollLock() {
        const forceStyle = (el) => {
            if (!el || !el.style) return;
            // 通过可见性和静态定位强行覆盖锁定
            el.style.setProperty('overflow-y', 'auto', 'important');
            el.style.setProperty('overflow-x', 'auto', 'important');
            el.style.setProperty('position', 'static', 'important');
            el.style.setProperty('touch-action', 'auto', 'important');
        };
        
        // 立即执行
        forceStyle(document.documentElement);
        if (document.body) forceStyle(document.body);

        // 监听 DOM 属性变化，只要网站敢加锁，我们瞬间解开
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

        // 拦截 touchmove 和 wheel 事件，防止网站通过事件拦截阻止滚动
        if (!window.__dw_event_blocked) {
            const blockEvent = e => {
                // 如果事件是由网站主动触发的禁止滚动逻辑，直接阻止
                if (e.target === document || e.target === document.body) {
                    e.stopImmediatePropagation();
                }
            };
            document.addEventListener('touchmove', blockEvent, { capture: true, passive: false });
            document.addEventListener('wheel', blockEvent, { capture: true, passive: false });
            window.__dw_event_blocked = true;
        }
    }
    
    // 初始化执行
    enforceScrollLock();
    setTimeout(enforceScrollLock, 500);
    setTimeout(enforceScrollLock, 2000);

    
    if (window.location.hostname.includes('forbes.com')) {
        let attempts = 0;
        const bypassForbes = setInterval(() => {
            // 策略 1: 寻找并模拟点击“跳过”或“继续”按钮
            const skipSelectors = [
                'a[href*="skip"]', 
                'button[class*="skip"]', 
                '[class*="welcome"] a[class*="continue"]',
                '[id*="welcome"] a[class*="continue"]'
            ];
            for (const sel of skipSelectors) {
                const btn = document.querySelector(sel);
                if (btn && !btn.dataset.dwClicked) {
                    btn.click();
                    btn.dataset.dwClicked = 'true';
                    warn('Forbes: Clicked skip/continue button');
                    break;
                }
            }

            // 策略 2: 暴力移除遮罩层，并尝试恢复被隐藏的正文内容
            const overlays = document.querySelectorAll('[class*="welcome"], [class*="adblock"], [class*="overlay"], [id*="welcome"]');
            overlays.forEach(el => {
                if (!el.dataset.dwKilled) {
                    el.style.setProperty('display', 'none', 'important');
                    el.remove();
                    el.dataset.dwKilled = 'true';
                }
            });
            // 尝试解除对正文容器的限制
            document.querySelectorAll('article, main, .article-body, [class*="content"]').forEach(el => {
                if (el.style.display === 'none' || el.style.visibility === 'hidden') {
                    el.style.setProperty('display', 'block', 'important');
                    el.style.setProperty('visibility', 'visible', 'important');
                }
            });

            if (++attempts > 20) clearInterval(bypassForbes);
        }, 500);
    }

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
                warn('killed overlay');
            } catch (_) {}
        }
        if (root.shadowRoot) checkAndKill(root.shadowRoot);
    }

    init();
})();
