import { Notice, requestUrl } from 'obsidian';
import { GitHubApi } from './githubApi';
import type { AssetMapData } from '../bridge/types';

export type ConfigType = 'friends' | 'readme' | 'vuepress' | 'assets';

export interface AssetFile {
	name: string;
	path: string;
	size: number;
	lastModified: string;
	url: string;
	type: 'file' | 'dir';
}

export interface AssetUploadResult {
	success: boolean;
	commitSha?: string;
	branch?: string;
	prUrl?: string;
	prNumber?: number;
	error?: string;
}

export interface VuePressConfigFile {
	name: string;
	path: string;
	type: 'file' | 'dir';
	size: number;
	content?: string;
	children?: VuePressConfigFile[];
}

export interface VuePressConfigBundle {
	version: string;
	buildTime: string;
	docsRepo: string;
	docsBranch: string;
	vuepressDir: string;
	files: VuePressConfigFile[];
}

export interface ConfigUpdateResult {
	success: boolean;
	commitSha?: string;
	prUrl?: string;
	prNumber?: number;
	error?: string;
}

export interface ValidationResult {
	valid: boolean;
	errors: string[];
}

export interface FrontmatterUpdate {
	filePath: string;
	updates: Record<string, any>;
}

export class ConfigEditor {
	private api: GitHubApi;
	private docsDir: string;
	private siteDomain: string;
	private configBundle: VuePressConfigBundle | null = null;
	private assetMapData: AssetMapData | null = null;
	private assetMapLoaded: boolean = false;

	constructor(api: GitHubApi, docsDir: string = 'docs', siteDomain: string = '') {
		this.api = api;
		this.docsDir = docsDir.replace(/^\/+|\/+$/g, '');
		this.siteDomain = siteDomain.replace(/\/+$/, '');
	}

	setConfigBundle(bundle: VuePressConfigBundle | null) {
		this.configBundle = bundle;
	}

	setAssetMap(assetMap: AssetMapData | null) {
		this.assetMapData = assetMap;
		this.assetMapLoaded = assetMap !== null;
	}

	async ensureAssetMap(): Promise<void> {
		if (this.assetMapLoaded || !this.siteDomain) return;
		try {
			const url = `${this.siteDomain}/obsidian-bridge/asset-map.json`;
			const res = await requestUrl({ url, throw: false });
			if (res.status === 200 && typeof res.json === 'object' && res.json?.map) {
				this.assetMapData = res.json as AssetMapData;
				this.assetMapLoaded = true;
			}
		} catch {
			// 拉取失败则忽略，使用源文件名作为回退
		}
	}

	getVuePressDir(): string {
		return `${this.docsDir}/.vuepress`;
	}

	async fetchVuePressTree(): Promise<VuePressConfigFile[]> {
		if (this.configBundle?.files) {
			return this.configBundle.files;
		}
		const vuepressDir = this.getVuePressDir();
		return this.fetchDirectoryTree(vuepressDir);
	}

	private async fetchDirectoryTree(path: string, depth: number = 0): Promise<VuePressConfigFile[]> {
		if (depth > 3) return [];

		try {
			const items = await this.api.listDirectory(path);
			const result: VuePressConfigFile[] = [];

			for (const item of items) {
				if (item.name.startsWith('.')) continue;

				if (item.type === 'dir') {
					const children = await this.fetchDirectoryTree(item.path, depth + 1);
					result.push({
						name: item.name,
						path: item.path,
						type: 'dir',
						size: 0,
						children,
					});
				} else {
					result.push({
						name: item.name,
						path: item.path,
						type: 'file',
						size: item.size,
					});
				}
			}

			return result;
		} catch {
			return [];
		}
	}

	getConfigPath(type: ConfigType): string {
		switch (type) {
			case 'friends':
				return `${this.docsDir}/friends.md`;
			case 'readme':
				return `${this.docsDir}/README.md`;
			case 'vuepress':
				return this.getVuePressDir();
			case 'assets':
				return this.getAssetsDir();
			default:
				return '';
		}
	}

	getConfigTitle(type: ConfigType): string {
		switch (type) {
			case 'friends':
				return 'docs/friends.md (友情链接)';
			case 'readme':
				return 'docs/README.md (文档首页)';
			case 'vuepress':
				return '.vuepress (VuePress配置)';
			case 'assets':
				return '附件管理';
			default:
				return '';
		}
	}

