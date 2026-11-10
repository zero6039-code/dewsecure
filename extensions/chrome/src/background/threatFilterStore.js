import { sha256 } from '@noble/hashes/sha256';
import { parse } from 'tldts';

let threatFilter = null;
const DB_NAME = 'dewsecure_threat_db';
const STORE_NAME = 'filters';

export function getDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function saveFilterToDB(buffer, meta) {
    const db = await getDB();
    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put({ buffer, meta }, 'threat-filter');
        tx.oncomplete = () => resolve();
    });
}

export async function loadFilterFromDB() {
    const db = await getDB();
    return new Promise((resolve) => {
        const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get('threat-filter');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
    });
}

export class FastBloomFilter {
    constructor(arrayBuffer) {
        const view = new DataView(arrayBuffer);
        this.bits = view.getUint32(0, true);
        this.hashCount = view.getUint32(4, true);
        this.buffer = new Uint8Array(arrayBuffer, 8);
    }
    _hashes(str) {
        let h1 = 0x811c9dc5;
        let h2 = 0x1000193;
        for (let i = 0; i < str.length; i++) {
            const c = str.charCodeAt(i);
            h1 = Math.imul(h1 ^ c, 0x01000193);
            h2 = Math.imul(h2 ^ c, 0x01000193);
        }
        return [h1 >>> 0, h2 >>> 0];
    }
    has(str) {
        const [h1, h2] = this._hashes(str);
        for (let i = 0; i < this.hashCount; i++) {
            const combinedHash = (h1 + i * h2) >>> 0;
            const bitIndex = combinedHash % this.bits;
            const byteIndex = bitIndex >>> 3;
            const bitOffset = bitIndex & 7;
            if ((this.buffer[byteIndex] & (1 << bitOffset)) === 0) return false;
        }
        return true;
    }
}

export class HashSetFilter {
    constructor(ab) {
        const dv = new DataView(ab);
        if (dv.getUint32(0, false) !== 0x44455731) throw new Error('bad magic');
        this.h = dv.getUint8(4);
        this.n = dv.getUint32(5, true);
        if (this.h < 6 || this.h > 8) throw new Error('bad h');
        if (ab.byteLength !== 9 + this.h * this.n) throw new Error('bad size');
        this.b = new Uint8Array(ab, 9);
    }
    has(host) {
        const key = sha256(new TextEncoder().encode(host)).subarray(0, this.h);
        let lo = 0, hi = this.n - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >>> 1, o = mid * this.h;
            let cmp = 0;
            for (let i = 0; i < this.h && cmp === 0; i++) cmp = this.b[o + i] - key[i];
            if (cmp === 0) return true;
            if (cmp < 0) lo = mid + 1; else hi = mid - 1;
        }
        return false;
    }
}

export function detectFormat(ab) {
    if (ab.byteLength >= 9) {
        const dv = new DataView(ab);
        if (dv.getUint32(0, false) === 0x44455731) return 'v2';
    }
    return 'v1';
}

export async function initThreatFilter() {
    try {
        const cached = await loadFilterFromDB();
        if (cached && cached.buffer) {
            const fmt = detectFormat(cached.buffer);
            if (fmt === 'v2') {
                threatFilter = new HashSetFilter(cached.buffer);
                console.log(`⚡ [ThreatIntel] v2 哈希前缀过滤器已加载 (${cached.buffer.byteLength} bytes)`);
            } else {
                threatFilter = new FastBloomFilter(cached.buffer);
                console.log('⚡ [ThreatIntel] v1 Bloom 过滤器已加载 (兼容模式)');
            }
        }
    } catch (e) {
        console.warn('[ThreatIntel] 过滤器加载失败:', e);
        threatFilter = null;
    }
}

export function normalizeHost(input) {
    let h = String(input || '').trim().toLowerCase();
    if (!h) return '';
    if (h.includes('://')) {
        try { h = new URL(h).hostname; } catch { return ''; }
    }
    if (h.startsWith('[')) {
        const end = h.indexOf(']');
        return end > 0 ? h.slice(1, end) : '';
    }
    const colon = h.lastIndexOf(':');
    if (colon > -1 && h.indexOf(':') === colon) h = h.slice(0, colon);
    while (h.endsWith('.')) h = h.slice(0, -1);
    return h;
}

export function checkThreatFilter(host) {
    if (!threatFilter) return false;
    host = normalizeHost(host);
    if (!host) return false;
    const p = parse(host);
    if (!p.domain || p.isIp) return threatFilter.has(host);
    const labels = host.split('.');
    const depth = labels.length - p.domain.split('.').length;
    for (let i = 0; i <= depth; i++) {
        if (threatFilter.has(labels.slice(i).join('.'))) return true;
    }
    return false;
}

export function setThreatFilter(filter) {
    threatFilter = filter;
}
