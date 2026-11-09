// ==========================================
// 🗂️ 共享状态：跨模块的强制下载令牌集合
// 由 messaging.js（FORCE_DOWNLOAD 消费）与 downloads.js（消费）共同引用
// ==========================================

// 🛡️ A-11 修复：使用 Map 保存带过期时间（5分钟）的令牌
export const forceDownloadUrls = new Map();

export const grantForce = (url) => {
    if (url) forceDownloadUrls.set(url, Date.now() + 5 * 60 * 1000);
};

export const hasForce = (url) => {
    const t = forceDownloadUrls.get(url);
    if (t && t > Date.now()) return true;
    if (t) forceDownloadUrls.delete(url); // 清理过期的
    return false;
};

export const consumeForce = (url) => {
    const t = forceDownloadUrls.get(url);
    if (t && t > Date.now()) {
        forceDownloadUrls.delete(url);
        return true;
    }
    return false;
};
