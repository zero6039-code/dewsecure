import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const watch = process.argv.includes('--watch');

const buildOptions = {
    entryPoints: ['src/background.js', 'src/content.js'],
    outbase: '.', 
    bundle: true,
    outdir: 'dist',
    format: 'esm',
    target: 'firefox115',
    sourcemap: watch,
    minify: !watch,
};

// 从 Chrome 同步最新源码
function syncFromChrome() {
    console.log('📦 正在从 Chrome 同步最新源码...');
    // 清理旧目录，防止残留干扰
    if (fs.existsSync('src')) fs.rmSync('src', { recursive: true, force: true });
    if (fs.existsSync('popup')) fs.rmSync('popup', { recursive: true, force: true });
    if (fs.existsSync('rules')) fs.rmSync('rules', { recursive: true, force: true });
    if (fs.existsSync('icons')) fs.rmSync('icons', { recursive: true, force: true });

    // 使用 filter 过滤掉 .bak 备份文件
    const filterFn = (src) => !src.endsWith('.bak') && !src.includes('.bak.') && !src.includes('.bak2') && !src.includes('.bak3') && !src.includes('.bak4');
    if (fs.existsSync('../chrome/src')) fs.cpSync('../chrome/src', 'src', { recursive: true, force: true, filter: filterFn });
    if (fs.existsSync('../chrome/popup')) fs.cpSync('../chrome/popup', 'popup', { recursive: true, force: true, filter: filterFn });
    if (fs.existsSync('../chrome/rules')) fs.cpSync('../chrome/rules', 'rules', { recursive: true, force: true, filter: filterFn });
    if (fs.existsSync('../chrome/icons')) fs.cpSync('../chrome/icons', 'icons', { recursive: true, force: true, filter: filterFn });
    console.log('✅ 同步完成！');
}

async function build() {
    syncFromChrome();
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
    
    // 1. 保证 manifest 在 dist 根目录
    if (fs.existsSync('manifest.json')) {
        fs.copyFileSync('manifest.json', 'dist/manifest.json');
    }

    // 2. 全量拷贝 popup 目录（解决 index.html 找不到子模块报错）
    if (fs.existsSync('popup')) {
        fs.cpSync('popup', 'dist/popup', { recursive: true, force: true });
    }

    // 3. 全量拷贝 src 目录（解决 index.html 引用 src/authManager.js 等报错）
    // 注意：esbuild 已经生成了 background.js 和 content.js 在 dist/src/ 下。
    // 全量拷贝会用未压缩的源码覆盖它们，但这对于 Firefox 来说是合法的（避开混淆红线）。
    // 不过为了代码体积和干净度，我们只拷贝出背景脚本外的其他文件。
    if (fs.existsSync('src')) {
        const srcFiles = fs.readdirSync('src');
        for (const file of srcFiles) {
            if (file !== 'background.js' && file !== 'content.js' && file !== 'inject.js' && file !== 'offscreen.js') {
                const srcPath = path.join('src', file);
                const destPath = path.join('dist/src', file);
                if (fs.statSync(srcPath).isDirectory()) {
                    fs.cpSync(srcPath, destPath, { recursive: true, force: true });
                } else {
                    fs.copyFileSync(srcPath, destPath);
                }
            }
        }
    }

    // 4. 拷贝 rules 和 icons
    if (fs.existsSync('icons')) fs.cpSync('icons', 'dist/icons', { recursive: true, force: true });
    if (fs.existsSync('rules')) fs.cpSync('rules', 'dist/rules', { recursive: true, force: true });

    console.log('Firefox 扩展构建完成!');
}

// 每次构建前清空 dist，确保干净
if (fs.existsSync('dist')) {
    fs.rmSync('dist', { recursive: true, force: true });
}

build().catch(console.error);
