export interface SearchColumn {
	key: string;
	label: string;
}

export interface PaginationBarState {
	currentPage: number;
	pageSize: number;
	searchQuery: string;
	searchColumns: string[];
}

export class PaginationBar {
	private columns: SearchColumn[];
	private state: PaginationBarState;
	private onChange: (state: PaginationBarState) => void;
	private columnPopupOpen = false;

	constructor(options: {
		columns: SearchColumn[];
		pageSize?: number;
		defaultSearchColumns?: string[];
		onChange: (state: PaginationBarState) => void;
	}) {
		this.columns = options.columns;
		this.state = {
			currentPage: 1,
			pageSize: options.pageSize || 10,
			searchQuery: '',
			searchColumns: options.defaultSearchColumns || options.columns.map(c => c.key),
		};
		this.onChange = options.onChange;
	}

	getState(): PaginationBarState {
		return { ...this.state };
	}

	setPage(page: number) {
		this.state.currentPage = page;
	}

	resetPage() {
		this.state.currentPage = 1;
	}

	render(container: HTMLElement, totalItems: number) {
		container.empty();
		container.addClass('sillot-pagination-bar');

		const leftSection = container.createDiv({ cls: 'sillot-pagination-left' });
		const totalPages = Math.max(1, Math.ceil(totalItems / this.state.pageSize));
		if (this.state.currentPage > totalPages) this.state.currentPage = totalPages;

		leftSection.createEl('span', { text: `${totalItems} 项`, cls: 'sillot-pagination-info' });

		if (totalPages > 1) {
			const prevBtn = leftSection.createEl('button', { text: '‹', cls: 'sillot-pagination-page-btn' });
			prevBtn.disabled = this.state.currentPage <= 1;
			prevBtn.onclick = () => { this.state.currentPage--; this.onChange(this.state); };

			const pageNums = PaginationBar.getPageNumbers(this.state.currentPage, totalPages);
			for (const p of pageNums) {
				if (p === '...') {
					leftSection.createEl('span', { text: '…', cls: 'sillot-pagination-ellipsis' });
				} else {
					const btn = leftSection.createEl('button', {
						text: `${p}`,
						cls: p === this.state.currentPage
							? 'sillot-pagination-page-btn sillot-pagination-page-btn--active'
							: 'sillot-pagination-page-btn',
					});
					btn.onclick = () => { this.state.currentPage = p as number; this.onChange(this.state); };
				}
			}

			const nextBtn = leftSection.createEl('button', { text: '›', cls: 'sillot-pagination-page-btn' });
			nextBtn.disabled = this.state.currentPage >= totalPages;
			nextBtn.onclick = () => { this.state.currentPage++; this.onChange(this.state); };
		}

		const searchSection = container.createDiv({ cls: 'sillot-pagination-search' });

		const colFilterBtn = searchSection.createEl('button', {
			cls: 'sillot-pagination-col-filter-btn',
			attr: { title: '搜索范围' },
		});
		colFilterBtn.innerHTML = '☰';
		colFilterBtn.onclick = (e) => {
			e.stopPropagation();
			this.toggleColumnPopup(container, colFilterBtn);
		};

		const searchInput = searchSection.createEl('input', {
			cls: 'sillot-pagination-search-input',
			attr: { type: 'text', placeholder: '搜索 (支持 || 和 &&)', value: this.state.searchQuery },
		}) as HTMLInputElement;

		const searchBtn = searchSection.createEl('button', {
			text: '🔍', cls: 'sillot-pagination-search-btn', attr: { title: '搜索' },
		});
		const doSearch = () => {
			this.state.searchQuery = searchInput.value.trim();
			this.state.currentPage = 1;
			this.onChange(this.state);
		};
		searchBtn.onclick = doSearch;
		searchInput.onkeydown = (e) => {
			if (e.key === 'Enter') doSearch();
		};
	}