	async fetchConfig(type: ConfigType): Promise<string | null> {
		if (this.configBundle?.files) {
			if (type === 'friends') {
				const fullPath = this.getConfigPath('friends');
				const content = this.findFileContent(this.configBundle.files, fullPath);
				if (content !== null) return content;
				return this.findFileContentByName(this.configBundle.files, 'friends.md');
			}
			if (type === 'readme') {
				const fullPath = this.getConfigPath('readme');
				const content = this.findFileContent(this.configBundle.files, fullPath);
				if (content !== null) return content;
				return this.findFileContentByName(this.configBundle.files, 'README.md');
			}
			if (type === 'vuepress' || type === 'assets') {
				// 目录类型，不是单个文件，无法返回单一内容
				return null;
			}
		}

		if (type === 'vuepress' || type === 'assets') {
			// 目录类型，不能通过 getFileContent 获取
			return null;
		}

		const path = this.getConfigPath(type);
		if (!path) return null;
		return this.api.getFileContent(path);
	}

	async fetchFileContent(filePath: string): Promise<string | null> {
		if (this.configBundle?.files) {
			const found = this.findFileContent(this.configBundle.files, filePath);
			if (found !== null) return found;
			// 如果完整路径没找到，试试只匹配文件名
			const filename = filePath.split('/').pop() || filePath;
			return this.findFileContentByName(this.configBundle.files, filename);
		}
		return this.api.getFileContent(filePath);
	}

	private findFileContent(files: VuePressConfigFile[], targetPath: string): string | null {
		for (const file of files) {
			if (file.path === targetPath) {
				return file.content ?? null;
			}
			if (file.children) {
				const found = this.findFileContent(file.children, targetPath);
				if (found !== null) return found;
			}
		}
		return null;
	}
	
	private findFileContentByName(files: VuePressConfigFile[], filename: string): string | null {
		for (const file of files) {
			if (file.name === filename) {
				return file.content ?? null;
			}
			if (file.children) {
				const found = this.findFileContentByName(file.children, filename);
				if (found !== null) return found;
			}
		}
		return null;
	}

	parseFrontmatter(content: string): { data: Record<string, any>; body: string } | null {
		const lines = content.split(/\r?\n/);
		if (lines[0] !== '---') return null;

		const endIdx = lines.indexOf('---', 1);
		if (endIdx === -1) return null;

		const frontmatterLines = lines.slice(1, endIdx);
		const body = lines.slice(endIdx + 1).join('\n');

		const data: Record<string, any> = {};
		let currentKey = '';
		let isList = false;
		let listItems: any[] = [];
		// 当前正在构建的列表内对象，null 表示不在对象构建中
		let currentObject: Record<string, any> | null = null;

		const finishCurrentObject = () => {
			if (currentObject && Object.keys(currentObject).length > 0) {
				listItems.push(currentObject);
			}
			currentObject = null;
		};

		const finishList = () => {
			finishCurrentObject();
			if (listItems.length > 0) {
				data[currentKey] = listItems;
			} else {
				data[currentKey] = [];
			}
			isList = false;
			listItems = [];
		};

		for (const line of frontmatterLines) {
			const trimmed = line.trim();
			const isIndented = line !== trimmed && (/^\s/.test(line));

			if (isList) {
				if (trimmed === '') {
					continue;
				}

				if (trimmed === '-' || trimmed.startsWith('- ')) {
					finishCurrentObject();

					const itemContent = trimmed === '-' ? '' : trimmed.substring(2).trim();
					if (itemContent === '') {
						currentObject = {};
					} else {
						const kvMatch = itemContent.match(/^([^:]+):\s*(.*)$/);
						if (kvMatch) {
							currentObject = {};
							currentObject[kvMatch[1].trim()] = this.parseYamlValue(kvMatch[2].trim());
						} else {
							listItems.push(this.parseYamlValue(itemContent));
						}
					}
				} else if (isIndented) {
					const propMatch = trimmed.match(/^([^:]+):\s*(.*)$/);
					if (propMatch && currentObject) {
						currentObject[propMatch[1].trim()] = this.parseYamlValue(propMatch[2].trim());
					} else if (propMatch && !currentObject && listItems.length > 0) {
						const lastItem = listItems[listItems.length - 1];
						if (typeof lastItem === 'object' && lastItem !== null) {
							lastItem[propMatch[1].trim()] = this.parseYamlValue(propMatch[2].trim());
						}
					}
				} else {
					finishList();
				}

				if (isList) continue;
			}

			// 非列表模式
			if (trimmed === '') continue;

			const keyMatch = trimmed.match(/^([^:]+):\s*(.*)$/);
			if (keyMatch) {
				currentKey = keyMatch[1].trim();
				const valueStr = keyMatch[2].trim();

				if (valueStr === '[') {
					// 内联空列表开始
					isList = true;
					listItems = [];
					currentObject = null;
				} else if (valueStr === '') {
					// 空值：可能是列表的前缀（下一行以 "- " 开头），也可能是空字符串
					// 先进入列表模式，如果没有列表项则保存为空字符串
					isList = true;
					listItems = [];
					currentObject = null;
				} else {
					data[currentKey] = this.parseYamlValue(valueStr);
				}
			}
		}

		// 收尾：处理未结束的列表
		if (isList) {
			finishCurrentObject();
			if (listItems.length > 0) {
				data[currentKey] = listItems;
			} else {
				// 没有列表项，保存为空字符串
				data[currentKey] = '';
			}
		}

		return { data, body };
	}

