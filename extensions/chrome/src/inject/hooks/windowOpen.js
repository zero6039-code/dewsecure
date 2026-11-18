// 🛡️ AD-3 修复：window.open 劫持与无手势弹窗拦截
export function initWindowOpenHook(ctx) {
    window.__dewsecureHasInteracted = false;
    const markInteraction = () => { window.__dewsecureHasInteracted = true; };
    window.addEventListener('mousedown', markInteraction, { capture: true, once: true });
    window.addEventListener('keydown', markInteraction, { capture: true, once: true });
    window.addEventListener('touchstart', markInteraction, { capture: true, once: true });

    try {
        const _windowOpen = window.open;
        const isSkidrow = window.location.hostname.includes('skidrowreloaded.com');

        const hookedOpen = function(url, target, features) {
            if (!ctx.isPaused() && window.__dewsecureHasInteracted === false) {
                console.warn('[DewSecure] 拦截无手势自动弹窗 (Popunder):', url);
                if (ctx.port) ctx.port.postMessage({ type: 'DEWSECURE_STAT_INCREMENT' });
                return null;
            }
            if (!ctx.isPaused() && isSkidrow) {
                if (url && !String(url).startsWith(location.origin) && !String(url).includes('skidrowreloaded.com')) {
                    console.warn('[DewSecure] 彻底封锁 Skidrow 跨域弹窗:', url);
                    if (ctx.port) ctx.port.postMessage({ type: 'DEWSECURE_STAT_INCREMENT' });
                    return null;
                }
            }
            if (!ctx.isPaused() && ctx.isAdUrl(url)) {
                console.warn('[DewSecure] 拦截恶意/劫持弹窗:', url);
                if (ctx.port) ctx.port.postMessage({ type: 'DEWSECURE_STAT_INCREMENT' });
                return null;
            }
            return _windowOpen.apply(this, arguments);
        };
        
        try { ctx.hookedFns.add(hookedOpen); } catch (e) {}
        Object.defineProperty(window, 'open', {
            get: function() { return hookedOpen; },
            set: function() { },
            configurable: true,
            enumerable: true
        });
    } catch (e) {
        try {
            const _fallbackOpen = window.open;
            window.open = function(url, target, features) {
                if (!ctx.isPaused() && ctx.isAdUrl(url) && window.navigator?.userActivation?.isActive === false) {
                    return null;
                }
                return _fallbackOpen.apply(this, arguments);
            };
        } catch(err) {}
    }
}
