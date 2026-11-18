// 🚀 P-6 优化：DOM 节点清理与 MutationObserver
export function initDomCleanupHook(ctx) {
    const checkAndKillNode = (el) => {
        if (el.dataset.dwKilled) return;

        if (window.location.hostname.includes('skidrowreloaded.com')) {
            if (el.id === 'dontfold' || (el.tagName === 'DIV' && el.style.position === 'fixed' && el.style.zIndex > 999)) {
                console.warn('[DewSecure] 发现 Skidrow 点击劫持遮罩层，已拔除');
                if (ctx.port) ctx.port.postMessage({ type: 'DEWSECURE_STAT_INCREMENT' });
                el.remove();
                return;
            }
        }
        if (el.tagName === 'A' && el.href && ctx.isAdUrl(el.href)) {
            if (ctx.port) ctx.port.postMessage({ type: 'DEWSECURE_STAT_INCREMENT' });
            el.removeAttribute('href'); el.style.setProperty('pointer-events', 'none', 'important'); el.dataset.dwKilled = 'true';
        } else if (el.tagName === 'FORM' && el.action && ctx.isAdUrl(el.action)) {
            el.removeAttribute('action'); el.style.setProperty('pointer-events', 'none', 'important'); el.dataset.dwKilled = 'true';
        }
        else if (el.tagName === 'A' && el.href) {
            try {
                const style = window.getComputedStyle(el);
                if (parseFloat(style.opacity) < 0.1 &&
                    (parseInt(style.width) > window.innerWidth * 0.5 || parseInt(style.height) > window.innerHeight * 0.5)) {
                    console.warn('[DewSecure] 检测到点击劫持(Clickjacking) 透明层，已摧毁:', el.href);
                    if (ctx.port) ctx.port.postMessage({ type: 'DEWSECURE_STAT_INCREMENT' });
                    el.removeAttribute('href');
                    el.style.setProperty('pointer-events', 'none', 'important');
                    el.dataset.dwKilled = 'true';
                }
            } catch (e) {}
        }
    };

    const killMaliciousNodes = (root) => {
        if (ctx.isPaused() || !root) return;
        if (root.nodeType === Node.ELEMENT_NODE) checkAndKillNode(root);
        const links = root.querySelectorAll ? root.querySelectorAll('a, form') : [];
        links.forEach(checkAndKillNode);
    };

    const nodeQueue = new Set();
    let scheduled = false;
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
        let processed = 0;
        for (const node of nodeQueue) {
            nodeQueue.delete(node);
            if (node.isConnected) {
                try {
                    if (node.className && typeof node.className === 'string' && /(^ad-slot|^ad-banner|^ad-wrapper|^ad-container|^adsbygoogle|^sponsored-ad|^advertisement)/i.test(node.className)) {
                        node.style.setProperty('display', 'none', 'important');
                    }
                    killMaliciousNodes(node);
                } catch (e) {}
            }
            processed++;
            if (processed >= 100) break;
        }
        scheduled = false;
        if (nodeQueue.size > 0) {
            scheduled = true;
            channel.port2.postMessage(null);
        }
    };

    const observer = new MutationObserver((mutations) => {
        if (ctx.isPaused()) return;
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    nodeQueue.add(node);
                }
            }
        }
        if (!scheduled && nodeQueue.size > 0) {
            scheduled = true;
            channel.port2.postMessage(null);
        }
    });

    const startObserver = () => {
        if (!document.documentElement) return;
        observer.observe(document.documentElement, { childList: true, subtree: true });
        killMaliciousNodes(document.documentElement);
    };

    if (document.documentElement) {
        startObserver();
    } else if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startObserver);
    } else {
        window.addEventListener('load', startObserver);
    }
}
