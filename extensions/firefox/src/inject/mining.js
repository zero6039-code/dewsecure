// 11. 挖矿与资源滥用检测 (A5 修复：不自动终止；A1 修复：Proxy 包装保留静态成员)
(function() {
    try {
        let workerCount = 0;
        let wasmCount = 0;
        let longTaskCount = 0;
        let socketCount = 0;
        let isMiningDetected = false;
        const activeWorkers = new Set();

        function getMiningI18n() {
            return {
                title: window.__dewsecureDict['mining_title'] || 'Resource Abuse Warning',
                desc: window.__dewsecureDict['mining_desc'] || 'This page is running high-intensity computational tasks...',
                btn: window.__dewsecureDict['mining_btn'] || 'Got it'
            };
        }

        function showMiningWarning() {
            const bannerId = 'dewsecure-mining-warning';
            if (document.getElementById(bannerId)) return;
            const banner = document.createElement('div');
            banner.id = bannerId;
            banner.style.cssText = `
                position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
                background: #f59e0b; color: white; padding: 12px 20px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 14px; display: flex; justify-content: space-between; align-items: center;
                box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            `;
            const t = getMiningI18n();
            banner.innerHTML = `
                <div>
                    <strong>⛔ ${t.title}</strong>
                    <div style="font-size: 12px; opacity: 0.9; margin-top: 4px;">${t.desc}</div>
                </div>
                <button id="dewsecure-mining-ignore" style="background: transparent; border: 1px solid white; color: white; padding: 4px 12px; border-radius: 4px; cursor: pointer;">${t.btn}</button>
            `;
            document.body.appendChild(banner);
            document.getElementById('dewsecure-mining-ignore').addEventListener('click', () => banner.remove());
        }

        function triggerMiningCheck() {
            if (isMiningDetected) return;
            // A5 修复：矿池协议/端口权重最高，资源使用只作辅助，且不自动终止
            let score = 0;
            let reasons = [];
            if (socketCount > 0) { score += 50; reasons.push('Mining-Pool-Port'); }
            if (workerCount >= 2) { score += 15; reasons.push('Worker>=2'); }
            if (wasmCount > 0) { score += 10; reasons.push('WASM'); }
            if (longTaskCount > 10) { score += 10; reasons.push('LongTask>10'); }

            if (score >= 60) {
                isMiningDetected = true;
                console.warn(`[DewSecure] 检测到疑似资源滥用 (得分: ${score})，仅提示不终止。原因: ${reasons.join(', ')}`);
                showMiningWarning();
            }
        }

        // A1 修复：Proxy 包装 Worker，保留 prototype / 静态成员 / name
        if (typeof window.Worker === 'function') {
            const NativeWorker = window.Worker;
            try {
                window.Worker = new Proxy(NativeWorker, {
                    construct(target, args, newTarget) {
                        const w = Reflect.construct(target, args, newTarget);
                        workerCount++;
                        activeWorkers.add(w);
                        try { w.addEventListener('error', () => activeWorkers.delete(w)); } catch (_) {}
                        triggerMiningCheck();
                        return w;
                    }
                });
            } catch (e) {}
        }

        // A1 修复：只包装 WebAssembly 的编译/实例化入口，不替换 Module
        if (window.WebAssembly) {
            for (const name of ['compile', 'instantiate', 'instantiateStreaming']) {
                const orig = WebAssembly[name];
                if (typeof orig !== 'function') continue;
                try {
                    WebAssembly[name] = new Proxy(orig, {
                        apply(target, thisArg, args) {
                            wasmCount++;
                            triggerMiningCheck();
                            return Reflect.apply(target, thisArg, args);
                        }
                    });
                } catch (e) {}
            }
        }

        // A1 修复：Proxy 包装 WebSocket，保留 OPEN / CONNECTING / CLOSED 等静态成员
        if (typeof window.WebSocket === 'function') {
            const NativeWS = window.WebSocket;
            const MINING_PORTS = [3333, 4444, 5555, 7777, 14433, 14444, 45700];
            try {
                window.WebSocket = new Proxy(NativeWS, {
                    construct(target, args, newTarget) {
                        try {
                            const u = new URL(String(args[0]));
                            const port = u.port ? parseInt(u.port, 10) : (u.protocol === 'wss:' ? 443 : 80);
                            if (MINING_PORTS.includes(port)) {
                                socketCount++;
                                triggerMiningCheck();
                            }
                        } catch (_) {}
                        return Reflect.construct(target, args, newTarget);
                    }
                });
            } catch (e) {}
        }

        // LongTask 监控：阈值提高到 >10，降低误报
        if (window.PerformanceObserver) {
            try {
                const obs = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        if (entry.duration > 50) {
                            longTaskCount++;
                            if (longTaskCount > 10) triggerMiningCheck();
                        }
                    }
                });
                obs.observe({ entryTypes: ['longtask'] });
            } catch (e) {}
        }
    } catch (e) {
        console.error('[DewSecure Inject] 挖矿防护初始化失败:', e);
    }
})();
