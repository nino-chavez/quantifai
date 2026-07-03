import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DepGraphData, EpicCompletion, GraphStatus } from '@/lib/status';

const NODE_STATUS_CLASS: Record<GraphStatus, string> = {
  compliant:       'bg-success-background/40 text-success-foreground border-success/40',
  partial:         'bg-warning-background/40 text-warning-foreground border-warning/40',
  'non-compliant': 'bg-error-background/40   text-error-foreground   border-error/40',
  'manual-review': 'bg-info-background/40    text-info-foreground    border-info/40',
  neutral:         'bg-contrast-100/40       text-contrast-500       border-contrast-200',
};
const STATUS_STRIPE_CLASS: Record<GraphStatus, string> = {
  compliant:       'bg-success',
  partial:         'bg-warning',
  'non-compliant': 'bg-error',
  'manual-review': 'bg-info',
  neutral:         'bg-contrast-300',
};
const MINIMAP_DOT_FILL: Record<GraphStatus, string> = {
  compliant:       'fill-success',
  partial:         'fill-warning',
  'non-compliant': 'fill-error',
  'manual-review': 'fill-info',
  neutral:         'fill-contrast-300',
};

function completionToStatus(pct: number): GraphStatus {
  if (pct >= 60) return 'compliant';
  if (pct >= 20) return 'partial';
  return 'non-compliant';
}

interface LayoutNode {
  id: string;
  label: string;
  status: GraphStatus;
  meta?: string;
  url?: string;
  level: number;
}

interface ProcessedGraph {
  nodes: LayoutNode[];
  edges: Array<{ from: string; to: string }>;
  byLevel: Map<number, LayoutNode[]>;
  criticalIds: Set<string>;
  criticalEdgeKeys: Set<string>;
  criticalPath: LayoutNode[];
}

function computeLevels(nodes: { id: string }[], edges: { from: string; to: string }[]): Map<string, number> {
  const ids = new Set(nodes.map((n) => n.id));
  const incoming = new Map<string, string[]>();
  for (const n of nodes) incoming.set(n.id, []);
  for (const e of edges) {
    if (ids.has(e.from) && ids.has(e.to)) incoming.get(e.to)!.push(e.from);
  }
  const levels = new Map<string, number>();
  const visiting = new Set<string>();
  function lv(id: string): number {
    if (levels.has(id)) return levels.get(id)!;
    if (visiting.has(id)) return Infinity;
    visiting.add(id);
    const parents = incoming.get(id) ?? [];
    const v = parents.length === 0 ? 0 : Math.max(...parents.map(lv)) + 1;
    visiting.delete(id);
    levels.set(id, v);
    return v;
  }
  for (const n of nodes) lv(n.id);
  return levels;
}

function computeCriticalPath(
  nodes: LayoutNode[],
  edges: { from: string; to: string }[],
): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const incoming = new Map<string, string[]>();
  for (const n of nodes) incoming.set(n.id, []);
  for (const e of edges) {
    if (byId.has(e.from) && byId.has(e.to)) incoming.get(e.to)!.push(e.from);
  }
  const isShipped = (id: string) => byId.get(id)?.status === 'compliant';
  const chain = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const visiting = new Set<string>();
  function compute(id: string): number {
    if (chain.has(id)) return chain.get(id)!;
    if (visiting.has(id)) return 0;
    if (isShipped(id)) { chain.set(id, 0); parent.set(id, null); return 0; }
    visiting.add(id);
    let best = 1;
    let bestParent: string | null = null;
    for (const p of incoming.get(id) ?? []) {
      if (isShipped(p)) continue;
      const v = compute(p) + 1;
      if (v > best) { best = v; bestParent = p; }
    }
    visiting.delete(id);
    chain.set(id, best);
    parent.set(id, bestParent);
    return best;
  }
  let bestEnd: string | null = null;
  let bestLen = 0;
  for (const n of nodes) {
    const v = compute(n.id);
    if (v > bestLen) { bestLen = v; bestEnd = n.id; }
  }
  if (!bestEnd || bestLen < 2) return [];
  const path: string[] = [];
  let cur: string | null = bestEnd;
  while (cur) { path.unshift(cur); cur = parent.get(cur) ?? null; }
  return path;
}

