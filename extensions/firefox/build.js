import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const watch = process.argv.includes('--watch');

const buildOptions = {
    entryPoints: ['src/background.js', 'src/content.js', 'src/inject.js', 'src/offscreen.js'],
    outbase: '.', 
    bundle: true,
    outdir: 'dist',
    format: 'esm',
    target: 'firefox115',
    sourcemap: watch,
    minify: !watch,
};

function syncFromChrome() {
    console.log('📦 正在从 Chrome 同步最新源码...');
    if (fs.existsSync('dist')) fs.rmSync('dist', { recursive: true, force: true });
    if (fs.existsSync('src')) fs.rmSync('src', { recursive: true, force: true });
    if (fs.existsSync('popup')) fs.rmSync('popup', { recursive: true, force: true });
    if (fs.existsSync('rules')) fs.rmSync('rules', { recursive: true, force: true });
    if (fs.existsSync('icons')) fs.rmSync('icons', { recursive: true, force: true });

    const filterFn = (src) => !src.endsWith('.bak') && !src.includes('.bak.');
    if (fs.existsSync('../chrome/src')) fs.cpSync('../chrome/src', 'src', { recursive: true, force: true, filter: filterFn });
    if (fs.existsSync('../chrome/popup')) fs.cpSync('../chrome/popup', 'popup', { recursive: true, force: true, filter: filterFn });
    if (fs.existsSync('../chrome/rules')) fs.cpSync('../chrome/rules', 'rules', { recursive: true, force: true, filter: filterFn });
    if (fs.existsSync('../chrome/icons')) fs.cpSync('../chrome/icons', 'icons', { recursive: true, force: true, filter: filterFn });
    console.log('✅ 同步完成！');
}

function generateFirefoxManifest() {
    const chromeManifestPath = path.join('..', 'chrome', 'manifest.json');
    if (!fs.existsSync(chromeManifestPath)) return;
    
    const chrome = JSON.parse(fs.readFileSync(chromeManifestPath, 'utf8'));
    
    // 移除 Chrome 专属配置
    delete chrome.offscreen; 
    delete chrome.side_panel;
    delete chrome.externally_connectable;
    if (chrome.permissions) {
        chrome.permissions = chrome.permissions.filter(p => p !== 'offscreen' && p !== 'sidePanel');
    }
    
    // 添加 Firefox 专属配置
    chrome.sidebar_action = {
        "default_panel": "popup/index.html",
        "default_icon": chrome.icons
    };
    chrome.browser_specific_settings = {
        "gecko": {
            "id": "contact@dewsecure.com",
            "strict_min_version": "115.0",
            "data_collection_permissions": {
                "required": ["none"]
            }
        }
    };
    // Firefox 对 MV3 的 background 写法要求
    if (chrome.background && chrome.background.service_worker) {
        const sw = chrome.background.service_worker;
        chrome.background = {
            "scripts": [sw],
            "type": "module"
        };
    }

    fs.writeFileSync('manifest.json', JSON.stringify(chrome, null, 2));
    console.log('✅ 已从 Chrome 自动生成 Firefox manifest.json');
}

async function build() {
    syncFromChrome();
    generateFirefoxManifest();
    const ctx = await esbuild.context(buildOptions);
    if (watch) {
        await ctx.watch();
        console.log('Watching...');
    } else {
        await ctx.rebuild();
        await ctx.dispose();
        copyStatic();
    }
}

function copyStatic() {
    console.log('📦 正在拷贝静态资源...');
    
    if (fs.existsSync('manifest.json')) {
        fs.copyFileSync('manifest.json', 'dist/manifest.json');
    }
    if (fs.existsSync('popup')) fs.cpSync('popup', 'dist/popup', { recursive: true, force: true });
    if (fs.existsSync('icons')) fs.cpSync('icons', 'dist/icons', { recursive: true, force: true });
    if (fs.existsSync('rules')) fs.cpSync('rules', 'dist/rules', { recursive: true, force: true });
    
    if (fs.existsSync('src')) {
        const srcFiles = fs.readdirSync('src');
        for (const file of srcFiles) {
            const srcPath = path.join('src', file);
            const destPath = path.join('dist/src', file);
            if (file === 'background.js' || file === 'content.js' || file === 'inject.js' || file === 'offscreen.js') continue;
            
            if (fs.statSync(srcPath).isDirectory()) {
                fs.cpSync(srcPath, destPath, { recursive: true, force: true });
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }

    // 🌟 核心修复：直接从 Chrome 目录借 AI wasm 文件
    const chromeWasmSrc = path.join('..', 'chrome', 'node_modules', 'onnxruntime-web', 'dist');
    const wasmDest = path.join('dist', 'wasm');
    const neededFiles = ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs'];
    
    if (fs.existsSync(chromeWasmSrc)) {
        fs.mkdirSync(wasmDest, { recursive: true });
        for (const f of neededFiles) {
            const src = path.join(chromeWasmSrc, f);
            if (fs.existsSync(src)) fs.copyFileSync(src, path.join(wasmDest, f));
        }
        console.log('✅ Firefox 已从 Chrome 借调 AI wasm 引擎文件');
    } else {
        console.error('❌ 找不到 Chrome 的 wasm 文件，请检查路径！');
    }

    console.log('Firefox 扩展构建完成!');
}

build().catch(console.error);
