import {
  Background,
  Controls,
  MarkerType,
  type Edge,
  type Node,
  Panel,
  Position,
  ReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Spinner } from '../components/ui/Spinner';
import { useRepoGraph } from '../hooks/useRepoGraph';
import { useRepositoryIndexStatus } from '../hooks/useRepositoryIndexStatus';
import type { VizGraph, VizNode } from '../types';

const MODULE_PREFIX = 'module::';
const SELF_SUFFIX = '::__files__';

const FOLDER_WIDTH = 168;
const SYMBOL_WIDTH = 154;
const NODE_HEIGHT = 44;
const LEVEL_GAP = 86;
const SIBLING_GAP = 30;

const KIND_COLORS: Record<string, string> = {
  module: '#4f46e5',
  file: '#64748b',
  class: '#f59e0b',
  function: '#22c55e',
  method: '#14b8a6',
};

const EDGE_COLORS: Record<string, string> = {
  hierarchy: '#64748b',
  references: '#22c55e',
  imports: '#60a5fa',
  tests: '#f59e0b',
};

const KIND_LABELS: Record<string, string> = {
  module: 'Pasta',
  file: 'Arquivo',
  class: 'Classe',
  function: 'Função',
  method: 'Método',
};

const EDGE_LABELS: Record<string, string> = {
  hierarchy: 'Estrutura do repositório',
  references: 'Chama (referência)',
  imports: 'Importa',
  tests: 'Testado por',
};

interface HierarchyItem {
  id: string;
  label: string;
  kind: string;
  path: string;
  expandable: boolean;
  children: HierarchyItem[];
}

interface MeasuredItem {
  item: HierarchyItem;
  width: number;
  children: MeasuredItem[];
}

function directoryOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '(root)' : path.slice(0, slash);
}

function folderName(path: string, isFilesBucket = false): string {
  if (isFilesBucket) return 'arquivos';
  if (path === '(root)') return 'raiz';
  return path.slice(path.lastIndexOf('/') + 1);
}

function nodeWidth(item: HierarchyItem): number {
  return item.kind === 'module' ? FOLDER_WIDTH : SYMBOL_WIDTH;
}

function moduleParentId(node: VizNode): string | null {
  if (node.id.endsWith(SELF_SUFFIX)) return node.id.slice(0, -SELF_SUFFIX.length);
  const parent = directoryOf(node.path);
  return parent === '(root)' ? null : `${MODULE_PREFIX}${parent}`;
}

function ordered(items: HierarchyItem[]): HierarchyItem[] {
  return [...items].sort((left, right) => {
    if (left.kind === 'module' && right.kind !== 'module') return -1;
    if (left.kind !== 'module' && right.kind === 'module') return 1;
    return left.label.localeCompare(right.label, 'pt-BR');
  });
}

function measure(item: HierarchyItem, expandedNodeIds: Set<string>): MeasuredItem {
  const visibleChildren = item.expandable && !expandedNodeIds.has(item.id) ? [] : item.children;
  const children = ordered(visibleChildren).map((child) => measure(child, expandedNodeIds));
  const childrenWidth =
    children.reduce((total, child) => total + child.width, 0) + Math.max(0, children.length - 1) * SIBLING_GAP;

  return { item, children, width: Math.max(nodeWidth(item), childrenWidth) };
}

function visualNode(item: HierarchyItem, x: number, y: number, isExpanded: boolean): Node {
  const isFolder = item.kind === 'module';

  return {
    id: item.id,
    position: { x, y },
    data: { label: item.expandable ? `${isExpanded ? '−' : '+'} ${item.label}` : item.label },
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    style: {
      width: nodeWidth(item),
      height: NODE_HEIGHT,
      background: KIND_COLORS[item.kind] ?? '#64748b',
      color: '#f8fafc',
      border: isFolder ? '1px solid rgba(199, 210, 254, 0.46)' : '1px solid rgba(255,255,255,0.18)',
      borderRadius: isFolder ? 8 : 6,
      boxShadow: isFolder ? '0 8px 20px rgba(15, 23, 42, 0.22)' : '0 4px 12px rgba(15, 23, 42, 0.18)',
      fontSize: 12,
      fontWeight: isFolder ? 650 : 500,
      letterSpacing: isFolder ? '0.02em' : '0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0 10px',
      textAlign: 'center',
      cursor: item.expandable ? 'pointer' : 'default',
      transition: 'opacity 180ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 180ms cubic-bezier(0.16, 1, 0.3, 1)',
    },
  };
}

