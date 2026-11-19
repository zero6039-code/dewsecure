// A 标签点击、Form 提交与点击事件拦截
export function initDomNavigationHook(ctx) {
    const _anchorClick = HTMLAnchorElement.prototype.click;
    const _formSubmit = HTMLFormElement.prototype.submit;

    // 3. A 标签点击
    try {
        const hookedClick = function() {
            if (!ctx.isPaused()) {
                if (ctx.isAdUrl(this.href)) return;
                if (window.location.hostname.includes('skidrowreloaded.com') && this.href && !this.href.startsWith(location.origin) && !this.href.includes('skidrowreloaded.com')) {
                    console.warn('[DewSecure] 拦截 Skidrow 脚本强制点击跳转:', this.href);
                    return;
                }
                if (this.target && this.target !== '_self' && this.href && !this.href.startsWith(location.origin)) {
                    if (window.event && window.event.isTrusted) {
                        // 真实点击放行
                    } else {
                        console.warn('[DewSecure] 拦截脚本模拟的跨域弹窗:', this.href);
                        return;
                    }
                }
            }
            _anchorClick.apply(this, arguments);
        };
        try { ctx.hookedFns.add(hookedClick); } catch (e) {}
        HTMLAnchorElement.prototype.click = hookedClick;
        try { ctx.hookedFns.add(HTMLAnchorElement.prototype.click); } catch (e) {}
    } catch (e) {}

    // 4. Form 提交
    try {
        HTMLFormElement.prototype.submit = function() {
            if (!ctx.isPaused() && ctx.isAdUrl(this.action)) return;
            _formSubmit.apply(this, arguments);
        };
    } catch (e) {}

    // 5 & 6. 反反拦截欺骗 & Skidrow 专项防护
    if (!ctx.isPaused() && ctx.dwSettings.antiBypassEnabled !== false) {
        try {
            Object.defineProperty(window, 'adblock', { get: () => false, configurable: true });
            Object.defineProperty(window, 'canRunAds', { get: () => true, configurable: true });
        } catch(e) {}
    }
    if (window.location.hostname.includes('skidrowreloaded.com') && !ctx.isPaused()) {
        try {
            Object.defineProperty(window, 'clickIE4', { get: () => undefined, set: () => {}, configurable: false });
        } catch(e) {}
    }

    // 7. 点击拦截捕获
    const interceptClick = (e) => {
        if (ctx.isPaused()) return;
        if (e.isTrusted === false) {
            let t = e.target;
            while (t && t.tagName !== 'A') t = t.parentElement;
            if (t && t.href && !t.href.startsWith(location.origin)) {
                console.warn('[DewSecure] 拦截非信任点击 (隐形锁点):', t.href);
                e.preventDefault(); e.stopImmediatePropagation();
                return;
            }
        }
        let target = e.target;
        while (target && target.tagName !== 'A' && target.tagName !== 'FORM') target = target.parentElement;

        if (window.location.hostname.includes('skidrowreloaded.com') && !e.target.closest('a')) {
            if (e.target.id === 'dontfold' || e.target.tagName === 'BODY') {
                if (e.target.id === 'dontfold') {
                    e.preventDefault(); e.stopImmediatePropagation();
                    return;
                }
            }
        }

        if (target) {
            if (target.tagName === 'A' && target.href && ctx.isAdUrl(target.href)) {
                e.preventDefault(); e.stopImmediatePropagation();
                return;
            }
            if (target.tagName === 'FORM' && target.action && ctx.isAdUrl(target.action)) {
                e.preventDefault(); e.stopImmediatePropagation();
                return;
            }
            if (window.location.hostname.includes('skidrowreloaded.com')) {
                if (target.tagName === 'A' && target.href && !target.href.startsWith(location.origin)) {
                    const isTracking = ctx.AFFILIATE_PARAMS.some(p => target.href.includes(p)) || target.href.includes('utm_');
                    if ((target.target && target.target !== '_self') || e.ctrlKey || e.metaKey || isTracking) {
                        console.warn('[DewSecure] 根据行为特征彻底封杀恶意跳转:', target.href);
                        if (ctx.port) ctx.port.postMessage({ type: 'DEWSECURE_STAT_INCREMENT' });
                        e.preventDefault(); e.stopImmediatePropagation();
                    }
                }
            }
        }
    };
    document.addEventListener('mousedown', interceptClick, true);
    document.addEventListener('click', interceptClick, true);
}
