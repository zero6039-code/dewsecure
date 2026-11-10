export function initPerformanceMonitor(safeSendMessage) {
    try {
        const seenThirdParty = new Set();
        const observer = new PerformanceObserver((list) => {
            const newHosts = [];
            for (const entry of list.getEntries()) {
                try {
                    const urlObj = new URL(entry.name);
                    const host = urlObj.hostname;
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
                const MAX_BATCH = 20;
                for (let i = 0; i < newHosts.length; i += MAX_BATCH) {
                    safeSendMessage({ type: 'THIRD_PARTY_HOSTS', hosts: newHosts.slice(i, i + MAX_BATCH) });
                }
            }
        });
        observer.observe({ type: 'resource', buffered: true });
    } catch (e) {}
}
