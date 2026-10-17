(function () {
    'use strict';
    
    let lastRealClick = 0;
    window.addEventListener('mousedown', () => { lastRealClick = Date.now(); }, true);
    window.addEventListener('click', () => { lastRealClick = Date.now(); }, true);

    const adPatterns = /(mmp_pid=|Allianceid=|from_affiliate=|url_from=affiliate|affiliate_id=|click_id=|sub_id=|campaign_id=|uls_trackid=|utm_campaign=|utm_source=an_|utm_source=InvolveAsia|utm_source=adcash|aid=api%7C|ud1=|cid=|1xlite|1xbet|tag=d_|omguk|tiktok\.com\/view|doubleclick|omgt3|popads|googlesyndication|clk\.|adsterra|propellerads|trip\.com|shopee\.com\.my|lazada\.com\.my|shein\.com\/ark|kkday\.com|klook\.com|opera\.com\/partner)/i;
    const isAdUrl = (url) => url && typeof url === 'string' && adPatterns.test(url);

    const _windowOpen = window.open;
    const _locationAssign = window.location.assign;
    const _locationReplace = window.location.replace;
    const _anchorClick = HTMLAnchorElement.prototype.click;

    // 1. 锁死 window.open
    try {
        Object.defineProperty(window, 'open', {
            get: function() {
                return function(url, target, features) {
                    if (isAdUrl(url)) {
                        console.warn('🛡️ [主世界拦截] 阻断 window.open:', url);
                        return null;
                    }
                    return _windowOpen.apply(this, arguments);
                };
            },
            set: function() {},
            configurable: false
        });
    } catch (e) {}

    // 2. 锁死 location 跳转
    try {
        window.location.assign = function(url) {
            if (isAdUrl(url)) { console.warn('🛡️ 阻断 assign'); return; }
            _locationAssign.call(window.location, url);
        };
        window.location.replace = function(url) {
            if (isAdUrl(url)) { console.warn('🛡️ 阻断 replace'); return; }
            _locationReplace.call(window.location, url);
        };
        const hrefDesc = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
        if (hrefDesc && hrefDesc.set) {
            Object.defineProperty(Location.prototype, 'href', {
                set: function(url) {
                    if (isAdUrl(url)) { console.warn('🛡️ 阻断 href'); return; }
                    hrefDesc.set.call(window.location, url);
                }
            });
        }
    } catch (e) {}

    // 3. 锁死伪造的 A 标签点击
    try {
        HTMLAnchorElement.prototype.click = function() {
            if (isAdUrl(this.href)) {
                console.warn('🛡️ [主世界拦截] 阻断伪造 A 标签点击:', this.href);
                return;
            }
            _anchorClick.apply(this, arguments);
        };
    } catch (e) {}

    // 4. 反反拦截欺骗
    try {
        Object.defineProperty(window, 'adblock', { get: () => false });
        Object.defineProperty(window, 'canRunAds', { get: () => true });
        Object.defineProperty(window, 'isAdBlockActive', { get: () => false });
    } catch (e) {}

    // 5. 最高优先级捕获拦截（解决首点竞态）
    const interceptClick = (e) => {
        let target = e.target;
        while (target && target.tagName !== 'A' && target.tagName !== 'FORM') {
            target = target.parentElement;
        }
        
        if (target) {
            if (target.tagName === 'A' && target.href && isAdUrl(target.href)) {
                e.preventDefault();
                e.stopImmediatePropagation();
                console.warn('🛡️ [主世界拦截] 捕获并阻断恶意点击:', target.href);
            }
            if (target.tagName === 'FORM' && target.action && isAdUrl(target.action)) {
                e.preventDefault();
                e.stopImmediatePropagation();
                console.warn('🛡️ [主世界拦截] 捕获并阻断恶意表单:', target.action);
            }
        }
    };
    document.addEventListener('mousedown', interceptClick, true);
    document.addEventListener('click', interceptClick, true);

    // 6. DOM 物理阉割（加入类名快筛，加快高频注入的处理）
    const killMaliciousNodes = (root) => {
        if (!root) return;
        const links = root.querySelectorAll ? root.querySelectorAll('a') : [];
        links.forEach(a => {
            if (a.href && isAdUrl(a.href) && !a.dataset.dwKilled) {
                a.removeAttribute('href');
                a.removeAttribute('target');
                a.style.setProperty('pointer-events', 'none', 'important');
                a.dataset.dwKilled = 'true';
                console.warn('🛡️ [主进程] 物理拔除恶意 A 标签:', a.href);
            }
        });
    };

    const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    // 快速隐藏广告类名节点（不依赖CSS加载）
                    if (node.className && typeof node.className === 'string') {
                        if (/(ad-|ads-|banner|popup|sponsor|promo|overlay|modal)/i.test(node.className)) {
                            node.style.setProperty('display', 'none', 'important');
                        }
                    }
                    killMaliciousNodes(node);
                }
            }
        }
    });
    
    if (document.documentElement) {
        observer.observe(document.documentElement, { childList: true, subtree: true });
        killMaliciousNodes(document.documentElement);
    }

    // 节流兜底（降低 CPU 占用）
    setInterval(() => { killMaliciousNodes(document.documentElement); }, 250);
})();
