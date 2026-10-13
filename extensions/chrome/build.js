import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');

const buildOptions = {
    entryPoints: [
        'src/background.js',
        'src/content.js',
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
            fs.mkdirSync(dest, { recursive: true });
            fs.cpSync(src, dest, { recursive: true });
        }
    }

    // 只复制核心 WASM 文件
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
}

build().catch((e) => {
    console.error(e);
    process.exit(1);
});
