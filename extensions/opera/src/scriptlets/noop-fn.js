// 静态 scriptlet：将指定全局函数替换为 no-op
// 参数来源：window.__dewScriptletConfig.noopFn（由 content.js 在 document_start 写入）
(function() {
    const cfg = window.__dewScriptletConfig;
    if (cfg && cfg.noopFn) {
        try { window[cfg.noopFn] = () => {}; } catch (e) {}
    }
})();
