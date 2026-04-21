export interface BridgeVersion {
	version: string;
	buildTime: string;
	pluginVersion: string;
}

export interface PathMapEntry {
	vuepressPath: string;
	sourceRelPath: string;
	title: string;
}

export interface PathMapData {
	version: string;
	entries: PathMapEntry[];
}

export interface SyntaxDescriptor {
	id: string;
	pattern: string;
	handler: string;
	fallbackRender: string;
	props?: Record<string, any>;
}

export interface SyntaxDescriptorsData {
	version: string;
	syntaxes: SyntaxDescriptor[];
}

export interface ComponentPropDef {
	name: string;
	type: string;
	required: boolean;
	description: string;
}

export interface ComponentDescriptor {
	name: string;
	tag: string;
	props: ComponentPropDef[];
	fallback: {
		tag: string;
		class?: string;
		styleFrom?: string;
		hrefPrefix?: string;
		hrefFrom?: string;
		staticContent?: string;
		contentFrom?: string;
	};
}

export interface ComponentPropsData {
	version: string;
	components: ComponentDescriptor[];
}

export interface AuthorData {
	name: string;
	slug: string;
	avatar?: string;
	verified?: boolean;
}

export interface AuthorsData {
	version: string;
	authors: Record<string, AuthorData>;
}

export interface PermalinkIndexEntry {
	permalink: string;
	filePath: string;
	title: string;
	collection: string;
}

export interface PermalinkIndexData {
	version: string;
	count: number;
	entries: PermalinkIndexEntry[];
}

export interface PublishStatusEntry {
	mtime: number;
	hash: string;
	publishId?: string;
}

export interface PublishStatusData {
	version: string;
	count: number;
	entries: Record<string, PublishStatusEntry>;
	publishIdIndex: Record<string, string>;
}

export interface BridgeAssets {
	version: BridgeVersion | null;
	pathMap: PathMapData | null;
	syntaxDescriptors: SyntaxDescriptorsData | null;
	componentProps: ComponentPropsData | null;
	authors: AuthorsData | null;
	bridgeCss: string | null;
	permalinkIndex: PermalinkIndexData | null;
	publishStatus: PublishStatusData | null;
}

export const DEFAULT_BRIDGE_ASSETS: BridgeAssets = {
	version: null,
	pathMap: null,
	syntaxDescriptors: null,
	componentProps: null,
	authors: null,
	bridgeCss: null,
	permalinkIndex: null,
	publishStatus: null,
};
