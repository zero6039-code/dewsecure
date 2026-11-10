import { getCurrentUser } from '../authManager.js';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { syncRules, RANGE } from './dnrOwner.js';
import { buildMergedRules } from './adHostRules.js';
import { syncCosmeticRules } from './cosmeticRules.js';
import { 
    initThreatFilter, normalizeHost, checkThreatFilter, 
    saveFilterToDB, loadFilterFromDB, detectFormat, 
    FastBloomFilter, HashSetFilter, setThreatFilter 
} from './threatFilterStore.js';

export { initThreatFilter, checkThreatFilter };

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));
// 🛡️ AU-1/AU-2 修复：支持多公钥轮换
const ED25519_PUBLIC_KEYS = {
    'v1': 'a21b4c875ab246b58adc225ddf66a054cfa7b79ed2093fcc2f97598fd1197631'
};

// 🛡️ AU-1 修复：规范化 JSON 函数 (对键排序，防止解析歧义)
function canonicalJSON(obj) {
    if (Array.isArray(obj)) return '[' + obj.map(canonicalJSON).join(',') + ']';
    if (obj && typeof obj === 'object') {
        return '{' + Object.keys(obj).sort().map(k => JSON.stringify(k) + ':' + canonicalJSON(obj[k])).join(',') + '}';
    }
    return JSON.stringify(obj);
}
const CACHE_KEY = 'dewsecure_intel_cache';
const BROKEN_SITES_KEY = 'dewsecure_broken_sites'; // AD-8 缓存键

// AD-8: 获取当前误伤回退列表
async function getBrokenSites() {
    const { [BROKEN_SITES_KEY]: sites } = await chrome.storage.local.get(BROKEN_SITES_KEY);
    return sites || [];
}

// ==========================================
// 独立下载并验证二进制过滤器 (保留原有逻辑)
// ==========================================
async function updateThreatFilterBinary(userToken) {
    try {
        const baseUrl = 'https://api.dewsecure.com/api/intel';
        const headers = userToken ? { 'Authorization': `Bearer ${userToken}` } : {};

        const metaRes = await fetch(`${baseUrl}/threat-filter.meta.json`, { cache: 'no-store', headers });
        if (!metaRes.ok) { console.warn(`⚠️ meta 拉取失败 (HTTP ${metaRes.status})`); return; }
        const metaData = await metaRes.json();

        const cached = await loadFilterFromDB();
        if (!metaData.purpose || metaData.purpose !== 'dewsecure/filter/v1') return;
        if (metaData.valid_until && Date.now() > metaData.valid_until) return;

        if (cached && cached.meta && checkThreatFilter) {
            if (metaData.version < cached.meta.version) return;
            if (metaData.version === cached.meta.version) return;
        }

        const binRes = await fetch(`${baseUrl}/threat-filter.bin`, { cache: 'no-store', headers });
        if (!binRes.ok) return;
        const binBuffer = await binRes.arrayBuffer();

        const binHash = await crypto.subtle.digest('SHA-256', binBuffer).then(buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''));
        if (binHash !== metaData.sha256) return;

        let msg = metaData.sig_version >= 2 
            ? `${metaData.purpose}|${metaData.version}|${metaData.sha256}|${metaData.valid_until || 0}`
            : `${metaData.purpose}:${metaData.version}:${metaData.sha256}`;
        
        const sigBytes = Uint8Array.from(atob(metaData.signature.trim()), c => c.charCodeAt(0));
        const pubKeyBytes = new Uint8Array(ED25519_PUBLIC_KEY_HEX.match(/.{1,2}/g).map(b => parseInt(b, 16)));

        if (!(await ed.verifyAsync(sigBytes, new TextEncoder().encode(msg), pubKeyBytes))) return;

        await saveFilterToDB(binBuffer, metaData);
        const fmt = detectFormat(binBuffer);
        setThreatFilter(fmt === 'v2' ? new HashSetFilter(binBuffer) : new FastBloomFilter(binBuffer));
        console.log(`🛡️ [ThreatIntel] 成功更新 ${fmt} 过滤器 (Version: ${metaData.version})`);

    } catch (e) {
        console.warn('⚠️ [ThreatIntel] 更新二进制过滤器异常:', e);
    }
}

const MAX_INTEL_RULES = (chrome.declarativeNetRequest && chrome.declarativeNetRequest.MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES) || 4900;

async function applyRulesToDNR() {
    const user = await getCurrentUser();
    const isPro = user && user.tier !== 'free';
    const { dewsecure_settings: settings } = await chrome.storage.local.get('dewsecure_settings');
    const isEnabled = settings?.intelEnabled !== false;

    if (!isPro || !isEnabled) {
        await syncRules(RANGE.intel, []);
        return;
    }

    const { [CACHE_KEY]: cache } = await chrome.storage.local.get(CACHE_KEY);
    if (!cache || !cache.rulesData) return;

    // 🛡️ AD-8 修复：获取误伤列表，传给 buildMergedRules 过滤
    const brokenSites = await getBrokenSites();
    const newRules = buildMergedRules(cache.rulesData, RANGE.intel[0], MAX_INTEL_RULES, brokenSites);

    await syncRules(RANGE.intel, newRules);
}