	private toggleColumnPopup(barContainer: HTMLElement, anchor: HTMLElement) {
		if (this.columnPopupOpen) {
			const existing = barContainer.querySelector('.sillot-pagination-col-popup');
			if (existing) existing.remove();
			this.columnPopupOpen = false;
			return;
		}

		this.columnPopupOpen = true;
		const popup = barContainer.createDiv({ cls: 'sillot-pagination-col-popup' });

		const allChecked = this.state.searchColumns.length === this.columns.length;
		const headerRow = popup.createDiv({ cls: 'sillot-pagination-col-popup-header' });
		const allCheck = headerRow.createEl('input', { attr: { type: 'checkbox' } }) as HTMLInputElement;
		allCheck.checked = allChecked;
		allCheck.onchange = () => {
			this.state.searchColumns = allCheck.checked
				? this.columns.map(c => c.key)
				: [];
			this.renderColumnCheckboxes(popup);
		};
		headerRow.createEl('span', { text: '全选', cls: 'sillot-pagination-col-popup-label' });

		this.renderColumnCheckboxes(popup);

		const closeOnClick = (e: MouseEvent) => {
			if (!popup.contains(e.target as Node) && e.target !== anchor) {
				popup.remove();
				this.columnPopupOpen = false;
				document.removeEventListener('click', closeOnClick);
			}
		};
		setTimeout(() => document.addEventListener('click', closeOnClick), 0);
	}

	private renderColumnCheckboxes(popup: HTMLElement) {
		const existing = popup.querySelector('.sillot-pagination-col-popup-list');
		if (existing) existing.remove();

		const list = popup.createDiv({ cls: 'sillot-pagination-col-popup-list' });
		for (const col of this.columns) {
			const row = list.createDiv({ cls: 'sillot-pagination-col-popup-row' });
			const check = row.createEl('input', { attr: { type: 'checkbox' } }) as HTMLInputElement;
			check.checked = this.state.searchColumns.includes(col.key);
			check.onchange = () => {
				if (check.checked) {
					if (!this.state.searchColumns.includes(col.key)) {
						this.state.searchColumns.push(col.key);
					}
				} else {
					this.state.searchColumns = this.state.searchColumns.filter(k => k !== col.key);
				}
				const headerCheck = popup.querySelector('.sillot-pagination-col-popup-header input') as HTMLInputElement;
				if (headerCheck) {
					headerCheck.checked = this.state.searchColumns.length === this.columns.length;
				}
			};
			row.createEl('span', { text: col.label, cls: 'sillot-pagination-col-popup-label' });
		}
	}

	static getPageNumbers(current: number, total: number): (number | '...')[] {
		if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
		const pages: (number | '...')[] = [1];
		if (current > 3) pages.push('...');
		for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
			pages.push(i);
		}
		if (current < total - 2) pages.push('...');
		pages.push(total);
		return pages;
	}

	static parseSearchQuery(query: string): { mode: 'or' | 'and'; terms: string[] } {
		if (query.includes('||')) {
			return {
				mode: 'or',
				terms: query.split('||').map(s => s.trim().toLowerCase()).filter(s => s.length > 0),
			};
		}
		if (query.includes('&&')) {
			return {
				mode: 'and',
				terms: query.split('&&').map(s => s.trim().toLowerCase()).filter(s => s.length > 0),
			};
		}
		return { mode: 'or', terms: [query.trim().toLowerCase()].filter(s => s.length > 0) };
	}

	static matchesSearch(texts: string[], query: string): boolean {
		if (!query) return true;
		const { mode, terms } = PaginationBar.parseSearchQuery(query);
		if (terms.length === 0) return true;
		const lowerTexts = texts.map(t => t.toLowerCase());
		if (mode === 'or') {
			return terms.some(term => lowerTexts.some(t => t.includes(term)));
		}
		return terms.every(term => lowerTexts.some(t => t.includes(term)));
	}

	static filterBySearch<T>(items: T[], query: string, columns: string[], extractor: (item: T, column: string) => string): T[] {
		if (!query) return items;
		return items.filter(item => {
			const texts = columns.map(col => extractor(item, col));
			return PaginationBar.matchesSearch(texts, query);
		});
	}

	static paginate<T>(items: T[], currentPage: number, pageSize: number): { pageItems: T[]; totalPages: number } {
		const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
		const page = Math.min(currentPage, totalPages);
		const start = (page - 1) * pageSize;
		return { pageItems: items.slice(start, start + pageSize), totalPages };
	}
}
