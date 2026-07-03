import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { cn } from '../../lib/cn';
import { DependencyArrow } from '../dependency-arrow';

export type GraphNodeStatus =
  | 'compliant'
  | 'partial'
  | 'non-compliant'
  | 'manual-review'
  | 'neutral';

export interface GraphNode {
  id: string;
  label: ReactNode;
  status?: GraphNodeStatus;
  meta?: ReactNode;
  /** Optional manual override for column placement. Otherwise BFS-computed. */
  level?: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  tone?: 'contrast' | 'brand' | 'warning' | 'error';
}

export interface DependencyGraphProps extends Omit<ComponentProps<'div'>, 'children'> {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Pixel gap between columns. Default 64. */
  columnGap?: number;
  /** Pixel gap between nodes within a column. Default 16. */
  rowGap?: number;
  /** Render callback for the node — defaults to a simple labelled pill. */
  renderNode?: (node: GraphNode) => ReactNode;
  /**
   * Ordered list of node IDs forming the critical path. Edges between
   * consecutive IDs are upgraded to `brand` tone + thicker stroke; nodes
   * gain a brand-colored outline ring. Compute with `computeCriticalPath`.
   */
  criticalPath?: string[];
}

/**
 * Compute the longest non-shipped chain through the graph. "Shipped" means
 * `status === 'compliant'`; anything else (partial / non-compliant /
 * manual-review / neutral) counts as in-flight and eligible for the chain.
 *
 * Returns the ordered list of node IDs from root to leaf along the chain.
 * Empty array means no critical path (every leaf is shipped or graph is
 * empty).
 *
 * Algorithm: DP. `chain[id]` = longest non-shipped chain ending at `id`.
 * `chain[id] = 1 + max(chain[parent])` over non-shipped parents, else 1.
 * The path is reconstructed from the node with the highest chain value.
 */
export function computeCriticalPath(nodes: GraphNode[], edges: GraphEdge[]): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, string[]>();
  for (const n of nodes) incoming.set(n.id, []);
  for (const e of edges) {
    if (byId.has(e.from) && byId.has(e.to)) incoming.get(e.to)!.push(e.from);
  }

  const chain = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const visiting = new Set<string>();

  function isShipped(id: string): boolean {
    return byId.get(id)?.status === 'compliant';
  }

  function compute(id: string): number {
    if (chain.has(id)) return chain.get(id)!;
    if (visiting.has(id)) return 0;
    if (isShipped(id)) {
      chain.set(id, 0);
      parent.set(id, null);
      return 0;
    }
    visiting.add(id);
    let best = 1;
    let bestParent: string | null = null;
    for (const p of incoming.get(id) ?? []) {
      if (isShipped(p)) continue;
      const v = compute(p) + 1;
      if (v > best) {
        best = v;
        bestParent = p;
      }
    }
    visiting.delete(id);
    chain.set(id, best);
    parent.set(id, bestParent);
    return best;
  }

  let bestEndId: string | null = null;
  let bestLen = 0;
  for (const n of nodes) {
    const v = compute(n.id);
    if (v > bestLen) {
      bestLen = v;
      bestEndId = n.id;
    }
  }
  if (!bestEndId || bestLen < 2) return [];

  const path: string[] = [];
  let cur: string | null = bestEndId;
  while (cur) {
    path.unshift(cur);
    cur = parent.get(cur) ?? null;
  }
  return path;
}

/**
 * Compute topological level (longest path from any root) for each node.
 * Cycles fall back to `Infinity` and get placed in the rightmost column.
 */
function computeLevels(nodes: GraphNode[], edges: GraphEdge[]): Map<string, number> {
  const ids = new Set(nodes.map((n) => n.id));
  const incoming = new Map<string, string[]>();
  for (const n of nodes) incoming.set(n.id, []);
  for (const e of edges) {
    if (ids.has(e.from) && ids.has(e.to)) {
      incoming.get(e.to)!.push(e.from);
    }
  }

  const levels = new Map<string, number>();
  const visiting = new Set<string>();

  function level(id: string): number {
    const manual = nodes.find((n) => n.id === id)?.level;
    if (manual != null) {
      levels.set(id, manual);
      return manual;
    }
    if (levels.has(id)) return levels.get(id)!;
    if (visiting.has(id)) return Number.POSITIVE_INFINITY;
    visiting.add(id);
    const parents = incoming.get(id) ?? [];
    const lv = parents.length === 0 ? 0 : Math.max(...parents.map(level)) + 1;
    visiting.delete(id);
    levels.set(id, lv);
    return lv;
  }

  for (const n of nodes) level(n.id);
  return levels;
}

const STATUS_CLASSES: Record<GraphNodeStatus, string> = {
  compliant: cn(
    'border-success/40 bg-success-background text-success-foreground',
    'before:bg-success',
  ),
  partial: cn(
    'border-warning/40 bg-warning-background text-warning-foreground',
    'before:bg-warning',
  ),
  'non-compliant': cn(
    'border-error/40 bg-error-background text-error-foreground',
    'before:bg-error',
  ),
  'manual-review': cn(
    'border-info/40 bg-info-background text-info-foreground',
    'before:bg-info',
  ),
  neutral: cn(
    'border-contrast-200 bg-contrast-100 text-contrast-500',
    'before:bg-contrast-300',
  ),
};

