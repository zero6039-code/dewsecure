// ==========================================
// 🛡️ N-2 修复：闹钟与节流辅助
// ==========================================

/**
 * 仅在不存在时创建闹钟，避免每次 Service Worker 唤醒都重置倒计时
 */
export async function ensureAlarm(name, opts) {
    const existing = await chrome.alarms.get(name);
    if (!existing) {
        await chrome.alarms.create(name, opts);
    }
}

/**
 * 到期检查 + 写入时间戳，用于限制高频操作
 * @param {string} key storage.local 中的时间戳字段名
 * @param {number} minMs 最小间隔（毫秒）
 * @returns {Promise<boolean>} true 表示已到期（应执行）
 */
export async function due(key, minMs) {
    const { [key]: last = 0 } = await chrome.storage.local.get(key);
    if (Date.now() - last < minMs) return false;
    await chrome.storage.local.set({ [key]: Date.now() });
    return true;
}
