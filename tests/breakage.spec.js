const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

const testSites = [
    { name: 'GitHub', url: 'https://github.com', checkSelector: 'a[href="/login"]' },
    { name: 'Baidu', url: 'https://www.baidu.com', checkSelector: '#kw' },
    { name: 'Wikipedia', url: 'https://www.wikipedia.org', checkSelector: 'input[name="search"]' }
];

test.describe('Extension Breakage Regression', () => {
    let context;
    let page;

    test.beforeAll(async () => {
        const pathToExtension = path.join(__dirname, '../extensions/chrome/dist');
        context = await chromium.launchPersistentContext('', {
            headless: false, 
            viewport: { width: 1440, height: 900 },
            // 🌟 伪装成正常的 Mac Chrome，绕过基础反爬
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            args: [
                `--disable-extensions-except=${pathToExtension}`,
                `--load-extension=${pathToExtension}`,
                '--disable-blink-features=AutomationControlled' // 隐藏自动化特征
            ],
        });
        page = await context.newPage();
    });

    test.afterAll(async () => {
        await context.close();
    });

    for (const site of testSites) {
        test(`Check core element on ${site.name}`, async () => {
            console.log(`Navigating to ${site.url}...`);
            await page.goto(site.url, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(2500); // 给复杂的 JS 渲染留足时间

            const checkResult = await page.evaluate((selector) => {
                const el = document.querySelector(selector);
                if (!el) return 'NOT_FOUND';
                
                const style = window.getComputedStyle(el);
                // 🌟 核心逻辑：只要没被我们扩展用 display:none 或 visibility:hidden 干掉就算成功
                if (style.display === 'none' || style.visibility === 'hidden') {
                    return 'HIDDEN_BY_CSS'; 
                }
                return 'PASS';
            }, site.checkSelector);

            console.log(`[${site.name}] Status: ${checkResult}`);
            
            // 只有被 CSS 隐藏或根本没找到（可能是规则删除了节点）才判定为失败
            expect(checkResult).toBe('PASS');
            console.log(`✅ ${site.name} passed!`);
        });
    }
});