/**
 * DependencyGraph — left→right layered DAG layout.
 *
 * Nodes are placed in columns by topological depth (BFS from roots). Within a
 * column, nodes stack vertically in input order. Edges are routed as
 * rounded-elbow arrows by the DependencyArrow primitive, measured against the
 * real DOM rect of each node so they stay correct under resize / theme change.
 *
 * This is the right shape for `hive-meta.blocked_by` chains: position carries
 * "earlier dependencies → later dependents," and the cluster fan-out is the
 * eye-grabbing signal (a wide column = lots of parallel-ready work).
 */
export const DependencyGraph = forwardRef<HTMLDivElement, DependencyGraphProps>(
  function DependencyGraph(
    { className, nodes, edges, columnGap = 64, rowGap = 16, renderNode, criticalPath, ...props },
    ref,
  ) {
    const pathNodeSet = useMemo(() => new Set(criticalPath ?? []), [criticalPath]);
    const pathEdgeSet = useMemo(() => {
      if (!criticalPath || criticalPath.length < 2) return new Set<string>();
      const s = new Set<string>();
      for (let i = 0; i < criticalPath.length - 1; i++) {
        s.add(`${criticalPath[i]}->${criticalPath[i + 1]}`);
      }
      return s;
    }, [criticalPath]);
    const containerRef = useRef<HTMLDivElement>(null);
    const nodeRefs = useRef(new Map<string, HTMLDivElement>());
    const [rects, setRects] = useState<Map<string, DOMRect>>(new Map());

    const columns = useMemo(() => {
      const levels = computeLevels(nodes, edges);
      const byLevel = new Map<number, GraphNode[]>();
      for (const n of nodes) {
        const lv = levels.get(n.id) ?? 0;
        const finite = Number.isFinite(lv) ? lv : -1;
        const arr = byLevel.get(finite) ?? [];
        arr.push(n);
        byLevel.set(finite, arr);
      }
      const sorted = Array.from(byLevel.entries()).sort(([a], [b]) => a - b);
      return sorted.map(([level, items]) => ({ level, items }));
    }, [nodes, edges]);

    useLayoutEffect(() => {
      function measure() {
        const container = containerRef.current;
        if (!container) return;
        const containerRect = container.getBoundingClientRect();
        const next = new Map<string, DOMRect>();
        for (const [id, el] of nodeRefs.current) {
          const r = el.getBoundingClientRect();
          next.set(
            id,
            new DOMRect(r.left - containerRect.left, r.top - containerRect.top, r.width, r.height),
          );
        }
        setRects(next);
      }
      measure();
      const ro = new ResizeObserver(measure);
      if (containerRef.current) ro.observe(containerRef.current);
      window.addEventListener('resize', measure);
      return () => {
        ro.disconnect();
        window.removeEventListener('resize', measure);
      };
    }, [columns]);

    useEffect(() => {
      if (typeof ref === 'function') ref(containerRef.current);
      else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = containerRef.current;
    });

    return (
      <div
        ref={containerRef}
        data-slot="dependency-graph"
        className={cn('relative w-full overflow-x-auto p-4', className)}
        {...props}
      >
        <div
          className="relative grid items-start"
          style={{
            gridTemplateColumns: `repeat(${columns.length}, minmax(220px, 1fr))`,
            columnGap: `${columnGap}px`,
            rowGap: `${rowGap}px`,
          }}
        >
          {columns.map(({ level, items }) => (
            <div
              key={level}
              data-slot="dependency-graph-column"
              data-level={level}
              className="flex flex-col"
              style={{ gap: `${rowGap}px` }}
            >
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-contrast-400">
                {level < 0 ? 'cycle' : `level ${level}`}
              </div>
              {items.map((node) => (
                <div
                  key={node.id}
                  ref={(el) => {
                    if (el) nodeRefs.current.set(node.id, el);
                    else nodeRefs.current.delete(node.id);
                  }}
                  data-slot="dependency-graph-node"
                  data-status={node.status ?? 'neutral'}
                  data-critical-path={pathNodeSet.has(node.id) ? 'true' : undefined}
                  className={cn(
                    'group/node relative flex h-11 items-center gap-2 overflow-hidden rounded-md border pl-3 pr-2.5 text-xs font-medium transition-shadow duration-fast ease-standard',
                    'before:absolute before:inset-y-0 before:left-0 before:w-1',
                    'hover:shadow-sm focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand',
                    STATUS_CLASSES[node.status ?? 'neutral'],
                    pathNodeSet.has(node.id) &&
                      'ring-2 ring-brand ring-offset-2 ring-offset-background',
                  )}
                >
                  {renderNode ? (
                    renderNode(node)
                  ) : (
                    <>
                      <span className="relative truncate">{node.label}</span>
                      {node.meta && (
                        <span className="relative ml-auto shrink-0 font-mono text-[10px] uppercase tracking-wide opacity-70">
                          {node.meta}
                        </span>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          ))}

          {edges.map((e, i) => {
            const a = rects.get(e.from);
            const b = rects.get(e.to);
            if (!a || !b) return null;
            const isCritical = pathEdgeSet.has(`${e.from}->${e.to}`);
            return (
              <DependencyArrow
                key={`${e.from}->${e.to}-${i}`}
                from={{ x: a.left + a.width, y: a.top + a.height / 2 }}
                to={{ x: b.left, y: b.top + b.height / 2 }}
                tone={isCritical ? 'brand' : (e.tone ?? 'contrast')}
                strokeWidth={isCritical ? 2.5 : undefined}
              />
            );
          })}
        </div>
      </div>
    );
  },
);
