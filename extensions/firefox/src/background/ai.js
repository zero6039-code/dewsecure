export function extractFeaturesFromUrl(url) {
    const NGRAM_SIZE = 16384;
    const STRUCT_SIZE = 34;
    const features = new Float32Array(NGRAM_SIZE + STRUCT_SIZE);
    for (let i = 0; i <= url.length - 3; i++) {
        const ngram = url.substring(i, i + 3);
        let hash = 0xcbf29ce484222325n;
        const prime = 0x100000001b3n;
        for (let j = 0; j < 3; j++) {
            hash ^= BigInt(ngram.charCodeAt(j));
            hash = BigInt.asUintN(64, hash * prime);
        }
        features[Number(hash % 16384n)] += 1.0;
    }
    const S = 16384;
    features[S + 0] = url.length;
    const count = (str, ch) => str.split(ch).length - 1;
    features[S + 1] = count(url, '.'); features[S + 2] = count(url, '-'); features[S + 3] = count(url, '_');
    features[S + 4] = count(url, '/'); features[S + 5] = count(url, '?'); features[S + 6] = count(url, '=');
    features[S + 7] = count(url, '&'); features[S + 8] = count(url, '%'); features[S + 9] = count(url, ':');
    features[S + 10] = url.replace(/[^0-9]/g, '').length;
    features[S + 11] = url.replace(/[^a-zA-Z]/g, '').length;
    const kw = ['ad','ads','track','click','banner','popup','sponsor','promo','doubleclick','google','facebook','analytics','pixel','tracker','affiliate','utm','redirect','link','aff','campaign','partner','stat','counter','log','media','advert','serve','sync'];
    for (let i = 0; i < kw.length && i < 22; i++) features[S + 12 + i] = url.toLowerCase().includes(kw[i]) ? 1.0 : 0.0;
    return Array.from(features);
}

const AI_CHECKED_DOMAINS = new Set();
export async function runAICheck(url) {
    try {
        const domain = new URL(url).hostname;
        if (AI_CHECKED_DOMAINS.has(domain)) return;
        AI_CHECKED_DOMAINS.add(domain);
        const features = extractFeaturesFromUrl(url);
        const response = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'CLASSIFY', features });
        if (!response || !response.probs) return;
        const probs = response.probs;
        const maxIdx = probs.indexOf(Math.max(...probs));
        const classes = ['Normal', 'Ad', 'Tracker', 'Phishing'];
        const classification = classes[maxIdx];
        if (classification === 'Phishing') {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0] && tabs[0].id) chrome.tabs.sendMessage(tabs[0].id, { type: 'PHISHING_DETECTED', url });
            });
        } else if (classification === 'Ad' || classification === 'Tracker') {
            const ruleId = Math.floor(Math.abs(domain.split('').reduce((a,b)=>((a<<5)-a)+b.charCodeAt(0),0)) % 1000000) + 50000;
            await chrome.declarativeNetRequest.updateSessionRules({
                removeRuleIds: [ruleId],
                addRules: [{ id: ruleId, priority: 10000, action: { type: 'block' }, condition: { requestDomains: [domain], resourceTypes: ["main_frame", "sub_frame", "script", "image", "xmlhttprequest"] } }]
            });
        }
    } catch(e) {}
}