	private parseYamlValue(valueStr: string): any {
		if (valueStr.startsWith('"') && valueStr.endsWith('"')) {
			return valueStr.slice(1, -1);
		} else if (valueStr.startsWith("'") && valueStr.endsWith("'")) {
			return valueStr.slice(1, -1);
		} else if (valueStr === 'true') {
			return true;
		} else if (valueStr === 'false') {
			return false;
		} else if (/^\d+$/.test(valueStr)) {
			return parseInt(valueStr, 10);
		} else if (/^\d+\.\d+$/.test(valueStr)) {
			return parseFloat(valueStr);
		} else {
			return valueStr;
		}
	}

	serializeFrontmatter(data: Record<string, any>): string {
		const lines: string[] = ['---'];

		for (const [key, value] of Object.entries(data)) {
			if (Array.isArray(value)) {
				if (value.length === 0) {
					lines.push(`${key}: []`);
				} else if (value.every(v => typeof v !== 'object' || v === null)) {
					// 简单值数组，使用内联格式
					const items = value.map(v => this.serializeYamlValue(v));
					lines.push(`${key}: [${items.join(', ')}]`);
				} else {
					// 对象数组，使用多行格式
					lines.push(`${key}:`);
					for (const item of value) {
						if (typeof item === 'object' && item !== null) {
							const entries = Object.entries(item);
							if (entries.length > 0) {
								lines.push(`  - ${entries[0][0]}: ${this.serializeYamlValue(entries[0][1])}`);
								for (let i = 1; i < entries.length; i++) {
									lines.push(`    ${entries[i][0]}: ${this.serializeYamlValue(entries[i][1])}`);
								}
							} else {
								lines.push(`  - {}`);
							}
						} else {
							lines.push(`  - ${this.serializeYamlValue(item)}`);
						}
					}
				}
			} else if (typeof value === 'string') {
				lines.push(`${key}: ${this.serializeYamlValue(value)}`);
			} else if (typeof value === 'boolean') {
				lines.push(`${key}: ${value}`);
			} else if (typeof value === 'number') {
				lines.push(`${key}: ${value}`);
			} else if (value === null || value === undefined) {
				lines.push(`${key}:`);
			} else {
				lines.push(`${key}: ${String(value)}`);
			}
		}

		lines.push('---');
		return lines.join('\n');
	}

	private serializeYamlValue(value: any): string {
		if (typeof value === 'string') {
			if (value === '' || value.includes(':') || value.includes('#') || value.includes('"') || value.includes("'")) {
				return `"${value.replace(/"/g, '\\"')}"`;
			}
			return value;
		}
		if (typeof value === 'boolean') return String(value);
		if (typeof value === 'number') return String(value);
		if (value === null || value === undefined) return '';
		return String(value);
	}

