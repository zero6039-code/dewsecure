import { triggerPhishingWarning } from './phishingUI.js';
import { readBarcodesFromImageData } from 'zxing-wasm/reader';

export function initQRScanner() {
    console.log('🛡️ [DewSecure] ZXing WASM 二维码扫描器已初始化');

    const imgQueue = new Set();
    let processing = false;

    async function getImageData(img) {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height);
    }

    // 加载 Base64 图片
    function loadBase64Image(dataUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = dataUrl;
        });
    }

    async function processQueue() {
        if (processing || imgQueue.size === 0) return;
        processing = true;

        for (const img of imgQueue) {
            imgQueue.delete(img);
            if (!img.isConnected || img.naturalWidth < 80 || img.naturalWidth > 1200) continue;

            try {
                let imageData;
                try {
                    // 1. 尝试直接读取像素
                    imageData = await getImageData(img);
                } catch (err) {
                    // 2. 如果被 CORS 跨域拦截，立即请求后台代理下载
                    if (err.name === 'SecurityError' || String(err).includes('tainted')) {
                        console.log(`⚠️ [DewSecure] 遇到跨域图片，请求后台代理下载: ${img.src.substring(0, 50)}...`);
                        
                        const proxyRes = await new Promise(resolve => {
                            chrome.runtime.sendMessage({ type: 'FETCH_IMAGE_FOR_QR', url: img.src }, resolve);
                        });
                        
                        if (proxyRes && proxyRes.ok && proxyRes.dataUrl) {
                            // 3. 将后台传回的 Base64 转成 Image 对象后再读取
                            const safeImg = await loadBase64Image(proxyRes.dataUrl);
                            imageData = await getImageData(safeImg);
                            console.log(`✅ [DewSecure] 后台代理下载成功，已提取像素`);
                        } else {
                            console.warn('❌ [DewSecure] 后台代理下载失败，跳过');
                            continue;
                        }
                    } else {
                        throw err;
                    }
                }

                if (!imageData) continue;

                // 4. 交给 ZXing 解码
                const results = await readBarcodesFromImageData(imageData, {
                    formats: ['QRCode'],
                    tryHarder: false,
                    maxNumberOfSymbols: 1
                });

                for (const r of results) {
                    const raw = r.text;
                    if (!/^https?:\/\//i.test(raw)) continue;

                    const url = new URL(raw);
                    const isCrossOrigin = url.hostname !== location.hostname;
                    const isSuspicious = /login|verify|secure|account|bank|paypal|apple|microsoft|update/i.test(raw);
                    const isShortener = /bit\.ly|t\.co|tinyurl\.com|goo\.gl|ow\.ly/i.test(raw);

                    if (isCrossOrigin && (isSuspicious || isShortener)) {
                        console.warn(`🚨 [DewSecure] 检测到包含可疑链接的二维码: ${raw}`);
                        triggerPhishingWarning(100, [{ key: 'reason_qr_phish', arg: url.hostname }]);
                        processing = false;
                        return; 
                    }
                }
            } catch (e) {
                console.error(`❌ [DewSecure] 二维码解析异常:`, e);
            }
        }

        processing = false;
    }

    function enqueueImage(img) {
        if (img.tagName !== 'IMG' || img.dataset.dwQrChecked) return;
        img.dataset.dwQrChecked = 'true';

        if (!img.complete) {
            img.addEventListener('load', () => {
                imgQueue.add(img);
                requestIdleCallback(processQueue, { timeout: 1000 });
            }, { once: true });
        } else {
            imgQueue.add(img);
            requestIdleCallback(processQueue, { timeout: 1000 });
        }
    }

    // 初始扫描与动态监听
    document.querySelectorAll('img').forEach(enqueueImage);

    const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    if (node.tagName === 'IMG') enqueueImage(node);
                    else if (node.querySelectorAll) node.querySelectorAll('img').forEach(enqueueImage);
                }
            }
        }
    });

    if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            observer.observe(document.body, { childList: true, subtree: true });
        });
    }
}
