import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const watch = process.argv.includes('--watch');

const buildOptions = {
    entryPoints: ['src/background.js', 'src/content.js', 'src/inject.js'],
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
    if (fs.existsSync('../chrome/warning.html')) fs.copyFileSync('../chrome/warning.html', 'warning.html');
    if (fs.existsSync('../chrome/warning.js'))   fs.copyFileSync('../chrome/warning.js',   'warning.js');
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
    delete chrome.key; // Firefox 通过 gecko.id 识别，不支持 key
    if (chrome.web_accessible_resources) {
        chrome.web_accessible_resources = chrome.web_accessible_resources.map(r => {
            delete r.use_dynamic_url; // Chrome 专属，Firefox 不支持会报警告
            return r;
        });
    }
    if (chrome.permissions) {
        chrome.permissions = chrome.permissions.filter(p => p !== 'offscreen' && p !== 'sidePanel');
        // 🦊 为 Firefox 动态添加 webRequest 权限（支持实时统计与拦截）
        if (!chrome.permissions.includes('webRequest')) chrome.permissions.push('webRequest');
        if (!chrome.permissions.includes('webRequestBlocking')) chrome.permissions.push('webRequestBlocking');
    }
    
    // 添加 Firefox 专属配置
    chrome.sidebar_action = {
        "default_panel": "popup/index.html",
        "default_icon": chrome.icons
    };
    chrome.browser_specific_settings = {
        "gecko": {
            "id": "dewsecure@dewsecure.com",
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


function splitRulesets() {
    console.log('✂️ 正在切分 Firefox 规则文件 (每块 1500 条)...');
    const rulesDir = path.join('dist', 'rules');
    const files = fs.readdirSync(rulesDir).filter(f => f.endsWith('.json') && !f.includes('.p'));
    
    const index = { allowlist: [], ads: [], trackers: [], extra: [] };
    
    // 定义文件到索引的映射
    const getTargetArr = (filename) => {
        if (filename.includes('allowlist')) return index.allowlist;
        if (filename.includes('tracker')) return index.trackers;
        if (filename.includes('annoyance')) return index.extra;
        return index.ads;
    };

    const manifestPath = path.join('dist', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const newRuleResources = [];

    for (const file of files) {
        const baseId = file.replace('.json', '').replace(/-/g, '_');
        let rules = [];
        try {
            rules = JSON.parse(fs.readFileSync(path.join(rulesDir, file), 'utf8'));
        } catch (e) {
            console.warn(`⚠️ 无法解析 ${file}, 跳过切分`);
            continue;
        }
        if (!Array.isArray(rules)) rules = [rules];

        const CHUNK_SIZE = 1500;
        const chunks = Math.ceil(rules.length / CHUNK_SIZE);
        const targetArr = getTargetArr(file);

        for (let i = 0; i < chunks; i++) {
            const chunk = rules.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
            const chunkId = `${baseId}__p${i + 1}`;
            const chunkFile = `${baseId}.p${i + 1}.json`;
            
            fs.writeFileSync(path.join(rulesDir, chunkFile), JSON.stringify(chunk, null, 2));
            targetArr.push(chunkId);
            
            // 仅 allowlist 默认开启，其余全部 false，交由代码动态启用
            newRuleResources.push({
                id: chunkId,
                enabled: baseId === 'allowlist',
                path: `rules/${chunkFile}`
            });
        }
        
        // 删除原文件，防止冲突和体积增大
        fs.unlinkSync(path.join(rulesDir, file));
    }

    manifest.declarative_net_request.rule_resources = newRuleResources;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(rulesDir, 'ruleset-index.json'), JSON.stringify(index, null, 2));
    
    console.log(`✅ 切分完成: 原 ${files.length} 个文件切分为 ${newRuleResources.length} 个块。`);
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
    if (fs.existsSync('rules')) {
        fs.cpSync('rules', 'dist/rules', { recursive: true, force: true });
        splitRulesets();
    }
    if (fs.existsSync('warning.html')) fs.copyFileSync('warning.html', 'dist/warning.html');
    if (fs.existsSync('warning.js'))   fs.copyFileSync('warning.js',   'dist/warning.js');
    
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