	async updateFileFrontmatter(
		filePath: string,
		updates: Record<string, any>,
		options: {
			createPR: boolean;
			commitMessage?: string;
			onProgress?: (percent: number, message: string) => void;
		}
	): Promise<ConfigUpdateResult> {
		const progress = options.onProgress || (() => {});

		try {
			progress(10, '获取文件内容...');
			const content = await this.api.getFileContent(filePath);
			if (content === null) {
				return { success: false, error: '无法获取文件内容' };
			}

			progress(30, '解析 Frontmatter...');
			const parsed = this.parseFrontmatter(content);
			if (!parsed) {
				return { success: false, error: '文件不包含有效的 Frontmatter' };
			}

			progress(50, '更新 Frontmatter...');
			const newData = { ...parsed.data, ...updates };
			const newFrontmatter = this.serializeFrontmatter(newData);
			const newContent = newFrontmatter + '\n' + parsed.body;

			progress(70, '上传到 GitHub...');
			const defaultMsg = `更新 Frontmatter: ${filePath}`;
			const base64Content = btoa(unescape(encodeURIComponent(newContent)));

			const result = await this.api.publishFiles(
				[{ path: filePath, content: base64Content }],
				{
					commitMessage: options.commitMessage || defaultMsg,
					baseBranch: await this.api.getDefaultBranch(),
					targetBranch: options.createPR ? `fm-update/${Date.now()}` : await this.api.getDefaultBranch(),
					createPR: options.createPR,
					onProgress: (percent, msg) => {
						progress(70 + Math.round(percent * 0.25), msg);
					},
				}
			);

			progress(100, '更新完成');
			return {
				success: true,
				commitSha: result.commitSha,
				prUrl: result.prUrl,
				prNumber: result.prNumber,
			};
		} catch (error: any) {
			new Notice(`更新失败: ${error.message}`, 4000);
			return { success: false, error: error.message };
		}
	}

	async updateConfig(
		type: ConfigType,
		content: string,
		options: {
			createPR: boolean;
			commitMessage?: string;
			onProgress?: (percent: number, message: string) => void;
		}
	): Promise<ConfigUpdateResult> {
		const progress = options.onProgress || (() => {});

		try {
			progress(10, '准备保存...');

			if (type === 'vuepress' || type === 'assets') {
				return { success: false, error: '此类型是目录，请使用对应的方法更新具体文件' };
			}

			const path = this.getConfigPath(type);
			if (!path) {
				return { success: false, error: '无效的配置类型' };
			}

			const validation = this.validateConfig(type, content);
			if (!validation.valid) {
				return { success: false, error: validation.errors.join('; ') };
			}

			progress(30, '编码文件内容...');
			const base64Content = btoa(unescape(encodeURIComponent(content)));

			progress(50, '上传到 GitHub...');
			const defaultMsg = `更新配置文件: ${path}`;
			const result = await this.api.publishFiles(
				[{ path, content: base64Content }],
				{
					commitMessage: options.commitMessage || defaultMsg,
					baseBranch: await this.api.getDefaultBranch(),
					targetBranch: options.createPR ? `config-update/${Date.now()}` : await this.api.getDefaultBranch(),
					createPR: options.createPR,
					onProgress: (percent, msg) => {
						progress(50 + Math.round(percent * 0.45), msg);
					},
				}
			);

			progress(100, '保存完成');
			new Notice(`配置文件已${options.createPR ? '提交为 PR' : '直接更新'}`, 3000);
			return {
				success: true,
				commitSha: result.commitSha,
				prUrl: result.prUrl,
				prNumber: result.prNumber,
			};
		} catch (error: any) {
			new Notice(`更新配置失败: ${error.message}`, 4000);
			return {
				success: false,
				error: error.message,
			};
		}
	}

