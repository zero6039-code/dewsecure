import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');

// ============ 智能 fallback：确保 r2-config.js 存在 ============
const R2_CONFIG = 'src/r2-config.js';
const R2_EXAMPLE = 'src/r2-config.example.js';
let generatedR2Config = false;

if (!fs.existsSync(R2_CONFIG)) {
    // 优先从环境变量生成（用于 CI 发布）
    const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;

    if (R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY) {
        console.log('🔐 从环境变量生成 r2-config.js');
        const content = `// Auto-generated from env vars (CI)
export const R2_CONFIG = {
    accountId: '${R2_ACCOUNT_ID || 'unknown'}',
    accessKeyId: '${R2_ACCESS_KEY_ID}',
    secretAccessKey: '${R2_SECRET_ACCESS_KEY}',
    bucket: '${R2_BUCKET || 'dewsecure-models'}',
    presignedUrlExpiry: 60,
};
`;
        fs.writeFileSync(R2_CONFIG, content);
    } else {
        // 兜底：从 example 复制
        console.log('⚠️  r2-config.js 不存在，使用 example 作为占位符（构建产物无实际功能）');
        fs.copyFileSync(R2_EXAMPLE, R2_CONFIG);
    }
    generatedR2Config = true;
}

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
    }
}

function copyStatic() {
    const files = [
        ['manifest.json', 'dist/manifest.json'],
        ['popup/index.html', 'dist/popup/index.html'],
        ['popup/popup.css', 'dist/popup/popup.css'],
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
    if (generatedR2Config && !process.env.R2_ACCESS_KEY_ID) {
        // 保留 example 副本，不删除（避免下次构建时又要重新生成）
        console.log('ℹ️  保留 placeholder r2-config.js（不包含真实凭证）');
    }
}

build().catch((e) => {
    console.error(e);
    process.exit(1);
});
