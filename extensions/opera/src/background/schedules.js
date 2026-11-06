// ==========================================
// ⏰ 定时任务：威胁情报同步 + 模型更新
// N-2：闹钟按需创建 + 6 小时节流
// ==========================================
import { ensureAlarm, due } from './alarmHelper.js';
import { updateThreatIntel } from './threatIntel.js';
import { checkAndUpdateModel } from '../modelManager.js';

export function initSchedules() {
    // 威胁情报同步 (URLhaus等)
    (async () => {
        await ensureAlarm('dewsecure_threat_intel', { periodInMinutes: 1440, delayInMinutes: 1 });
        if (await due('last_intel_check', 6 * 3600e3)) {
            updateThreatIntel();
        }
    })();
    chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === 'dewsecure_threat_intel') updateThreatIntel();
    });

    // 模型同步
    (async () => {
        await ensureAlarm('dewsecure_model_update', { periodInMinutes: 1440, delayInMinutes: 1 });
        if (await due('last_model_check', 6 * 3600e3)) {
            checkAndUpdateModel().catch(console.warn);
        }
    })();
    chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === 'dewsecure_model_update') checkAndUpdateModel().catch(console.warn);
    });
}
