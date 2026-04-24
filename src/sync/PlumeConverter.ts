import type { PullSource } from '../types';

/**
 * VuePress Plume 格式转换器
 *
 * 将非站点文档（普通 Markdown）转换为 VuePress Plume 格式，
 * 主要是添加/规范化 frontmatter。
 *
 * VuePress Plume frontmatter 规范：
 * ```yaml
 * ---
 * title: 文档标题
 * createTime: 2025/11/09 16:12:30
 * permalink: /release_notes/6bmw9z4x/
 * badge:
 *   text: 标签文本
 *   type: danger  # info | warning | success | danger
 * ---
 * ```
 */

export interface PlumeFrontmatter {
	title?: string;
	createTime?: string;
	permalink?: string;
	badge?: {
		text: string;
		type: 'info' | 'warning' | 'success' | 'danger';
	};
	[key: string]: any; // 允许其他自定义字段
}

export interface ConvertToPlumeOptions {
	cloudPath: string; // 云端路径（用于生成 permalink）
	source?: PullSource; // 来源信息
	existingFrontmatter?: Record<string, any>; // 已有的 frontmatter（如果有）
}

/**
 * 从 Markdown 内容中提取标题
 *
 * 优先级：
 * 1. 第一个 # 标题（h1）
 * 2. 文件名（从路径中提取）
 */
function extractTitle(content: string, filePath: string): string {
	const lines = content.split('\n');

	for (const line of lines) {
		const match = line.match(/^#\s+(.+)$/);
		if (match) {
			return match[1].trim();
		}
	}

	return filePath.split('/').pop()?.replace(/\.(md|markdown)$/i, '') || 'Untitled';
}

/**
 * 生成 permalink
 *
 * 基于云端路径生成简洁的 permalink
 */
function generatePermalink(cloudPath: string): string {
	const pathParts = cloudPath.split('/').filter(p => p && p !== 'docs');

	if (pathParts.length === 0) return `/doc/${Date.now().toString(36)}/`;

	const lastPart = pathParts[pathParts.length - 1].replace(/\.(md|markdown)$/i, '');

	if (pathParts.length === 1) {
		return `/doc/${lastPart}/`;
	}

	const category = pathParts[0];
	return `/${category}/${lastPart}/`;
}

/**
 * 检测是否已经是 VuePress Plume 格式
 *
 * 判断条件：
 * 1. 包含 frontmatter
 * 2. frontmatter 中有 title 字段
 * 3. frontmatter 中有 createTime 或 permalink 字段
 */
function isAlreadyPlumeFormat(frontmatter: Record<string, any> | null): boolean {
	if (!frontmatter) return false;

	const hasTitle = !!frontmatter.title;
	const hasMetadata = !!(frontmatter.createTime || frontmatter.permalink);

	return hasTitle && hasMetadata;
}

/**
 * 将普通 Markdown 内容转换为 VuePress Plume 格式
 *
 * @param content 原始 Markdown 内容
 * @param options 转换选项
 * @returns 转换后的内容（包含规范化的 frontmatter）
 */
export function convertToPlumeFormat(
	content: string,
	options: ConvertToPlumeOptions
): { content: string; frontmatter: PlumeFrontmatter; converted: boolean } {
	const { cloudPath, source, existingFrontmatter } = options;

	let frontmatterData: PlumeFrontmatter = {};
	let body = content;
	let converted = false;

	// 解析现有的 frontmatter
	const existingFm = existingFrontmatter || parseSimpleFrontmatter(content);

	if (existingFm) {
		body = extractBody(content);
		frontmatterData = { ...existingFm };
	}

	// 检查是否需要转换
	if (!isAlreadyPlumeFormat(existingFm)) {
		converted = true;

		// 提取或生成 title
		if (!frontmatterData.title) {
			frontmatterData.title = extractTitle(body, cloudPath);
		}

		// 生成 createTime（如果没有）
		if (!frontmatterData.createTime) {
			frontmatterData.createTime = new Date().toLocaleString('zh-CN', {
				year: 'numeric',
				month: '2-digit',
				day: '2-digit',
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit',
				hour12: false,
			}).replace(/(\d+)\/(\d+)\/(\d+)/, '$1/$2/$3');
		}

		// 生成 permalink（如果没有）
		if (!frontmatterData.permalink) {
			frontmatterData.permalink = generatePermalink(cloudPath);
		}
	}

	// 序列化新的 frontmatter
	const newContent = serializeFrontmatter(frontmatterData) + '\n' + body.trim();

	return {
		content: newContent,
		frontmatter: frontmatterData,
		converted,
	};
}

/**
 * 简单的 frontmatter 解析器
 *
 * 解析 YAML frontmatter 为对象
 */
function parseSimpleFrontmatter(content: string): Record<string, any> | null {
	const lines = content.split('\n');
	if (lines[0] !== '---') return null;

	const endIdx = lines.indexOf('---', 1);
	if (endIdx === -1) return null;

	const fmLines = lines.slice(1, endIdx);
	const data: Record<string, any> = {};

	for (const line of fmLines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;

		const kvMatch = trimmed.match(/^([^:]+):\s*(.*)$/);
		if (kvMatch) {
			const key = kvMatch[1].trim();
			const value = parseYamlValue(kvMatch[2].trim());
			data[key] = value;
		}
	}

	return Object.keys(data).length > 0 ? data : null;
}

/**
 * 提取正文内容（去除 frontmatter）
 */
function extractBody(content: string): string {
	const lines = content.split('\n');
	if (lines[0] !== '---') return content;

	const endIdx = lines.indexOf('---', 1);
	if (endIdx === -1) return content;

	return lines.slice(endIdx + 1).join('\n').trim();
}

/**
 * 序列化 frontmatter 对象为 YAML 格式
 */
function serializeFrontmatter(data: Record<string, any>): string {
	const lines: string[] = ['---'];

	for (const [key, value] of Object.entries(data)) {
		if (value === undefined || value === null) continue;

		if (typeof value === 'object' && !Array.isArray(value)) {
			lines.push(`${key}:`);
			for (const [k, v] of Object.entries(value)) {
				lines.push(`  ${k}: ${formatYamlValue(v)}`);
			}
		} else if (Array.isArray(value)) {
			lines.push(`${key}:`);
			for (const item of value) {
				if (typeof item === 'object' && item !== null) {
					lines.push(`  -`);
					for (const [k, v] of Object.entries(item)) {
						lines.push(`    ${k}: ${formatYamlValue(v)}`);
					}
				} else {
					lines.push(`  - ${formatYamlValue(item)}`);
				}
			}
		} else {
			lines.push(`${key}: ${formatYamlValue(value)}`);
		}
	}

	lines.push('---');
	return lines.join('\n');
}

/**
 * 解析 YAML 值
 */
function parseYamlValue(value: string): any {
	if (!value) return '';

	if (value === 'true') return true;
	if (value === 'false') return false;
	if (value === 'null' || value === '~') return null;

	const num = Number(value);
	if (!isNaN(num)) return num;

	if ((value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))) {
		return value.slice(1, -1);
	}

	return value;
}

/**
 * 格式化值为 YAML 字符串
 */
function formatYamlValue(value: any): string {
	if (value === true) return 'true';
	if (value === false) return 'false';
	if (value === null || value === undefined) return 'null';
	if (typeof value === 'string') {
		if (value.includes(':') || value.includes('#') || value.includes('"')) {
			return `"${value}"`;
		}
		return value;
	}
	return String(value);
}
