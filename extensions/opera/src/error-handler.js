// 🌟 阻止网络波动引起的模型加载失败报错冒泡到扩展面板
window.addEventListener('unhandledrejection', event => {
    if (event.reason && String(event.reason).includes('Failed to fetch')) {
        console.warn('🛡️ [Offscreen] 静默拦截网络请求失败 (将在后台重试)');
        event.preventDefault(); // 阻止报错冒泡
    }
});

window.addEventListener('error', event => {
    if (event.message && event.message.includes('Failed to fetch')) {
        console.warn('🛡️ [Offscreen] 静默拦截模型加载失败 (将在后台重试)');
        event.preventDefault(); 
        return true;
    }
}, true);