function hierarchyEdge(source: string, target: string): Edge {
  return {
    id: `hierarchy:${source}->${target}`,
    source,
    target,
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed, width: 15, height: 15 },
    style: {
      stroke: EDGE_COLORS.hierarchy,
      strokeWidth: 1.5,
      opacity: 0.78,
      transition: 'opacity 180ms cubic-bezier(0.16, 1, 0.3, 1)',
    },
  };
}

function place(measured: MeasuredItem, left: number, depth: number, nodes: Node[], edges: Edge[]): void {
  const x = left + (measured.width - nodeWidth(measured.item)) / 2;
  nodes.push(visualNode(measured.item, x, depth * (NODE_HEIGHT + LEVEL_GAP), measured.children.length > 0));

  let childLeft = left;
  for (const child of measured.children) {
    edges.push(hierarchyEdge(measured.item.id, child.item.id));
    place(child, childLeft, depth + 1, nodes, edges);
    childLeft += child.width + SIBLING_GAP;
  }
}

function createFolderItems(symbols: VizNode[]): VizNode[] {
  const directories = new Set<string>();
  for (const symbol of symbols) {
    let directory = directoryOf(symbol.path);
    while (directory !== '(root)') {
      directories.add(directory);
      directory = directoryOf(directory);
    }
    if (directoryOf(symbol.path) === '(root)') directories.add('(root)');
  }

  return [...directories].map((path) => ({
    id: `${MODULE_PREFIX}${path}`,
    label: folderName(path),
    kind: 'module',
    path,
    count: 0,
  }));
}

