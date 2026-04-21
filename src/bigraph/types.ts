export interface BiGraphNode {
	id: string;
	title: string;
	filePathRelative: string | null;
	permalink: string | null;
	siteUrl: string | null;
	outlink: string[];
	backlink: string[];
	linkCount: number;
	isCurrent?: boolean;
	isIsolated?: boolean;
	x?: number;
	y?: number;
	fx?: number | null;
	fy?: number | null;
}

export interface BiGraphLink {
	source: string | BiGraphNode;
	target: string | BiGraphNode;
}

export interface BiGraphData {
	nodes: BiGraphNode[];
	links: BiGraphLink[];
}

export interface BiGraphConfig {
	siteDomain: string;
	localGraphDeep: number;
	graphHeight: number;
	enableGlobalGraph: boolean;
	enableLocalGraph: boolean;
}

export const DEFAULT_BIGRAPH_CONFIG: BiGraphConfig = {
	siteDomain: '',
	localGraphDeep: 5,
	graphHeight: 300,
	enableGlobalGraph: true,
	enableLocalGraph: true,
};

export const FORCE_CONFIG = {
	link: {
		distance: 100,
		strength: 0.5,
	},
	charge: {
		distanceMin: 10,
		distanceMax: 400,
		strength: (d: BiGraphNode) => -30 - 180 * ((d.linkCount - 1) || 0),
	},
	collision: {
		radius: 30,
		strength: 0.7,
	},
	x_strength: (d: any) => d.isIsolated ? 0.005 : 0.1,
	y_strength: (d: any) => d.isIsolated ? 0.005 : 0.1,
	simulation: {
		alphaDecay: 0.006,
		alphaMin: 0.01,
		velocityDecay: 0.5,
		restart: {
			alpha: 1,
			alphaTarget: 0.3,
		},
	},
};

export const CANVAS_CONFIG = {
	defaultWidth: 300,
	defaultHeight: 300,
	nodeRadius: 5,
	nodePadding: 5,
	zoomExtent: [0.1, 10] as [number, number],
	nodeClickRadius: 15,
	hoverNodeRadius: 8,
};

export const STYLE_CONFIG = {
	link: {
		color: '#aaa',
		normalOpacity: 0.3,
		highlightOpacity: 1,
	},
	node: {
		normalOpacity: 0.3,
		highlightOpacity: 0.8,
	},
	text: {
		font: "12px 'Microsoft YaHei', 'Heiti SC', 'SimHei', -apple-system, sans-serif",
		offset: 20,
		minScale: 0.5,
		maxScale: 1.5,
	},
	currentNode: {
		strokeWidth: 2,
	},
};