	async updateVuePressFile(
		filePath: string,
		content: string,
		options: {
			createPR: boolean;
			commitMessage?: string;
			onProgress?: (percent: number, message: string) => void;
		}
	): Promise<ConfigUpdateResult> {
		const progress = options.onProgress || (() => {});

		try {
			progress(10, '准备保存...');

			if (!filePath.startsWith(this.getVuePressDir())) {
				return { success: false, error: '只能编辑 .vuepress 目录下的文件' };
			}

			progress(30, '编码文件内容...');
			const base64Content = btoa(unescape(encodeURIComponent(content)));

			progress(50, '上传到 GitHub...');
			const defaultMsg = `更新 VuePress 配置: ${filePath}`;
			const result = await this.api.publishFiles(
				[{ path: filePath, content: base64Content }],
				{
					commitMessage: options.commitMessage || defaultMsg,
					baseBranch: await this.api.getDefaultBranch(),
					targetBranch: options.createPR ? `vuepress-update/${Date.now()}` : await this.api.getDefaultBranch(),
					createPR: options.createPR,
					onProgress: (percent, msg) => {
						progress(50 + Math.round(percent * 0.45), msg);
					},
				}
			);

			progress(100, '保存完成');
			new Notice(`配置文件已${options.createPR ? '提交为 PR' : '直接更新'}`, 3000);
			return {
				success: true,
				commitSha: result.commitSha,
				prUrl: result.prUrl,
				prNumber: result.prNumber,
			};
		} catch (error: any) {
			new Notice(`更新配置失败: ${error.message}`, 4000);
			return {
				success: false,
				error: error.message,
			};
		}
	}

	validateConfig(type: ConfigType, content: string): ValidationResult {
		const errors: string[] = [];

		switch (type) {
			case 'friends':
				return this.validateFriends(content);
			case 'vuepress':
				return this.validateVuepressConfig(content);
			case 'readme':
				return this.validateReadme(content);
			case 'assets':
				return { valid: true, errors: [] };
			default:
				errors.push(`未知配置类型: ${type}`);
				return { valid: false, errors };
		}
	}

	// Friends 相关功能
	parseFriends(content: string): { friends: Array<{ name: string; link: string; avatar: string; desc: string }>; body: string } {
		const parsed = this.parseFrontmatter(content);
		if (!parsed) {
			return { friends: [], body: content };
		}

		const friends: Array<{ name: string; link: string; avatar: string; desc: string }> = [];
		if (Array.isArray(parsed.data.list)) {
			for (const item of parsed.data.list) {
				if (item && typeof item === 'object') {
					friends.push({
						name: String(item.name || ''),
						link: String(item.link || ''),
						avatar: String(item.avatar || ''),
						desc: String(item.desc || ''),
					});
				}
			}
		}

		return { friends, body: parsed.body };
	}

	serializeFriends(friends: Array<{ name: string; link: string; avatar: string; desc: string }>, originalBody: string): string {
		const data: any = {
			friends: true,
			title: '友情链接',
			description: '人生何处不相逢',
			permalink: '/friends/',
			contentPosition: 'before',
			list: friends.map(f => ({
				name: f.name,
				link: f.link,
				avatar: f.avatar,
				desc: f.desc,
			})),
		};

		const frontmatter = this.serializeFrontmatter(data);
		return frontmatter + '\n' + originalBody;
	}

	private validateFriends(content: string): ValidationResult {
		const errors: string[] = [];
		const parsed = this.parseFrontmatter(content);

		if (!parsed) {
			errors.push('文件不包含有效的 Frontmatter');
			return { valid: false, errors };
		}

		if (!parsed.data.list || !Array.isArray(parsed.data.list)) {
			errors.push('缺少 list 字段或不是数组');
		}

		return { valid: errors.length === 0, errors };
	}

	validatePermalink(permalink: string): ValidationResult {
		const errors: string[] = [];

		if (!permalink) {
			errors.push('Permalink 不能为空');
		} else if (!permalink.startsWith('/')) {
			errors.push('Permalink 必须以 / 开头');
		} else if (permalink.endsWith('/') === false && !permalink.endsWith('.html')) {
			errors.push('Permalink 应以 / 或 .html 结尾');
		}

		return { valid: errors.length === 0, errors };
	}



	private validateVuepressConfig(content: string): ValidationResult {
		const errors: string[] = [];

		if (!content.trim()) {
			errors.push('配置文件内容不能为空');
		}

		if (content.includes('\t')) {
			errors.push('配置文件不应使用 Tab 缩进，请使用空格');
		}

		return { valid: errors.length === 0, errors };
	}

	private validateReadme(content: string): ValidationResult {
		const errors: string[] = [];

		if (!content.trim()) {
			errors.push('README 内容不能为空');
		}

		return { valid: errors.length === 0, errors };
	}