export async function updateThreatIntel() {
    try {
        const user = await getCurrentUser();
        const isPro = user && user.tier !== 'free';
        const { dewsecure_settings: settings } = await chrome.storage.local.get('dewsecure_settings');
        const isEnabled = settings?.intelEnabled !== false;

        if (!isPro || !isEnabled) {
            await applyRulesToDNR();
            return;
        }

        console.log('📡 [ThreatIntel] 正在拉取云端最新情报...');
        await updateThreatFilterBinary(user?.token);

        const baseUrl = 'https://api.dewsecure.com/api/intel';
        const headers = user?.token ? { 'Authorization': `Bearer ${user.token}` } : {};

        const sigRes = await fetch(`${baseUrl}/threat-rules.sig`, { cache: 'no-store', headers });
        if (!sigRes.ok) throw new Error(`sig HTTP ${sigRes.status}`);
        const sigData = await sigRes.json();

        if (!sigData.purpose || sigData.purpose !== 'dewsecure/rules/v1') return;
        if (sigData.valid_until && Date.now() > sigData.valid_until) return;

        const { [CACHE_KEY]: localCache } = await chrome.storage.local.get(CACHE_KEY);
        if (localCache && localCache.sigData && localCache.sigData.version) {
            if (sigData.version <= localCache.sigData.version) return;
        }

        const rulesRes = await fetch(`${baseUrl}/threat-rules`, { cache: 'no-store', headers });
        if (!rulesRes.ok) throw new Error(`rules HTTP ${rulesRes.status}`);
        const rulesBuffer = await rulesRes.arrayBuffer();

        const actualHash = await crypto.subtle.digest('SHA-256', rulesBuffer).then(buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''));
        if (actualHash !== sigData.sha256) throw new Error('SHA-256 mismatch');

        let msgStr = sigData.sig_version >= 2 
            ? `${sigData.purpose}|${sigData.version}|${sigData.sha256}|${sigData.valid_until || 0}`
            : `${sigData.purpose}:${sigData.version}:${sigData.sha256}`;
        
        const sigBytes = Uint8Array.from(atob(sigData.signature.trim()), c => c.charCodeAt(0));
        const pubKeyBytes = new Uint8Array(ED25519_PUBLIC_KEY_HEX.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

        if (!(await ed.verifyAsync(sigBytes, new TextEncoder().encode(msgStr), pubKeyBytes))) {
            throw new Error('Ed25519 signature invalid');
        }

        console.log('✅ [ThreatIntel] 签名校验通过，写入本地缓存...');
        const rulesData = JSON.parse(new TextDecoder().decode(rulesBuffer));
        await chrome.storage.local.set({ [CACHE_KEY]: { rulesData, sigData } });
        await applyRulesToDNR();

        if (sigData.scriptlets) await syncScriptlets(sigData);
        if (sigData.cosmetics) await syncCosmeticRules(sigData);

    } catch (e) {
        console.warn('❌ [ThreatIntel] 拉取失败:', e);
        await applyRulesToDNR();
    }
}

// ... 保留 syncScriptlets 但增加 brokenSites 过滤 ... 
const ALLOWED_SCRIPTLETS = new Set(['noop-fn']);
async function syncScriptlets(verifiedBundle) {
    if (!verifiedBundle || !Array.isArray(verifiedBundle.scriptlets)) return;
    const brokenSites = await getBrokenSites();

    const scripts = [];
    for (let i = 0; i < verifiedBundle.scriptlets.length; i++) {
        const s = verifiedBundle.scriptlets[i];
        if (!s.use || !ALLOWED_SCRIPTLETS.has(s.use)) continue;
        if (!Array.isArray(s.match) || !s.match.every(m => /^\*:\/\/[\w*.-]+\/\*$/.test(m))) continue;
        
        // AD-8 过滤
        if (s.match.some(m => brokenSites.some(b => m.includes(`*://*.${b}/*`) || m.includes(`*://${b}/*`)))) {
            continue;
        }

        scripts.push({ id: `dew-sl-${s.use}-${i}`, matches: s.match, js: [`src/scriptlets/${s.use}.js`], world: 'MAIN', runAt: 'document_start', persistAcrossSessions: true });
    }

    try {
        const old = await chrome.scripting.getRegisteredContentScripts();
        const oldIds = old.filter(o => o.id.startsWith('dew-sl-')).map(o => o.id);
        if (oldIds.length) await chrome.scripting.unregisterContentScripts({ ids: oldIds });
        if (scripts.length) await chrome.scripting.registerContentScripts(scripts);
    } catch (e) {}
}