/**
 * Resolve a node id to an epic completion, when the consumer's derived graph
 * keys nodes by epic number. Generic: no reference-project issue→epic map.
 * A node id that parses as an integer present in `completions` is treated as
 * that epic; everything else renders with its raw label and status.
 */
function epicForNode(id: string, completions: Map<number, EpicCompletion>): EpicCompletion | undefined {
  const n = Number(id);
  if (!Number.isInteger(n)) return undefined;
  return completions.get(n);
}

function processGraph(
  data: DepGraphData,
  completions: Map<number, EpicCompletion>,
): ProcessedGraph {
  // Render every node the derived artifact supplies — empty at Tier 0. No
  // reference-project scoping; a consumer's dep-graph emitter decides the nodes.
  const scopedNodes = data.nodes;
  const scopedEdges = data.edges;

  const labelOf = (rawLabel: string, id: string): string => {
    const c = epicForNode(id, completions);
    return c ? `${rawLabel} · ${c.percentGreen}%` : rawLabel;
  };
  const statusOf = (rawStatus: GraphStatus, id: string): GraphStatus => {
    const c = epicForNode(id, completions);
    return c ? completionToStatus(c.percentGreen) : rawStatus;
  };

  const levels = computeLevels(scopedNodes, scopedEdges);
  const nodes: LayoutNode[] = scopedNodes.map((n) => {
    const lvl = levels.get(n.id) ?? -1;
    return {
      id: n.id,
      label: labelOf(n.label, n.id),
      status: statusOf(n.status, n.id),
      meta: n.meta,
      url: n.url,
      level: Number.isFinite(lvl) ? lvl : -1,
    };
  });

  const byLevel = new Map<number, LayoutNode[]>();
  for (const n of nodes) {
    if (!byLevel.has(n.level)) byLevel.set(n.level, []);
    byLevel.get(n.level)!.push(n);
  }

  const criticalPathIds = computeCriticalPath(nodes, scopedEdges);
  const criticalIds = new Set(criticalPathIds);
  const criticalEdgeKeys = new Set<string>();
  for (let i = 0; i < criticalPathIds.length - 1; i++) {
    criticalEdgeKeys.add(`${criticalPathIds[i]}->${criticalPathIds[i + 1]}`);
  }
  const criticalPath = criticalPathIds
    .map((id) => nodes.find((n) => n.id === id))
    .filter((n): n is LayoutNode => Boolean(n));

  return { nodes, edges: scopedEdges, byLevel, criticalIds, criticalEdgeKeys, criticalPath };
}

interface EdgeGeometry {
  key: string;
  d: string;
  arrow: string;
  critical: boolean;
}

// Stage layout constants — these define the natural (un-transformed) coordinate
// system the edges, nodes, and minimap all share.
const STAGE_PADDING = 24;
const COLUMN_WIDTH = 220;
const COLUMN_GAP = 64;
const NODE_HEIGHT = 40;
const NODE_VGAP = 12;
const LEVEL_HEADER_HEIGHT = 28;

// Viewport sizing
const VIEWPORT_HEIGHT = 600;
const MIN_SCALE = 0.25;
const MAX_SCALE = 2.5;
const PAN_KEY_STEP = 48;
const ZOOM_KEY_FACTOR = 1.15;

interface DependencyGraphProps {
  data: DepGraphData;
  completions: Record<number, EpicCompletion>;
  generatedAt: string;
}

