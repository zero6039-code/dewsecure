import esbuild from 'esbuild';
import JavaScriptObfuscator from 'javascript-obfuscator';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');
const skipObfuscate = process.argv.includes('--no-obfuscate');

const buildOptions = {
    entryPoints: [
        'src/background.js',
        'src/content.js',
        'src/inject.js',
        'src/offscreen.js',
        'popup/popup.js',
    ],
    bundle: true,
    outdir: 'dist',
    format: 'esm',
    target: 'chrome110',
    sourcemap: watch,
    minify: !watch,
    logLevel: 'info',
};

async function build() {
    const ctx = await esbuild.context(buildOptions);
    if (watch) {
        await ctx.watch();
        console.log('Watching for changes...');
    } else {
        await ctx.rebuild();
        await ctx.dispose();
        copyStatic();
        if (!skipObfuscate) { obfuscateCode(); }
    }
}

function copyStatic() {
    // 1. 基础文件拷贝
    const files = [
        ['manifest.json', 'dist/manifest.json'],
        ['popup/index.html', 'dist/popup/index.html'],
        ['popup/popup.css', 'dist/popup/popup.css'],
        ['popup/i18n.js', 'dist/popup/i18n.js'],
        ['src/offscreen.html', 'dist/src/offscreen.html'],
    ];
    for (const [src, dest] of files) {
        if (fs.existsSync(src)) {
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(src, dest);
        }
    }

    // 2. 目录全量拷贝（修复模块缺失问题）
    const dirs = [
        ['rules', 'dist/rules'],
        ['icons', 'dist/icons'],
        ['models', 'dist/models'],
        ['popup/locales', 'dist/popup/locales'],
        ['popup/modules', 'dist/popup/modules'], // 🌟 补全 modules 目录
    ];
    for (const [src, dest] of dirs) {
        if (fs.existsSync(src) && fs.statSync(src).isDirectory()) {
            if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
            fs.cpSync(src, dest, { 
                recursive: true,
                filter: (file) => !file.endsWith('.bak') && !file.includes('.bak')
            });
        }
    }

    // 3. 全量拷贝 src 目录下的非入口模块（防止动态 import 找不到文件）
    const srcFiles = fs.readdirSync('src');
    for (const file of srcFiles) {
        if (!['background.js', 'content.js', 'inject.js', 'offscreen.js'].includes(file)) {
            const srcPath = path.join('src', file);
            const destPath = path.join('dist/src', file);
            if (fs.statSync(srcPath).isDirectory()) {
                fs.cpSync(srcPath, destPath, { recursive: true, force: true });
            } else {
                fs.mkdirSync(path.dirname(destPath), { recursive: true });
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }

    // 4. WASM 文件拷贝
    const ortDist = 'node_modules/onnxruntime-web/dist';
    const wasmDest = 'dist/wasm';
    const neededFiles = ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs'];
    if (fs.existsSync(ortDist)) {
        fs.mkdirSync(wasmDest, { recursive: true });
        for (const f of neededFiles) {
            const src = path.join(ortDist, f);
            if (fs.existsSync(src)) fs.copyFileSync(src, path.join(wasmDest, f));
        }
    }

    console.log('Build complete!');
}

function obfuscateCode() {
    const filesToObfuscate = [
        'dist/src/content.js',
        'dist/src/inject.js',
        'dist/src/background.js',
        'dist/src/offscreen.js',
        'dist/popup/popup.js'
    ];
    
    console.log('🛡️  正在进行高强度代码混淆...');
    for (const file of filesToObfuscate) {
        if (fs.existsSync(file)) {
            const code = fs.readFileSync(file, 'utf8');
            const obfuscationResult = JavaScriptObfuscator.obfuscate(code, {
                compact: true,
                controlFlowFlattening: true,
                controlFlowFlatteningThreshold: 0.75,
                deadCodeInjection: true,
                deadCodeInjectionThreshold: 0.4,
                debugProtection: false,
                disableConsoleOutput: false,
                identifierNamesGenerator: 'hexadecimal',
                renameGlobals: false,
                selfDefending: true,
                stringArray: true,
                stringArrayEncoding: ['rc4'],
                stringArrayThreshold: 0.75
            });
            fs.writeFileSync(file, obfuscationResult.getObfuscatedCode());
            console.log(`   ✅ 已混淆: ${file}`);
        }
    }
    console.log('🛡️  混淆完成！');
}

build().catch((e) => {
    console.error(e);
    process.exit(1);
});
