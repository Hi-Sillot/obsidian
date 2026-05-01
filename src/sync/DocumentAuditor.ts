export interface AuditIssue {
	type: 'path';
	severity: 'warning' | 'error';
	line: number;
	message: string;
	original: string;
	fixed: string;
}

export interface AuditResult {
	issues: AuditIssue[];
	checkedAt: number;
}

export class DocumentAuditor {
	audit(content: string): AuditResult {
		const issues: AuditIssue[] = [];
		const lines = content.split('\n');

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const lineNum = i + 1;

			this.checkMarkdownImagePath(line, lineNum, issues);
			this.checkHtmlImagePath(line, lineNum, issues);
			this.checkWikiImagePath(line, lineNum, issues);
		}

		return { issues, checkedAt: Date.now() };
	}

	private checkMarkdownImagePath(line: string, lineNum: number, issues: AuditIssue[]): void {
		const regex = /!\[([^\]]*)\]\(([^)]+)\)/g;
		let match;
		while ((match = regex.exec(line)) !== null) {
			const rawPath = match[2].trim();
			if (this.needsDotSlash(rawPath)) {
				const fixed = match[0].replace(`(${match[2]})`, `(./${rawPath})`);
				issues.push({
					type: 'path',
					severity: 'warning',
					line: lineNum,
					message: `图片路径缺少 ./ 前缀（VuePress 不兼容）: ${rawPath}`,
					original: match[0],
					fixed,
				});
			}
		}
	}

	private checkHtmlImagePath(line: string, lineNum: number, issues: AuditIssue[]): void {
		const regex = /<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi;
		let match;
		while ((match = regex.exec(line)) !== null) {
			const rawPath = match[1];
			if (this.needsDotSlash(rawPath)) {
				const fixed = match[0].replace(`src="${rawPath}"`, `src="./${rawPath}"`)
					.replace(`src='${rawPath}'`, `src='./${rawPath}'`);
				issues.push({
					type: 'path',
					severity: 'warning',
					line: lineNum,
					message: `图片路径缺少 ./ 前缀（VuePress 不兼容）: ${rawPath}`,
					original: match[0],
					fixed,
				});
			}
		}
	}

	private checkWikiImagePath(line: string, lineNum: number, issues: AuditIssue[]): void {
		const regex = /!\[\[([^|\]]+)(?:\|[^\]]*)?\]\]/g;
		let match;
		while ((match = regex.exec(line)) !== null) {
			const rawPath = match[1].trim();
			if (this.needsDotSlash(rawPath)) {
				const prefixEnd = match[0].indexOf(match[1]) + match[1].length;
				const suffix = match[0].slice(prefixEnd, -2);
				const fixed = suffix
					? `![[./${rawPath}${suffix}]]`
					: `![[./${rawPath}]]`;
				issues.push({
					type: 'path',
					severity: 'warning',
					line: lineNum,
					message: `Wiki 图片路径缺少 ./ 前缀（VuePress 不兼容）: ${rawPath}`,
					original: match[0],
					fixed,
				});
			}
		}
	}

	private needsDotSlash(path: string): boolean {
		if (path.startsWith('./') || path.startsWith('../')) return false;
		if (path.startsWith('/')) return false;
		if (path.startsWith('http://') || path.startsWith('https://')) return false;
		return true;
	}
}
