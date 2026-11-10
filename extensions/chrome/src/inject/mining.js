// ==========================================
// 🛡️ 挖矿与资源滥用检测 (F-7 协议特征拦截)
// ==========================================
(function() {
    try {
        console.log('🛡️ [DewSecure] 挖矿检测引擎已启动');
        
        let workerCount = 0;
        let wasmCount = 0;
        let longTaskCount = 0;
        let socketCount = 0;
        let isMiningDetected = false;
        let protocolDetected = false;
        let suspiciousWsCount = 0;

        // 获取语言包
        function getMiningI18n() {
            const dict = window.__dewsecureDict || {};
            return {
                title: dict['mining_title'] || 'Resource Abuse Warning',
                desc: dict['mining_desc'] || 'High-intensity tasks detected.',
                btn: dict['mining_btn'] || 'Got it'
            };
        }

        function showMiningWarning() {
            const bannerId = 'dewsecure-mining-warning';
            if (document.getElementById(bannerId)) return;
            const t = getMiningI18n();
            const host = document.createElement('aside');
            host.id = bannerId;
            host.style.cssText = 'display: block !important; position: fixed !important; top: 0 !important; left: 0 !important; right: 0 !important; z-index: 2147483647 !important;';
            const shadow = host.attachShadow({ mode: 'closed' });
            // 🚀 UI 优化：使用 Flex 布局 + 内联 SVG 水滴 Logo，适配所有多语言长文本
            shadow.innerHTML = `
                <div style="background: #f59e0b; color: white; padding: 14px 20px; display: flex; justify-content: space-between; align-items: flex-start; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                    <div style="display: flex; align-items: flex-start; flex: 1; gap: 12px; margin-right: 16px;">
                        <!-- DewSecure 💧 Logo (SVG) -->
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; margin-top: 2px;">
                            <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path>
                        </svg>
                        <div style="flex: 1;">
                            <strong style="font-size: 15px; display: block; margin-bottom: 2px;">${t.title}</strong>
                            <div style="font-size: 13px; opacity: 0.9; line-height: 1.4;">${t.desc}</div>
                        </div>
                    </div>
                    <button id="close-mining" style="flex-shrink: 0; background: transparent; border: 1px solid white; color: white; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 13px; transition: background 0.2s; white-space: nowrap;">${t.btn}</button>
                </div>
            `;
            document.documentElement.appendChild(host);
            shadow.getElementById('close-mining').addEventListener('click', () => host.remove());
        }

        function triggerMiningCheck() {
            if (isMiningDetected) return;
            let score = 0;
            let reasons = [];
            
            if (protocolDetected) { score += 60; reasons.push('Stratum-Protocol'); }
            if (socketCount > 0) { score += 50; reasons.push('Mining-Port'); }
            if (suspiciousWsCount > 0) { score += 40; reasons.push('Suspicious-WS-URL'); }
            if (workerCount >= 2) { score += 30; reasons.push('Worker>=2'); }
            if (wasmCount > 0) { score += 20; reasons.push('WASM'); }
            if (longTaskCount > 10) { score += 15; reasons.push('LongTask>10'); }

            console.log(`[DewSecure] 挖矿检测分数: ${score} (${reasons.join(',')})`);
            
            if (score >= 60) {
                isMiningDetected = true;
                console.warn(`[DewSecure] 检测到疑似资源滥用，得分: ${score}`);
                try { showMiningWarning(); } catch(e) {}
            }
        }

        // 1. 包装 Worker
        if (typeof window.Worker === 'function') {
            const NativeWorker = window.Worker;
            window.Worker = new Proxy(NativeWorker, {
                construct(target, args, newTarget) {
                    workerCount++;
                    triggerMiningCheck();
                    return Reflect.construct(target, args, newTarget);
                }
            });
        }

        // 2. 包装 WebAssembly
        if (window.WebAssembly) {
            for (const name of ['compile', 'instantiate', 'instantiateStreaming']) {
                const orig = WebAssembly[name];
                if (typeof orig !== 'function') continue;
                WebAssembly[name] = new Proxy(orig, {
                    apply(target, thisArg, args) {
                        wasmCount++;
                        triggerMiningCheck();
                        return Reflect.apply(target, thisArg, args);
                    }
                });
            }
        }

        // 3. 拦截 WebSocket 协议特征
        if (typeof window.WebSocket === 'function') {
            const NativeWS = window.WebSocket;
            const MINING_PORTS = [3333, 4444, 5555, 7777, 14433, 14444, 45700];
            const POOL_REGEX = /(pool|mine|stratum|worker|cryptonight)/i;

            // F-7 核心：拦截 send 方法，识别协议
            const nativeSend = NativeWS.prototype.send;
            NativeWS.prototype.send = function(data) {
                try {
                    if (typeof data === 'string' && data.length < 4096) {
                        console.log('🕵️ [DewSecure] 截获 WS 发包，正在匹配...');
                        const STRATUM = /"method"\s*:\s*"(mining\.(subscribe|authorize|submit)|login|submit)"/i;
                        const STRATUM_PARAMS = /"(agent|algo|rigid|pass)"\s*:/i;
                        if (STRATUM.test(data) && STRATUM_PARAMS.test(data)) {
                            console.warn('🚨 [DewSecure] 命中 Stratum 协议！');
                            if (!protocolDetected) {
                                protocolDetected = true;
                                triggerMiningCheck();
                            }
                        }
                    }
                } catch (e) {}
                return nativeSend.call(this, data);
            };

            // 包装构造函数拦截端口
            window.WebSocket = new Proxy(NativeWS, {
                construct(target, args, newTarget) {
                    try {
                        const u = new URL(String(args[0]));
                        const port = u.port ? parseInt(u.port, 10) : (u.protocol === 'wss:' ? 443 : 80);
                        if (MINING_PORTS.includes(port)) socketCount++;
                        else if (POOL_REGEX.test(String(args[0]))) suspiciousWsCount++;
                        if (socketCount > 0 || suspiciousWsCount > 0) triggerMiningCheck();
                    } catch (_) {}
                    return Reflect.construct(target, args, newTarget);
                }
            });
        }

        // 4. LongTask 监控
        if (window.PerformanceObserver) {
            try {
                new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        if (entry.duration > 50) { longTaskCount++; if (longTaskCount > 10) triggerMiningCheck(); }
                    }
                }).observe({ entryTypes: ['longtask'] });
            } catch (e) {}
        }

    } catch (e) {
        console.error('[DewSecure] 挖矿模块加载失败:', e);
    }
})();
