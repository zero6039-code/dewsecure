import esbuild from 'esbuild';
import JavaScriptObfuscator from 'javascript-obfuscator';
import fsObfuscator from 'fs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');

// R2 密钥已全部移交至 Cloudflare Worker，无需本地配置文件

// ============ esbuild 配置 ============
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
        obfuscateCode();
    }
}

function copyStatic() {
    const files = [
        ['manifest.json', 'dist/manifest.json'],
        ['popup/index.html', 'dist/popup/index.html'],
        ['popup/popup.css', 'dist/popup/popup.css'],
        ['popup/i18n.js', 'dist/popup/i18n.js'], // 🌟 补全了缺失的 i18n.js
        ['src/offscreen.html', 'dist/src/offscreen.html'],
    ];
    const dirs = [
        ['rules', 'dist/rules'],
        ['icons', 'dist/icons'],
        ['models', 'dist/models'],
    ];

    for (const [src, dest] of files) {
        if (fs.existsSync(src)) {
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(src, dest);
        }
    }

    for (const [src, dest] of dirs) {
        if (fs.existsSync(src) && fs.statSync(src).isDirectory()) {
            // 先彻底清空目标目录，避免旧文件残留（如已删除文件、.bak）
            if (fs.existsSync(dest)) {
                fs.rmSync(dest, { recursive: true, force: true });
            }
            fs.mkdirSync(dest, { recursive: true });
            // rules 目录特殊处理：只复制 *.json，且跳过 .bak 备份文件
            if (src === 'rules') {
                let copied = 0, skipped = 0;
                for (const f of fs.readdirSync(src)) {
                    if (f.endsWith('.json') && !f.includes('.bak')) {
                        fs.copyFileSync(path.join(src, f), path.join(dest, f));
                        copied++;
                    } else {
                        skipped++;
                    }
                }
                console.log(`Copied ${copied} rule files (skipped ${skipped} non-json/bak)`);
            } else {
                fs.cpSync(src, dest, { recursive: true });
            }
        }
    }

    // WASM 文件
    const ortDist = 'node_modules/onnxruntime-web/dist';
    const wasmDest = 'dist/wasm';
    const neededFiles = [
        'ort-wasm-simd-threaded.wasm',
        'ort-wasm-simd-threaded.mjs',
    ];
    if (fs.existsSync(ortDist)) {
        fs.mkdirSync(wasmDest, { recursive: true });
        let copied = 0;
        for (const f of neededFiles) {
            const src = path.join(ortDist, f);
            if (fs.existsSync(src)) {
                fs.copyFileSync(src, path.join(wasmDest, f));
                copied++;
            }
        }
        console.log(`Copied ${copied} onnxruntime-web files to dist/wasm/`);
    }

    console.log('Build complete!');

    // 清理临时生成的 r2-config.js（仅当不是本地已有的）
    
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
        if (fsObfuscator.existsSync(file)) {
            const code = fsObfuscator.readFileSync(file, 'utf8');
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
            fsObfuscator.writeFileSync(file, obfuscationResult.getObfuscatedCode());
            console.log(`   ✅ 已混淆: ${file}`);
        }
    }
    console.log('🛡️  混淆完成！');
}


build().catch((e) => {
    console.error(e);
    process.exit(1);
});