	private validateFrontmatter(content: string): ValidationResult {
		const errors: string[] = [];
		const parsed = this.parseFrontmatter(content);

		if (!parsed) {
			errors.push('文件不包含有效的 Frontmatter');
			return { valid: false, errors };
		}

		if (parsed.data.permalink) {
			const permalinkValidation = this.validatePermalink(parsed.data.permalink);
			if (!permalinkValidation.valid) {
				errors.push(...permalinkValidation.errors.map(e => `permalink: ${e}`));
			}
		}

		return { valid: errors.length === 0, errors };
	}

	async getConfigList(): Promise<{ type: ConfigType; path: string; title: string }[]> {
		return [
			{ type: 'friends', path: this.getConfigPath('friends'), title: this.getConfigTitle('friends') },
			{ type: 'readme', path: this.getConfigPath('readme'), title: this.getConfigTitle('readme') },
		];
	}

	// 附件管理相关功能

	getAssetsDir(): string {
		return `${this.docsDir}/assets`;
	}

	async fetchAssetList(subPath: string = ''): Promise<AssetFile[]> {
		const dirPath = subPath
			? `${this.getAssetsDir()}/${subPath.replace(/^\/+|\/+$/g, '')}`
			: this.getAssetsDir();

		await this.ensureAssetMap();

		try {
			const items = await this.api.listDirectory(dirPath);
			return items.map(item => ({
				name: item.name,
				path: item.path,
				size: item.size,
				lastModified: item.lastModified,
				type: item.type,
				url: item.type === 'file'
					? this.getAssetUrl(item.name)
					: '',
			}));
		} catch {
			return [];
		}
	}

	private getAssetUrl(sourceFileName: string): string {
		if (!this.siteDomain) return '';
		const cleanDomain = this.siteDomain.replace(/\/+$/, '');
		// 优先从 map 中查找（含哈希映射的文件）
		const distFileName = this.assetMapData?.map?.[sourceFileName];
		if (distFileName) {
			return `${cleanDomain}/assets/${distFileName}`;
		}
		// 回退：从 sourceFiles 中查找（站点端会将未处理的源文件也复制到 dist/assets）
		const inSourceFiles = this.assetMapData?.sourceFiles?.some(sf => sf.name === sourceFileName);
		if (inSourceFiles) {
			return `${cleanDomain}/assets/${sourceFileName}`;
		}
		return '';
	}

	async uploadAsset(
		fileName: string,
		contentBase64: string,
		subPath: string = '',
		options: {
			createPR?: boolean;
			commitMessage?: string;
			onProgress?: (percent: number, message: string) => void;
		} = {}
	): Promise<AssetUploadResult> {
		const progress = options.onProgress || (() => {});
		const createPR = options.createPR ?? true;

		// GitHub API 单文件大小限制 100MB
		const GITHUB_FILE_SIZE_LIMIT = 100 * 1024 * 1024;
		const fileSizeBytes = Math.ceil(contentBase64.length * 3 / 4);
		if (fileSizeBytes > GITHUB_FILE_SIZE_LIMIT) {
			const sizeMB = (fileSizeBytes / 1024 / 1024).toFixed(1);
			new Notice(`文件大小 ${sizeMB}MB 超过 GitHub 限制 (100MB)`, 5000);
			return { success: false, error: `文件大小 ${sizeMB}MB 超过 GitHub 限制 (100MB)` };
		}

		try {
			progress(10, '准备上传附件...');

			const dirPath = subPath
				? `${this.getAssetsDir()}/${subPath.replace(/^\/+|\/+$/g, '')}`
				: this.getAssetsDir();
			const filePath = `${dirPath}/${fileName}`;

			progress(30, '上传到 GitHub...');
			const defaultMsg = `上传附件: ${filePath}`;
			const result = await this.api.publishFiles(
				[{ path: filePath, content: contentBase64 }],
				{
					commitMessage: options.commitMessage || defaultMsg,
					baseBranch: await this.api.getDefaultBranch(),
					targetBranch: createPR ? `asset-upload/${Date.now()}` : await this.api.getDefaultBranch(),
					createPR,
					onProgress: (percent, msg) => {
						progress(30 + Math.round(percent * 0.65), msg);
					},
				}
			);

			progress(100, '上传完成');
			new Notice(`附件已${createPR ? '提交为 PR' : '直接上传'}`, 3000);
			return {
				success: true,
				commitSha: result.commitSha,
				branch: result.branch,
				prUrl: result.prUrl,
				prNumber: result.prNumber,
			};
		} catch (error: any) {
			new Notice(`上传附件失败: ${error.message}`, 4000);
			return { success: false, error: error.message };
		}
	}

