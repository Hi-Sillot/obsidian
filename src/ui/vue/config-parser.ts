export interface NavItem {
	text: string;
	link?: string;
	items?: NavItem[];
}

export interface HeadTag {
	rel?: string;
	type?: string;
	href?: string;
	content?: string;
}

export interface SiteBasicConfig {
	title: string;
	description: string;
	base: string;
	lang: string;
	hostname: string;
	head: HeadTag[];
}

export function parseConfigFile(content: string): SiteBasicConfig | null {
	try {
		const titleMatch = content.match(/title:\s*["']([^"']+)["']/);
		const descMatch = content.match(/description:\s*["']([^"']+)["']/);
		const baseMatch = content.match(/base:\s*["']([^"']+)["']/);
		const langMatch = content.match(/lang:\s*["']([^"']+)["']/);
		const hostMatch = content.match(/hostname:\s*["']([^"']+)["']/);

		return {
			title: titleMatch?.[1] || '',
			description: descMatch?.[1] || '',
			base: baseMatch?.[1] || '/',
			lang: langMatch?.[1] || 'zh-CN',
			hostname: hostMatch?.[1] || '',
			head: [],
		};
	} catch {
		return null;
	}
}

export function serializeConfigFile(config: SiteBasicConfig): string {
	let result = `export default defineUserConfig({
  title: "${config.title}",
  description: "${config.description}",
  base: "${config.base}",
  lang: "${config.lang}",

  head: [
    ["link", { rel: "icon", type: "image.ico", href: "../assets/icon.ico" }],
  ],

  theme: plumeTheme({
    hostname: "${config.hostname}",`;

	return result;
}

export function parseNavbarFile(content: string): NavItem[] {
	try {
		const items: NavItem[] = [];
		const linkRegex = /\{\s*text:\s*["']([^"']+)["']\s*,\s*link:\s*["']([^"']+)["']\s*\}/g;
		let match;
		while ((match = linkRegex.exec(content)) !== null) {
			items.push({ text: match[1], link: match[2] });
		}

		const dropdownRegex = /\{\s*text:\s*["']([^"']+)["']\s*,\s*items:\s*\[([\s\S]*?)\]\s*\}/g;
		let dropdownMatch;
		while ((dropdownMatch = dropdownRegex.exec(content)) !== null) {
			const subItems: NavItem[] = [];
			const subLinkRegex = /\{\s*text:\s*["']([^"']+)["']\s*,\s*link:\s*["']([^"']+)["']\s*\}/g;
			let subMatch;
			while ((subMatch = subLinkRegex.exec(dropdownMatch[2])) !== null) {
				subItems.push({ text: subMatch[1], link: subMatch[2] });
			}
			if (subItems.length > 0) {
				items.push({ text: dropdownMatch[1], items: subItems });
			}
		}

		return items;
	} catch {
		return [];
	}
}

export function serializeNavbarFile(items: NavItem[]): string {
	let result = `import { defineNavbarConfig } from 'vuepress-theme-plume'

export default defineNavbarConfig([
`;

	for (const item of items) {
		if (item.items) {
			result += `  {\n    text: '${item.text}',\n    items: [\n`;
			for (const sub of item.items) {
				result += `      { text: '${sub.text}', link: '${sub.link}' },\n`;
			}
			result += `    ]\n  },\n`;
		} else {
			result += `  { text: '${item.text}', link: '${item.link}' },\n`;
		}
	}

	result += `])`;
	return result;
}

export interface ConfigFileType {
	type: 'config' | 'navbar' | 'collection' | 'unknown';
	name: string;
	editableFields?: Record<string, { label: string; type: 'string' | 'number' | 'boolean' | 'array' | 'object' }>;
}

export function detectConfigType(filename: string): ConfigFileType {
	const name = filename.toLowerCase();

	if (name === 'config.ts') {
		return {
			type: 'config',
			name: 'config.ts',
			editableFields: {
				title: { label: '站点标题', type: 'string' },
				description: { label: '站点描述', type: 'string' },
				base: { label: '基础路径', type: 'string' },
				lang: { label: '语言', type: 'string' },
				hostname: { label: '域名', type: 'string' },
			},
		};
	}

	if (name === 'navbar.ts') {
		return {
			type: 'navbar',
			name: 'navbar.ts',
		};
	}

	if (name === 'collections.ts') {
		return {
			type: 'collection',
			name: 'collections.ts',
		};
	}

	return {
		type: 'unknown',
		name: filename,
	};
}
