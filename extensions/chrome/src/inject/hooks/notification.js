// 🛡️ AD-4 修复：系统通知请求拦截
export function initNotificationHook(ctx) {
    const NOTIFICATION_ALLOW_HOSTS = ['mail.google.com', 'calendar.google.com', 'outlook.live.com', 'outlook.office.com', 'web.whatsapp.com', 'web.telegram.org'];
    try {
        if (window.Notification) {
            const _requestPermission = window.Notification.requestPermission;
            const hookedRequestPermission = function(callback) {
                const h = location.hostname;
                const isAllowedHost = NOTIFICATION_ALLOW_HOSTS.some(d => h === d || h.endsWith('.' + d));

                if (isAllowedHost) {
                    return _requestPermission.apply(this, arguments);
                }

                if (!ctx.isPaused() && ctx.dwSettings.antiHijackEnabled !== false) {
                    const hasInteracted = window.__dewsecureHasInteracted;
                    const activation = navigator.userActivation && navigator.userActivation.isActive;

                    if (!hasInteracted && !activation) {
                        console.warn('[DewSecure] 拦截页面加载即请求通知权限的滥用行为:', h);
                        if (ctx.port) ctx.port.postMessage({ type: 'DEWSECURE_STAT_INCREMENT' });
                        // 🛡️ 信任边界修复：通道未建立时静默丢弃
                        if (callback) callback('denied');
                        return Promise.resolve('denied');
                    } else {
                        console.log('[DewSecure] 用户有交互行为，放行通知请求:', h);
                        return _requestPermission.apply(this, arguments);
                    }
                }
                return _requestPermission.apply(this, arguments);
            };
            try { ctx.hookedFns.add(hookedRequestPermission); } catch (e) {}
            window.Notification.requestPermission = hookedRequestPermission;
            try { ctx.hookedFns.add(window.Notification.requestPermission); } catch (e) {}
        }
    } catch(e) {}
}
