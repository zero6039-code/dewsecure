(function () {
    'use strict';
    if (window.__dewsecureInjected) return;
    window.__dewsecureInjected = true;

    // 1. 最早期注入暴力 CSS（秒杀常见烦扰元素，不依赖 JS 扫描）
    function injectBrutalCSS() {
        const style = document.createElement('style');
        style.textContent = `
            /* 基础广告单元与追踪像素 */
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
            
            /* 烦扰元素：Cookie、退出意图、订阅弹窗、通知提示 */
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

            /* 特定广告容器 */
            .floating-ad, .video-ad, .google_ads_iframe, .OUTBRAIN, .taboola,
            .in-article-ad, .dfp-ad, .gpt-ad {
                display: none !important;
                pointer-events: none !important;
            }

            /* 社交组件 */
            .social-widget, .social-bar, .share-bar, .twitter-share-button, 
            .fb-like, .fb-share-button, .social-share-overlay {
                display: none !important;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }
    injectBrutalCSS();

    // 2. 监听并清理动态生成的烦扰元素
    async function init() {
        chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (settings) => {
            if (!settings) return;
            const host = window.location.hostname;
            const matchDomain = (d) => host === d || host.endsWith('.' + d);
            
            const wl = Array.isArray(settings.whitelist) ? settings.whitelist : [];
            const twl = Array.isArray(settings.tempWhitelist) ? settings.tempWhitelist : [];
            
            if (wl.some(matchDomain) || twl.some(matchDomain)) return;

            const observer = new MutationObserver((mutations) => {
                for (const m of mutations) {
                    if (m.type === 'childList') {
                        for (const node of m.addedNodes) {
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                checkAndKill(node);
                            }
                        }
                    } else if (m.type === 'attributes') {
                        const node = m.target;
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            // 如果 class 或 id 变成广告特征，直接杀掉
                            if (/(ad-|ads-|banner|popup|sponsor|promo|overlay|modal|cookie|consent|push)/i.test(node.className + ' ' + node.id)) {
                                node.style.setProperty('display', 'none', 'important');
                            }
                        }
                    }
                }
            });
            
            observer.observe(document.documentElement, { 
                childList: true, 
                subtree: true,
                attributes: true,
                attributeFilter: ['class', 'id'] // 监听类名和 ID 改变
            });
            checkAndKill(document.body);
        });
    }

    function checkAndKill(root) {
        if (!root) return;
        
        const elements = root.querySelectorAll ? root.querySelectorAll('div, iframe') : [];
        elements.forEach(el => {
            if (el.dataset.dwKilled) return;
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            
            // 清理全屏透明遮罩
            if (style.position === 'fixed' || style.position === 'absolute') {
                const isLarge = rect.width > window.innerWidth * 0.8 && rect.height > window.innerHeight * 0.8;
                const isInvisible = parseFloat(style.opacity) < 0.1 || (el.innerText || '').trim() === '';
                const zIndex = parseInt(style.zIndex, 10) || 0;
                
                if (isLarge && (isInvisible || zIndex > 1000)) {
                    if (/(verify|captcha|challenge|puzzle)/i.test(el.className + el.id + el.innerText)) return;
                    
                    el.style.setProperty('pointer-events', 'none', 'important');
                    el.style.setProperty('display', 'none', 'important');
                    el.dataset.dwKilled = 'true';
                    console.warn('🛡️ [DOM清理] 秒杀透明劫持层');
                }
            }
        });

        // 穿透 Shadow DOM
        if (root.shadowRoot) {
            checkAndKill(root.shadowRoot);
        }
    }

    init();
})();
