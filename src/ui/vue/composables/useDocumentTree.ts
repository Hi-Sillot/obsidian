import { ref } from 'vue';
import type { DocumentTreeService } from '../../../sync/DocumentTreeService';
import type { DocTreeNode, PullSource } from '../../../types';

export interface TreeNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
  level: number;
  isLeaf: boolean;
  loaded: boolean;
  expanded: boolean;
}

export function useDocumentTree(documentTreeService: DocumentTreeService) {
  const treeNodes = ref<TreeNode[]>([]);
  const isLoadingTree = ref(false);
  const selectedSource = ref<PullSource | null>(null);

  const flattenTree = (nodes: DocTreeNode[], level: number): TreeNode[] => {
    return nodes.map(node => ({
      path: node.path,
      name: node.name,
      type: node.type,
      level,
      isLeaf: node.type === 'file',
      loaded: node.type === 'file',
      expanded: false,
    }));
  };

  const loadDocumentTree = async (source: PullSource) => {
    isLoadingTree.value = true;
    try {
      const tree = await documentTreeService.fetchDocTree(source);
      selectedSource.value = source;
      treeNodes.value = tree.children ? flattenTree(tree.children, 0) : [];
    } catch (error) {
      console.error('[useDocumentTree] 加载文档树失败:', error);
      throw error;
    } finally {
      isLoadingTree.value = false;
    }
  };

  const loadChildrenForNode = async (node: TreeNode) => {
    if (!selectedSource.value) return;

    const children = await documentTreeService.loadChildren(node.path, selectedSource.value);
    const index = treeNodes.value.findIndex(n => n.path === node.path);
    if (index === -1) return;

    const childNodes = children.map(child => ({
      path: child.path,
      name: child.name,
      type: child.type,
      level: node.level + 1,
      isLeaf: child.type === 'file',
      loaded: child.type === 'file',
      expanded: false,
    }));

    treeNodes.value.splice(index + 1, 0, ...childNodes);
    treeNodes.value[index].loaded = true;
  };

  const collapseNode = (index: number) => {
    const node = treeNodes.value[index];
    let i = index + 1;
    while (i < treeNodes.value.length && treeNodes.value[i].level > node.level) {
      treeNodes.value.splice(i, 1);
    }
  };

  const toggleNode = async (node: TreeNode) => {
    if (node.isLeaf) return;

    const index = treeNodes.value.findIndex(n => n.path === node.path);
    if (index === -1) return;

    if (node.expanded) {
      collapseNode(index);
      treeNodes.value[index].expanded = false;
    } else {
      if (!node.loaded) {
        await loadChildrenForNode(node);
      }
      treeNodes.value[index].expanded = true;
    }
  };

  return {
    treeNodes,
    isLoadingTree,
    selectedSource,
    loadDocumentTree,
    toggleNode,
  };
}