export function DependencyGraph({ data, completions, generatedAt }: DependencyGraphProps) {
  const completionsMap = useRef<Map<number, EpicCompletion>>(
    new Map(Object.entries(completions).map(([k, v]) => [Number(k), v])),
  );
  const [graph] = useState<ProcessedGraph>(() => processGraph(data, completionsMap.current));

  // Stage natural dimensions, computed deterministically from the column layout
  // constants above. Avoids dependence on DOM measurement timing — the SVG
  // edges can be drawn against this coordinate system as soon as the component
  // mounts.
  const columns = Array.from(graph.byLevel.entries()).sort(([a], [b]) => a - b);
  const maxNodesInCol = Math.max(0, ...columns.map(([, list]) => list.length));
  const stageWidth =
    STAGE_PADDING * 2 +
    columns.length * COLUMN_WIDTH +
    Math.max(0, columns.length - 1) * COLUMN_GAP;
  const stageHeight =
    STAGE_PADDING * 2 + LEVEL_HEADER_HEIGHT + maxNodesInCol * (NODE_HEIGHT + NODE_VGAP);

  // Pre-compute node positions in stage coordinates (no DOM measurement needed).
  const nodePositions = new Map<string, { x: number; y: number; w: number; h: number }>();
  columns.forEach(([, items], colIdx) => {
    items.forEach((node, rowIdx) => {
      const x = STAGE_PADDING + colIdx * (COLUMN_WIDTH + COLUMN_GAP);
      const y = STAGE_PADDING + LEVEL_HEADER_HEIGHT + rowIdx * (NODE_HEIGHT + NODE_VGAP);
      nodePositions.set(node.id, { x, y, w: COLUMN_WIDTH, h: NODE_HEIGHT });
    });
  });

  // Edge geometry — computed once from stage-coordinate positions.
  const edgeGeometry: EdgeGeometry[] = graph.edges
    .map((e): EdgeGeometry | null => {
      const a = nodePositions.get(e.from);
      const b = nodePositions.get(e.to);
      if (!a || !b) return null;
      const from = { x: a.x + a.w, y: a.y + a.h / 2 };
      const to = { x: b.x, y: b.y + b.h / 2 };
      const radius = 8;
      const stepX = from.x + Math.max(24, (to.x - from.x) / 2);
      const yDir = to.y > from.y ? 1 : -1;
      const r = Math.min(radius, Math.abs(to.y - from.y) / 2 || radius);
      const d = [
        `M ${from.x} ${from.y}`,
        `H ${stepX - r}`,
        `Q ${stepX} ${from.y} ${stepX} ${from.y + r * yDir}`,
        `V ${to.y - r * yDir}`,
        `Q ${stepX} ${to.y} ${stepX + r} ${to.y}`,
        `H ${to.x}`,
      ].join(' ');
      const arrow = `M ${to.x} ${to.y} l -6 -3 l 0 6 z`;
      return {
        key: `${e.from}->${e.to}`,
        d,
        arrow,
        critical: graph.criticalEdgeKeys.has(`${e.from}->${e.to}`),
      };
    })
    .filter((g): g is EdgeGeometry => g !== null);

  // -------- Pan / zoom state --------
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState({ w: 0, h: VIEWPORT_HEIGHT });
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });

  // Clamp transform so the stage can't fly entirely out of view. Allow ~20%
  // of the stage to overhang each side so users can pan freely without
  // sticking against an invisible wall.
  const clampTransform = useCallback(
    (t: { x: number; y: number; k: number }) => {
      const vp = viewportRef.current?.getBoundingClientRect();
      if (!vp) return t;
      const scaledW = stageWidth * t.k;
      const scaledH = stageHeight * t.k;
      const slackX = scaledW * 0.2;
      const slackY = scaledH * 0.2;
      const minX = vp.width - scaledW - slackX;
      const maxX = slackX;
      const minY = vp.height - scaledH - slackY;
      const maxY = slackY;
      return {
        x: Math.min(maxX, Math.max(minX, t.x)),
        y: Math.min(maxY, Math.max(minY, t.y)),
        k: Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.k)),
      };
    },
    [stageWidth, stageHeight],
  );

  const fitToView = useCallback(() => {
    const vp = viewportRef.current?.getBoundingClientRect();
    if (!vp || vp.width === 0) return;
    const kX = vp.width / stageWidth;
    const kY = vp.height / stageHeight;
    const k = Math.min(kX, kY) * 0.95;
    const x = (vp.width - stageWidth * k) / 2;
    const y = (vp.height - stageHeight * k) / 2;
    setTransform({ x, y, k: Math.max(MIN_SCALE, Math.min(MAX_SCALE, k)) });
  }, [stageWidth, stageHeight]);

  // Initial fit + on-resize re-fit. Tracked via a flag so the user's manual
  // pan/zoom isn't blown away by a window resize unless they choose to fit again.
  const hasUserAdjusted = useRef(false);
  useLayoutEffect(() => {
    const update = () => {
      const vp = viewportRef.current?.getBoundingClientRect();
      if (!vp) return;
      setViewportSize({ w: vp.width, h: vp.height });
      if (!hasUserAdjusted.current) {
        const kX = vp.width / stageWidth;
        const kY = vp.height / stageHeight;
        const k = Math.min(kX, kY) * 0.95;
        const x = (vp.width - stageWidth * k) / 2;
        const y = (vp.height - stageHeight * k) / 2;
        setTransform({ x, y, k: Math.max(MIN_SCALE, Math.min(MAX_SCALE, k)) });
      }
    };
    update();
    const ro = new ResizeObserver(update);
    if (viewportRef.current) ro.observe(viewportRef.current);
    return () => ro.disconnect();
  }, [stageWidth, stageHeight]);

  // -------- Pan via mouse drag --------
  const dragState = useRef<{ active: boolean; startX: number; startY: number; baseX: number; baseY: number }>({
    active: false, startX: 0, startY: 0, baseX: 0, baseY: 0,
  });
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Skip the drag if the user clicked directly on a node link — they want
    // to click through to GitHub, not pan.
    const target = e.target as HTMLElement;
    if (target.closest('a[data-dep-node]')) return;
    dragState.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      baseX: transform.x,
      baseY: transform.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current.active) return;
    hasUserAdjusted.current = true;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    setTransform((t) => clampTransform({ x: dragState.current.baseX + dx, y: dragState.current.baseY + dy, k: t.k }));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragState.current.active = false;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* not captured */ }
  };

  // -------- Zoom via wheel (cursor-anchored) --------
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    hasUserAdjusted.current = true;
    const vp = viewportRef.current?.getBoundingClientRect();
    if (!vp) return;
    const cursorX = e.clientX - vp.left;
    const cursorY = e.clientY - vp.top;
    setTransform((t) => {
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newK = Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.k * factor));
      // Keep the point under the cursor stationary in world coords.
      const worldX = (cursorX - t.x) / t.k;
      const worldY = (cursorY - t.y) / t.k;
      const x = cursorX - worldX * newK;
      const y = cursorY - worldY * newK;
      return clampTransform({ x, y, k: newK });
    });
  };

  // -------- Button + keyboard controls --------
  const zoomBy = (factor: number) => {
    hasUserAdjusted.current = true;
    setTransform((t) => {
      const vp = viewportRef.current?.getBoundingClientRect();
      if (!vp) return t;
      const cx = vp.width / 2;
      const cy = vp.height / 2;
      const newK = Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.k * factor));
      const worldX = (cx - t.x) / t.k;
      const worldY = (cy - t.y) / t.k;
      const x = cx - worldX * newK;
      const y = cy - worldY * newK;
      return clampTransform({ x, y, k: newK });
    });
  };
  const resetView = () => {
    hasUserAdjusted.current = false;
    fitToView();
  };

  // Keyboard nav lives on the viewport so the user has to focus the canvas
  // first — won't hijack global arrow keys while reading the rest of the page.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowUp')    { e.preventDefault(); hasUserAdjusted.current = true; setTransform((t) => clampTransform({ ...t, y: t.y + PAN_KEY_STEP })); }
    if (e.key === 'ArrowDown')  { e.preventDefault(); hasUserAdjusted.current = true; setTransform((t) => clampTransform({ ...t, y: t.y - PAN_KEY_STEP })); }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); hasUserAdjusted.current = true; setTransform((t) => clampTransform({ ...t, x: t.x + PAN_KEY_STEP })); }
    if (e.key === 'ArrowRight') { e.preventDefault(); hasUserAdjusted.current = true; setTransform((t) => clampTransform({ ...t, x: t.x - PAN_KEY_STEP })); }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(ZOOM_KEY_FACTOR); }
    if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(1 / ZOOM_KEY_FACTOR); }
    if (e.key === '0') { e.preventDefault(); resetView(); }
  };

  // Block native wheel scroll on the viewport — we want wheel == zoom, not
  // scroll-the-page. Use a native listener with passive:false because React's
  // synthetic wheel handler can't preventDefault on a passive listener.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => e.preventDefault();
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  // -------- Minimap (bottom-right, click to center) --------
  const MM_W = 180;
  const MM_H = Math.max(80, Math.min(160, (stageHeight / stageWidth) * MM_W));
  const mmScaleX = MM_W / stageWidth;
  const mmScaleY = MM_H / stageHeight;
  // Viewport rectangle in minimap coords: invert the transform.
  const viewportInWorldX = -transform.x / transform.k;
  const viewportInWorldY = -transform.y / transform.k;
  const viewportInWorldW = viewportSize.w / transform.k;
  const viewportInWorldH = viewportSize.h / transform.k;
  const mmRectX = viewportInWorldX * mmScaleX;
  const mmRectY = viewportInWorldY * mmScaleY;
  const mmRectW = viewportInWorldW * mmScaleX;
  const mmRectH = viewportInWorldH * mmScaleY;

  const onMinimapClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    // Translate so the clicked minimap point becomes viewport center.
    const worldX = localX / mmScaleX;
    const worldY = localY / mmScaleY;
    hasUserAdjusted.current = true;
    setTransform((t) => clampTransform({
      x: viewportSize.w / 2 - worldX * t.k,
      y: viewportSize.h / 2 - worldY * t.k,
      k: t.k,
    }));
  };

  // -------- Render --------
  const shipped = graph.nodes.filter((n) => n.status === 'compliant').length;
  const inProgress = graph.nodes.filter((n) => n.status === 'partial').length;
  const notStarted = graph.nodes.filter((n) => n.status === 'non-compliant').length;

  // Empty-state: dependency graph not configured for this initiative (Tier 0)
  // or the derived artifact has no nodes yet. Render a neutral notice instead
  // of an empty canvas.
  if (graph.nodes.length === 0) {
    return (
      <section className="rounded-lg border border-contrast-200 bg-background px-4 py-6 text-sm text-contrast-400">
        The dependency graph is not configured for this initiative. Wire a dep-graph source in
        {' '}<code className="rounded bg-contrast-100/60 px-1 font-mono text-[11px]">blueprint.yml</code>
        {' '}to render the epic-level DAG.
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Epics" value={graph.nodes.length} hint={`${graph.edges.length} dependencies`} />
        <Stat label="Shipped" value={shipped} hint="≥60% gates green" tone="success" />
        <Stat label="In progress" value={inProgress} hint="20–59% green" tone="warning" />
        <Stat label="Not started" value={notStarted} hint="<20% green" tone="error" />
      </div>

      <div className="rounded-lg border border-contrast-200 bg-background">
        {/* Critical-path summary */}
        <div className="border-b border-contrast-200 bg-contrast-100/30 px-4 py-2.5 text-sm">
          {graph.criticalPath.length >= 2 ? (
            <>
              <span className="mr-2 font-mono text-[11px] uppercase tracking-wide text-info-foreground">
                Critical path ({graph.criticalPath.length})
              </span>
              <span className="text-foreground">
                {graph.criticalPath.map((n, i) => (
                  <span key={n.id}>
                    {i > 0 && <span className="mx-1 text-contrast-400">→</span>}
                    <span>{n.label}</span>
                  </span>
                ))}
              </span>
            </>
          ) : (
            <span className="text-contrast-500">
              No critical path — every chain has at least one shipped node.
            </span>
          )}
        </div>

        {/* Controls bar */}
        <div className="flex items-center gap-2 border-b border-contrast-200 bg-background px-3 py-2 text-xs">
          <button
            type="button"
            onClick={() => zoomBy(ZOOM_KEY_FACTOR)}
            className="rounded border border-contrast-200 px-2 py-1 hover:bg-contrast-100 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
            aria-label="Zoom in"
          >
            <span aria-hidden>＋</span>
          </button>
          <button
            type="button"
            onClick={() => zoomBy(1 / ZOOM_KEY_FACTOR)}
            className="rounded border border-contrast-200 px-2 py-1 hover:bg-contrast-100 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
            aria-label="Zoom out"
          >
            <span aria-hidden>−</span>
          </button>
          <button
            type="button"
            onClick={resetView}
            className="rounded border border-contrast-200 px-2 py-1 hover:bg-contrast-100 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
          >
            Fit
          </button>
          <span className="ml-2 font-mono text-[11px] text-contrast-400">
            {Math.round(transform.k * 100)}%
          </span>
          <span className="ml-auto font-mono text-[10px] text-contrast-400">
            drag to pan · wheel / +/− to zoom · 0 to fit · arrows to nudge
          </span>
        </div>

        {/* Viewport: pan/zoom canvas */}
        <div
          ref={viewportRef}
          tabIndex={0}
          role="region"
          aria-label="Dependency graph canvas, pan and zoom enabled"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
          onKeyDown={onKeyDown}
          className="relative overflow-hidden bg-contrast-100/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          style={{
            height: VIEWPORT_HEIGHT,
            cursor: dragState.current.active ? 'grabbing' : 'grab',
            touchAction: 'none',
            userSelect: 'none',
          }}
        >
          {/* Stage: holds nodes + edges at natural size; gets transformed */}
          <div
            className="absolute left-0 top-0"
            style={{
              width: stageWidth,
              height: stageHeight,
              transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})`,
              transformOrigin: '0 0',
            }}
          >
            {/* Edges SVG — same coordinate space as the nodes */}
            <svg
              aria-hidden
              className="pointer-events-none absolute inset-0"
              width={stageWidth}
              height={stageHeight}
              viewBox={`0 0 ${stageWidth} ${stageHeight}`}
            >
              {edgeGeometry.map((g) => (
                <g key={g.key} className={g.critical ? 'text-info-foreground' : 'text-contrast-400'}>
                  <path
                    d={g.d}
                    stroke="currentColor"
                    strokeWidth={g.critical ? 2.5 : 1.5}
                    strokeLinecap="round"
                    fill="none"
                    opacity={g.critical ? 0.95 : 0.6}
                  />
                  <path d={g.arrow} fill="currentColor" opacity={g.critical ? 0.95 : 0.6} />
                </g>
              ))}
            </svg>

            {/* Nodes — absolutely positioned in the stage's coordinate system */}
            {columns.map(([level, items], colIdx) => {
              const colX = STAGE_PADDING + colIdx * (COLUMN_WIDTH + COLUMN_GAP);
              return (
                <div key={level}>
                  <p
                    className="absolute font-mono text-[10px] uppercase tracking-wider text-contrast-400"
                    style={{ left: colX + 4, top: STAGE_PADDING }}
                  >
                    {level < 0 ? 'cycle' : `level ${level}`}
                  </p>
                  {items.map((node, rowIdx) => {
                    const pos = nodePositions.get(node.id)!;
                    return (
                      <NodeCard
                        key={node.id}
                        node={node}
                        onCritical={graph.criticalIds.has(node.id)}
                        style={{ left: pos.x, top: pos.y, width: pos.w, height: pos.h }}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/* Minimap overlay */}
          {viewportSize.w > 360 && (
            <div
              className="absolute bottom-3 right-3 rounded-md border border-contrast-200 bg-background/95 p-1.5 shadow-sm backdrop-blur-sm"
              style={{ width: MM_W + 12 }}
            >
              <p className="mb-1 px-1 font-mono text-[9px] uppercase tracking-wider text-contrast-400">
                minimap
              </p>
              <svg
                viewBox={`0 0 ${stageWidth} ${stageHeight}`}
                width={MM_W}
                height={MM_H}
                className="block cursor-pointer rounded bg-contrast-100/40"
                onClick={onMinimapClick}
                role="img"
                aria-label="Graph minimap — click to navigate"
              >
                {/* Critical-path edges in info color, others muted */}
                {edgeGeometry.map((g) => (
                  <path
                    key={g.key}
                    d={g.d}
                    stroke="currentColor"
                    className={g.critical ? 'text-info-foreground' : 'text-contrast-300'}
                    strokeWidth={g.critical ? 6 : 3}
                    fill="none"
                    opacity={g.critical ? 0.6 : 0.4}
                  />
                ))}
                {graph.nodes.map((n) => {
                  const pos = nodePositions.get(n.id);
                  if (!pos) return null;
                  return (
                    <rect
                      key={n.id}
                      x={pos.x}
                      y={pos.y}
                      width={pos.w}
                      height={pos.h}
                      className={MINIMAP_DOT_FILL[n.status]}
                      opacity={graph.criticalIds.has(n.id) ? 1 : 0.7}
                      rx={4}
                    />
                  );
                })}
                {/* Viewport-bounds rectangle */}
                <rect
                  x={mmRectX / mmScaleX}
                  y={mmRectY / mmScaleY}
                  width={mmRectW / mmScaleX}
                  height={mmRectH / mmScaleY}
                  fill="none"
                  stroke="currentColor"
                  className="text-foreground"
                  strokeWidth={Math.max(8, 12 / transform.k)}
                  opacity={0.55}
                  pointerEvents="none"
                />
              </svg>
            </div>
          )}
        </div>
      </div>

      <p className="font-mono text-[10px] text-contrast-400">
        Generated {generatedAt} · {graph.nodes.length} nodes · {graph.edges.length} dependencies ·
        {' '}node color = percent of gates green per epic · critical path = longest non-shipped chain.
      </p>
    </section>
  );
}

function NodeCard({
  node,
  onCritical,
  style,
}: {
  node: LayoutNode;
  onCritical: boolean;
  style: React.CSSProperties;
}) {
  const base = `absolute flex items-center gap-2 pl-3 pr-3 rounded-md border text-xs font-medium overflow-hidden no-underline ${NODE_STATUS_CLASS[node.status]} ${
    onCritical ? 'ring-2 ring-info-foreground ring-offset-2 ring-offset-background' : ''
  }`;
  const inner = (
    <>
      <span className={`absolute inset-y-0 left-0 w-[3px] ${STATUS_STRIPE_CLASS[node.status]}`} />
      <span className="flex-1 truncate" title={node.label}>{node.label}</span>
      {node.meta && (
        <span className="shrink-0 font-mono text-[10px] opacity-70">{node.meta}</span>
      )}
    </>
  );
  if (node.url) {
    return (
      <a
        data-dep-node
        href={node.url}
        target="_blank"
        rel="noopener noreferrer"
        className={base}
        style={style}
      >
        {inner}
      </a>
    );
  }
  return (
    <div data-dep-node className={base} style={style}>
      {inner}
    </div>
  );
}

const STAT_TONE: Record<string, string> = {
  default: 'border-contrast-200 bg-background',
  success: 'border-success/30 bg-success-background/40 text-success-foreground',
  warning: 'border-warning/30 bg-warning-background/40 text-warning-foreground',
  error:   'border-error/30   bg-error-background/40   text-error-foreground',
};

function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: keyof typeof STAT_TONE;
}) {
  return (
    <div className={`rounded-lg border p-3 ${STAT_TONE[tone]}`}>
      <p className="font-mono text-[10px] uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-1 font-heading text-2xl font-semibold leading-none">{value}</p>
      {hint && <p className="mt-1 text-xs opacity-80">{hint}</p>}
    </div>
  );
}
