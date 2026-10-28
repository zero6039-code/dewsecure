import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const buildOptions = {
    entryPoints: ['src/background.js', 'src/content.js', 'src/inject.js', 'src/offscreen.js'],
    outbase: '.',
    bundle: true,
    outdir: 'dist',
    format: 'esm',
    target: 'chrome100',
    minify: true,
};

function syncFromChrome() {
    console.log('📦 正在从 Chrome 同步最新源码...');
    if (fs.existsSync('dist')) fs.rmSync('dist', { recursive: true, force: true });
    
    const filterFn = (src) => !src.endsWith('.bak') && !src.includes('.bak.');
    if (fs.existsSync('../chrome/src')) fs.cpSync('../chrome/src', 'src', { recursive: true, force: true, filter: filterFn });
    if (fs.existsSync('../chrome/popup')) fs.cpSync('../chrome/popup', 'popup', { recursive: true, force: true, filter: filterFn });
    if (fs.existsSync('../chrome/rules')) fs.cpSync('../chrome/rules', 'rules', { recursive: true, force: true, filter: filterFn });
    if (fs.existsSync('../chrome/icons')) fs.cpSync('../chrome/icons', 'icons', { recursive: true, force: true, filter: filterFn });
}

async function build() {
    syncFromChrome();
    const ctx = await esbuild.context(buildOptions);
    await ctx.rebuild();
    await ctx.dispose();
    copyStatic();
}

function copyStatic() {
    console.log('📦 生成 Opera 专属 manifest...');
    
    const chromeManifest = JSON.parse(fs.readFileSync('../chrome/manifest.json', 'utf8'));
    
    chromeManifest.name = "DewSecure - Content Optimizer (Opera)";
    delete chromeManifest.side_panel;
    
    chromeManifest.sidebar_action = {
        "default_title": "DewSecure",
        "default_panel": "popup/index.html",
        "default_icon": "icons/icon-48.png"
    };
    
    chromeManifest.background = {
        "service_worker": "src/background.js",
        "type": "module"
    };

    fs.mkdirSync('dist', { recursive: true });
    fs.writeFileSync('dist/manifest.json', JSON.stringify(chromeManifest, null, 2));

    if (fs.existsSync('popup')) fs.cpSync('popup', 'dist/popup', { recursive: true, force: true });
    if (fs.existsSync('icons')) fs.cpSync('icons', 'dist/icons', { recursive: true, force: true });
    if (fs.existsSync('rules')) fs.cpSync('rules', 'dist/rules', { recursive: true, force: true });
    
    // 拷贝 src 其他文件
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

    // 🌟 核心修复：拷贝 onnxruntime-web 的 wasm 文件
    const wasmSource = path.join('node_modules', 'onnxruntime-web', 'dist');
    const wasmDest = path.join('dist', 'wasm');
    if (fs.existsSync(wasmSource)) {
        fs.mkdirSync(wasmDest, { recursive: true });
        // 拷贝 .wasm 和 .mjs 文件
        const files = fs.readdirSync(wasmSource);
        files.forEach(file => {
            if (file.endsWith('.wasm') || file.endsWith('.mjs')) {
                fs.copyFileSync(path.join(wasmSource, file), path.join(wasmDest, file));
            }
        });
        console.log('✅ 已复制 AI 模型 wasm 文件');
    }

    console.log('Opera 扩展构建完成! (使用 MV3 + sidebar_action)');
}

build().catch(console.error);