	async renameAsset(
		oldPath: string,
		newFileName: string,
		options: {
			createPR?: boolean;
			commitMessage?: string;
			onProgress?: (percent: number, message: string) => void;
		} = {}
	): Promise<AssetUploadResult> {
		const progress = options.onProgress || (() => {});
		const createPR = options.createPR ?? true;

		try {
			progress(10, '获取原文件内容...');
			const content = await this.api.getFileContent(oldPath);
			if (content === null) {
				return { success: false, error: '无法获取原文件内容，可能文件不存在' };
			}

			progress(30, '编码文件内容...');
			const base64Content = btoa(unescape(encodeURIComponent(content)));

			// 计算新路径：保持目录不变，替换文件名
			const dirPart = oldPath.substring(0, oldPath.lastIndexOf('/'));
			const newPath = `${dirPart}/${newFileName}`;

			progress(50, '上传到 GitHub...');
			const defaultMsg = `重命名附件: ${oldPath} → ${newPath}`;
			const result = await this.api.publishFiles(
				[
					{ path: newPath, content: base64Content },
					{ path: oldPath, content: '' },
				],
				{
					commitMessage: options.commitMessage || defaultMsg,
					baseBranch: await this.api.getDefaultBranch(),
					targetBranch: createPR ? `asset-rename/${Date.now()}` : await this.api.getDefaultBranch(),
					createPR,
					onProgress: (percent, msg) => {
						progress(50 + Math.round(percent * 0.45), msg);
					},
				}
			);

			progress(100, '重命名完成');
			new Notice(`附件已${createPR ? '提交为 PR' : '直接重命名'}`, 3000);
			return {
				success: true,
				commitSha: result.commitSha,
				branch: result.branch,
				prUrl: result.prUrl,
				prNumber: result.prNumber,
			};
		} catch (error: any) {
			new Notice(`重命名附件失败: ${error.message}`, 4000);
			return { success: false, error: error.message };
		}
	}

	async deleteAsset(
		filePath: string,
		options: {
			createPR?: boolean;
			commitMessage?: string;
			onProgress?: (percent: number, message: string) => void;
		} = {}
	): Promise<AssetUploadResult> {
		const progress = options.onProgress || (() => {});
		const createPR = options.createPR ?? true;

		try {
			progress(10, '获取文件 SHA...');
			const sha = await this.api.getFileSha(filePath);
			if (!sha) {
				return { success: false, error: '无法获取文件 SHA，可能文件不存在' };
			}

			const defaultMsg = `删除附件: ${filePath}`;

			if (createPR) {
				progress(30, '创建删除分支...');
				const baseBranch = await this.api.getDefaultBranch();
				const targetBranch = `asset-delete/${Date.now()}`;

				// 用 publishFiles 创建目标分支（空 commit 建立分支）
				const initResult = await this.api.publishFiles(
					[{ path: filePath, content: '' }],
					{
						commitMessage: defaultMsg,
						baseBranch,
						targetBranch,
						createPR: false,
					}
				);

				// 在目标分支上删除文件
				progress(70, '在分支上删除文件...');
				const branchSha = await this.api.getFileSha(filePath, targetBranch);
				if (branchSha) {
					await this.api.deleteFile(filePath, branchSha, defaultMsg, targetBranch);
				}

				// 创建 PR
				progress(85, '创建 Pull Request...');
				const pr = await this.api.createPullRequest({
					title: defaultMsg,
					body: `由 Sillot 插件从 Obsidian 删除附件\n\n${defaultMsg}`,
					head: targetBranch,
					base: baseBranch,
				});

				progress(100, '删除完成');
				new Notice('附件删除已提交为 PR', 3000);
				return {
					success: true,
					commitSha: initResult.commitSha,
					branch: targetBranch,
					prUrl: pr.html_url,
					prNumber: pr.number,
				};
			} else {
				progress(50, '删除文件...');
				await this.api.deleteFile(filePath, sha, options.commitMessage || defaultMsg);
				progress(100, '删除完成');
				new Notice('附件已删除', 3000);
				return { success: true };
			}
		} catch (error: any) {
			new Notice(`删除附件失败: ${error.message}`, 4000);
			return { success: false, error: error.message };
		}
	}
}
