import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const watch = process.argv.includes('--watch');

const buildOptions = {
    entryPoints: ['src/background.js', 'src/content.js'],
    bundle: true,
    outdir: 'dist',
    format: 'esm',
    target: 'firefox115',
    sourcemap: watch,
    minify: !watch,
};

async function build() {
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
    const files = [
        ['manifest.json', 'dist/manifest.json'],
        ['popup/index.html', 'dist/popup/index.html'],
        ['popup/popup.css', 'dist/popup/popup.css'],
        ['popup/popup.js', 'dist/popup/popup.js'],
    ];
    for (const [src, dest] of files) {
        if (fs.existsSync(src)) {
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(src, dest);
        }
    }
    if (fs.existsSync('icons')) {
        fs.cpSync('icons', 'dist/icons', { recursive: true });
    }
    console.log('Firefox 扩展构建完成!');
}

build().catch(console.error);
