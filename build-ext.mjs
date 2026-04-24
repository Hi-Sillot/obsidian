import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve('..');
const OUTPUT_FILE = process.argv[2] || path.join(REPO_ROOT, 'sillot_pro_ext.js');

console.log('[build-ext] 侧载依赖包构建开始');
console.log(`[build-ext] 输出路径: ${OUTPUT_FILE}`);

try {
	const result = await esbuild.build({
		entryPoints: {
			ext: './src/bridge/ext-entry.ts',
		},
		bundle: true,
		format: 'iife',
		target: 'es2018',
		minify: true,
		sourcemap: false,
		treeShaking: true,
		outfile: OUTPUT_FILE,
		banner: {
			js: `/**
 * Sillot Pro Extension - 高级功能侧载依赖包
 * 图表渲染等重型库，独立于主插件构建
 * 全局命名空间: window.SillotExt
 */
`,
		},
		footer: {
			js: `
if (typeof console !== 'undefined') console.log('[SillotExt] 高级依赖加载完成, keys=', Object.keys(window.SillotExt || {}));
`,
		},
	});

	const sizeBytes = fs.existsSync(OUTPUT_FILE) ? fs.statSync(OUTPUT_FILE).size : 0;
	console.log(`[build-ext] 构建成功 (${(sizeBytes / 1024 / 1024).toFixed(2)} MB, ${sizeBytes} bytes)`);
} catch (err) {
	console.error('[build-ext] 构建失败:', err.message);
	process.exit(1);
}
