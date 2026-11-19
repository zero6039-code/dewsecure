const ADS_RULESETS_DEFAULT = ['ads_1a', 'ads_1b', 'ads_2', 'ads_3', 'ads_4', 'anti_affiliate'];
const TRACKER_RULESETS_DEFAULT = ['trackers_1a', 'trackers_1b', 'trackers_2a', 'trackers_2b'];
const EXTRA_RULESETS_DEFAULT = ['annoyances'];
let _rulesetIndex = null;
async function getRulesetIndex() {
    if (_rulesetIndex) return _rulesetIndex;
    try {
        const res = await fetch(chrome.runtime.getURL('rules/ruleset-index.json'));
        if (!res.ok) throw new Error('not found');
        _rulesetIndex = await res.json();
    } catch (e) {
        if (navigator.userAgent.includes('Firefox')) {
            _rulesetIndex = { allowlist: ['allowlist__p1'], ads: ['ads_1a__p1'], trackers: ['trackers_1a__p1'], extra: ['annoyances__p1'] };
        } else {
            _rulesetIndex = { ads: ADS_RULESETS_DEFAULT, trackers: TRACKER_RULESETS_DEFAULT, extra: EXTRA_RULESETS_DEFAULT };
        }
    }
    return _rulesetIndex;
}
export async function updateDNRRulesets(dnrEnabled, blockTrackers) {
    try {
        const idx = await getRulesetIndex();
        const allRulesets = ['allowlist', ...idx.ads, ...idx.extra, ...idx.trackers];
        if (!dnrEnabled) {
            const currentlyEnabled = await chrome.declarativeNetRequest.getEnabledRulesets();
            const toDisable = currentlyEnabled.filter(id => allRulesets.includes(id));
            if (toDisable.length > 0) await chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: toDisable });
            return;
        }
        const desired = ['allowlist', ...idx.ads, ...idx.extra];
        if (blockTrackers) desired.push(...idx.trackers);
        const currentlyEnabled = await chrome.declarativeNetRequest.getEnabledRulesets();
        const currentlyEnabledSet = new Set(currentlyEnabled);
        const newlyEnabled = [];
        for (const rulesetId of desired) {
            if (currentlyEnabledSet.has(rulesetId)) continue;
            if (chrome.declarativeNetRequest.getAvailableStaticRuleCount) {
                try {
                    const quota = await chrome.declarativeNetRequest.getAvailableStaticRuleCount();
                    if (quota < 50) break;
                } catch (e) {}
            }
            try {
                await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: [rulesetId] });
                const after = await chrome.declarativeNetRequest.getEnabledRulesets();
                if (after.includes(rulesetId)) newlyEnabled.push(rulesetId);
            } catch (e) {
                if (!rulesetId.includes('allowlist') && e.message && e.message.includes('exceeds GUARANTEED_MINIMUM_STATIC_RULES')) break;
            }
        }
        const desiredSet = new Set(desired);
        const toDisable = currentlyEnabled.filter(id => !desiredSet.has(id) && allRulesets.includes(id));
        if (toDisable.length > 0) await chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: toDisable });
    } catch (e) { console.warn('❌ [DNR] 更新失败:', e); }
}
