import esbuild from 'esbuild';
import chokidar from 'chokidar';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');

const buildOptions = {
    entryPoints: [
        'src/background.js',
        'src/content.js',
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
        // 复制静态资源
        copyStatic();
    }
}

function copyStatic() {
    const files = [
        ['manifest.json', 'dist/manifest.json'],
        ['popup/index.html', 'dist/popup/index.html'],
        ['popup/popup.css', 'dist/popup/popup.css'],
    ];
    const dirs = [
        ['rules', 'dist/rules'],
        ['icons', 'dist/icons'],
    ];

    for (const [src, dest] of files) {
        if (fs.existsSync(src)) {
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(src, dest);
        }
    }

    for (const [src, dest] of dirs) {
        if (fs.existsSync(src)) {
            fs.cpSync(src, dest, { recursive: true });
        }
    }

    console.log('Build complete!');
}

build().catch((e) => {
    console.error(e);
    process.exit(1);
});