function buildHierarchyLayout(
  overview: VizGraph,
  expandedNodeIds: Set<string>,
  leafData: Record<string, VizGraph>,
): { nodes: Node[]; edges: Edge[]; expandableIds: Set<string>; leafIds: Set<string> } {
  const isDirectoryTree = overview.stats.truncated === true;
  const modules = isDirectoryTree ? overview.nodes : createFolderItems(overview.nodes);
  const items = new Map<string, HierarchyItem>();
  const roots: HierarchyItem[] = [];
  const expandableIds = new Set<string>();
  const leafIds = new Set<string>();

  for (const module of modules) {
    const hasFolderChildren = modules.some((candidate) => moduleParentId(candidate) === module.id);
    const isLeafFolder = !hasFolderChildren || module.id.endsWith(SELF_SUFFIX);
    if (isDirectoryTree) expandableIds.add(module.id);
    if (isDirectoryTree && isLeafFolder) leafIds.add(module.id);
    items.set(module.id, {
      id: module.id,
      label: folderName(module.path, module.id.endsWith(SELF_SUFFIX)),
      kind: 'module',
      path: module.path,
      expandable: isDirectoryTree,
      children: [],
    });
  }

  for (const module of modules) {
    const item = items.get(module.id)!;
    const parent = moduleParentId(module);
    const parentItem = parent ? items.get(parent) : undefined;
    if (parentItem) parentItem.children.push(item);
    else roots.push(item);
  }

  // Pastas-folha carregam seus símbolos sob demanda. `parentId` preserva a
  // contenção real do AST (arquivo -> classe -> método); `defines` é o fallback
  // para índices antigos que ainda não possuem esse campo.
  const symbolGraphs = isDirectoryTree ? Object.entries(leafData) : [['overview', overview] as const];
  const symbols = new Map<string, VizNode>();
  const symbolParentIds = new Map<string, string>();
  const definesParents = new Map<string, string>();

  for (const [scope, graph] of symbolGraphs) {
    for (const edge of graph.edges) {
      if (edge.kind === 'defines') definesParents.set(edge.target, edge.source);
    }
    for (const symbol of graph.nodes) {
      symbols.set(symbol.id, symbol);
      symbolParentIds.set(symbol.id, isDirectoryTree ? scope : `${MODULE_PREFIX}${directoryOf(symbol.path)}`);
    }
  }

  const symbolsInStructureOrder = [...symbols.entries()].sort(([, left], [, right]) => {
    const rank = { file: 0, class: 1, function: 2, method: 3 } as const;
    const rankDifference = rank[left.kind as keyof typeof rank] - rank[right.kind as keyof typeof rank];
    if (rankDifference !== 0) return rankDifference;
    return left.label.localeCompare(right.label, 'pt-BR');
  });

  const onlyClassByPath = new Map<string, string | null>();
  for (const [symbolId, symbol] of symbolsInStructureOrder) {
    if (symbol.kind !== 'class') continue;
    const current = onlyClassByPath.get(symbol.path);
    onlyClassByPath.set(symbol.path, current === undefined ? symbolId : null);
  }

  for (const [symbolId, symbol] of symbolsInStructureOrder) {
    if (symbol.kind === 'file') continue;
    // Índices gerados antes de `parentId` não precisam esperar uma reindexação para
    // ganhar uma árvore útil: quando há uma única classe no arquivo, associar seus
    // métodos a ela é determinístico. Com duas ou mais classes, não adivinhamos.
    const legacyMethodParent = symbol.kind === 'method' ? onlyClassByPath.get(symbol.path) : undefined;
    const structuralParent = symbol.parentId ?? legacyMethodParent ?? definesParents.get(symbolId);
    if (structuralParent && symbols.has(structuralParent)) symbolParentIds.set(symbolId, structuralParent);
  }

  for (const [symbolId, symbol] of symbolsInStructureOrder) {
    const parent = items.get(symbolParentIds.get(symbolId) ?? '');
    if (!parent) continue;
    const item: HierarchyItem = {
      id: symbol.id,
      label: symbol.label,
      kind: symbol.kind,
      path: symbol.path,
      expandable: false,
      children: [],
    };
    parent.children.push(item);
    items.set(symbolId, item);
  }

  for (const item of items.values()) {
    if (item.kind === 'file' && item.children.length > 0) {
      item.expandable = true;
      expandableIds.add(item.id);
    }
    if (item.kind === 'module' && item.children.length > 0) {
      item.expandable = true;
      expandableIds.add(item.id);
    }
  }

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  let rootLeft = 0;
  for (const root of ordered(roots)) {
    const measured = measure(root, expandedNodeIds);
    place(measured, rootLeft, 0, nodes, edges);
    rootLeft += measured.width + SIBLING_GAP * 2;
  }

  const relationshipEdges = symbolGraphs.flatMap(([, graph]) => graph.edges);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const relationshipIds = new Set<string>();
  for (const edge of relationshipEdges) {
    if (edge.kind === 'defines' || !nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    const id = `relationship:${edge.source}->${edge.target}:${edge.kind}`;
    if (relationshipIds.has(id)) continue;
    relationshipIds.add(id);
    edges.push({
      id,
      source: edge.source,
      target: edge.target,
      type: 'bezier',
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
      animated: edge.kind === 'references',
      style: {
        stroke: EDGE_COLORS[edge.kind] ?? '#94a3b8',
        strokeWidth: 2,
        opacity: 0.96,
        transition: 'opacity 180ms cubic-bezier(0.16, 1, 0.3, 1)',
      },
    });
  }

  return { nodes, edges, expandableIds, leafIds };
}

function applyHoverEmphasis(nodes: Node[], edges: Edge[], hoveredId: string | null): { nodes: Node[]; edges: Edge[] } {
  if (!hoveredId) return { nodes, edges };

  const connected = new Set<string>([hoveredId]);
  for (const edge of edges) {
    if (edge.source === hoveredId) connected.add(edge.target);
    if (edge.target === hoveredId) connected.add(edge.source);
  }
  if (connected.size === 1) return { nodes, edges };

  return {
    nodes: nodes.map((node) => ({
      ...node,
      style: { ...node.style, opacity: connected.has(node.id) ? 1 : 0.14 },
    })),
    edges: edges.map((edge) => ({
      ...edge,
      style: { ...edge.style, opacity: edge.source === hoveredId || edge.target === hoveredId ? 1 : 0.07 },
    })),
  };
}

function Legend() {
  return (
    <Panel position="top-right">
      <div className="w-48 rounded-md border border-border bg-surface-1/92 p-3 text-xs shadow-xl backdrop-blur-sm">
        <p className="mb-1.5 font-mono tracking-[0.1em] text-ink-faint uppercase">Tipos de nó</p>
        {Object.entries(KIND_LABELS).map(([kind, label]) => (
          <div key={kind} className="mb-1 flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: KIND_COLORS[kind] }} />
            <span className="text-ink-faint">{label}</span>
          </div>
        ))}
        <p className="mt-2 mb-1.5 font-mono tracking-[0.1em] text-ink-faint uppercase">Conexões</p>
        {Object.entries(EDGE_LABELS).map(([kind, label]) => (
          <div key={kind} className="mb-1 flex items-center gap-2">
            <span className="inline-block h-0.5 w-3.5" style={{ background: EDGE_COLORS[kind] }} />
            <span className="text-ink-faint">{label}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function RepoGraphPage() {
  const { owner = '', repo = '' } = useParams();
  const { status } = useRepositoryIndexStatus(repo, owner);
  const { tree, error, loading, leafData, toggleLeaf } = useRepoGraph(repo, owner);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(new Set());

  const { rawNodes, rawEdges, expandableIds, leafIds } = useMemo(() => {
    if (!tree) {
      return {
        rawNodes: [] as Node[],
        rawEdges: [] as Edge[],
        expandableIds: new Set<string>(),
        leafIds: new Set<string>(),
      };
    }
    const layout = buildHierarchyLayout(tree, expandedNodeIds, leafData);
    return {
      rawNodes: layout.nodes,
      rawEdges: layout.edges,
      expandableIds: layout.expandableIds,
      leafIds: layout.leafIds,
    };
  }, [tree, expandedNodeIds, leafData]);
  const { nodes, edges } = useMemo(
    () => applyHoverEmphasis(rawNodes, rawEdges, hoveredId),
    [rawNodes, rawEdges, hoveredId],
  );

  const onNodeClick = useCallback(
    (_event: unknown, node: Node) => {
      if (!expandableIds.has(node.id)) return;
      setExpandedNodeIds((current) => {
        const next = new Set(current);
        if (next.has(node.id)) next.delete(node.id);
        else next.add(node.id);
        return next;
      });
      if (leafIds.has(node.id)) toggleLeaf(node.id);
    },
    [expandableIds, leafIds, toggleLeaf],
  );

  const notIndexed = tree !== null && tree.stats.indexed === false;

  return (
    <div>
      {tree?.stats.truncated && (
        <p className="mb-6 text-sm text-ink-dim">
          Comece pela raiz e clique em qualquer pasta ou arquivo para expandir e recolher apenas aquele ramo.
        </p>
      )}

      {loading && (
        <div className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      )}

      {!loading && error && (
        <p className="rounded-sm border border-state-closed/40 bg-state-closed-dim px-4 py-3 text-sm text-ink">
          {error}
        </p>
      )}

      {!loading && !error && notIndexed && (
        <div className="flex flex-col items-center gap-4 rounded-md border border-border bg-surface-1/55 px-6 py-16 text-center">
          <p className="text-sm text-ink-faint">
            Este repositório ainda não foi indexado — indexe pra ver o grafo de código.
          </p>
          <Link
            to={`/repos/${owner}/${repo}/pulls`}
            className="inline-flex min-h-11 items-center justify-center rounded-sm border border-accent bg-accent px-4.5 py-2.5 text-sm font-semibold tracking-wide text-accent-ink transition-colors hover:bg-accent-hover"
          >
            Ir pro repositório indexar
          </Link>
          {status && <p className="text-xs text-ink-faint">status atual: {status.status}</p>}
        </div>
      )}

      {!loading && !error && !notIndexed && tree && tree.nodes.length === 0 && (
        <p className="py-16 text-center text-sm text-ink-faint">Nenhum símbolo encontrado.</p>
      )}

      {!loading && !error && !notIndexed && tree && tree.nodes.length > 0 && (
        <div style={{ height: '75vh' }} className="overflow-hidden rounded-md border border-border bg-surface-1/30">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodeClick={onNodeClick}
            onNodeMouseEnter={(_event, node) => setHoveredId(node.id)}
            onPaneMouseEnter={() => setHoveredId(null)}
            onPaneMouseLeave={() => setHoveredId(null)}
            nodesDraggable={false}
            minZoom={0.05}
            fitView
          >
            <Background color="rgba(148, 163, 184, 0.18)" gap={22} size={1} />
            <Controls />
            <Legend />
          </ReactFlow>
        </div>
      )}
    </div>
  );
}
