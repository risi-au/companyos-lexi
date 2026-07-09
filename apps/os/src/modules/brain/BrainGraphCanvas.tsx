"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { BrainGraphResult } from "@companyos/api";
import { filterBrainGraph } from "./graph-utils";

type Node = BrainGraphResult["nodes"][number];
type Edge = BrainGraphResult["edges"][number];
type SimNode = Node & { x: number; y: number; vx: number; vy: number };

const NODE_TYPES = ["scope", "wiki-page", "root-pattern", "workbench", "unresolved"] as const;

function nodeRadius(node: Node): number {
  if (node.type === "scope") return 7;
  if (node.type === "root-pattern") return 6;
  if (node.type === "workbench") return 5;
  return 4;
}

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function colorFor(node: Node): string {
  if (node.flagged) return cssVar("--destructive", "red");
  if (node.type === "scope") return cssVar("--primary", "blue");
  if (node.type === "root-pattern") return cssVar("--accent", "orange");
  if (node.type === "workbench") return cssVar("--status-ok", "green");
  if (node.type === "unresolved") return cssVar("--muted-foreground", "gray");
  return cssVar("--chart-2", cssVar("--foreground", "black"));
}

function edgeColor(edge: Edge): string {
  if (edge.type === "scope-hierarchy") return cssVar("--border", "gray");
  if (edge.type === "workbench") return cssVar("--status-ok", "green");
  if (!edge.resolved) return cssVar("--destructive", "red");
  return cssVar("--muted-foreground", "gray");
}

export function BrainGraphCanvas({ graph }: { graph: BrainGraphResult }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const [query, setQuery] = useState("");
  const [scopePrefix, setScopePrefix] = useState("root");
  const [types, setTypes] = useState<string[]>([]);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [hovered, setHovered] = useState<Node | null>(null);

  const scopeOptions = useMemo(() => {
    const scopes = new Set(["root"]);
    for (const node of graph.nodes) {
      if (node.scopePath && node.scopePath !== "root") scopes.add(node.scopePath);
    }
    return Array.from(scopes).sort((a, b) => a.localeCompare(b));
  }, [graph.nodes]);

  const filtered = useMemo(() => filterBrainGraph(graph.nodes, graph.edges, {
    query,
    scopePrefix,
    types,
    flaggedOnly,
  }), [flaggedOnly, graph.edges, graph.nodes, query, scopePrefix, types]);

  useEffect(() => {
    const width = canvasRef.current?.clientWidth || 900;
    const height = canvasRef.current?.clientHeight || 600;
    const previous = new Map(nodesRef.current.map((node) => [node.id, node]));
    nodesRef.current = filtered.nodes.map((node, index) => {
      const existing = previous.get(node.id);
      if (existing) return { ...node, x: existing.x, y: existing.y, vx: existing.vx, vy: existing.vy };
      const angle = (index / Math.max(1, filtered.nodes.length)) * Math.PI * 2;
      const radius = Math.min(width, height) * 0.28;
      return {
        ...node,
        x: width / 2 + Math.cos(angle) * radius,
        y: height / 2 + Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
      };
    });
  }, [filtered.nodes]);

  useEffect(() => {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;
    const canvas: HTMLCanvasElement = canvasEl;
    let frame = 0;
    let disposed = false;

    function draw() {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.floor(rect.width * dpr) || canvas.height !== Math.floor(rect.height * dpr)) {
        canvas.width = Math.floor(rect.width * dpr);
        canvas.height = Math.floor(rect.height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);

      const nodes = nodesRef.current;
      const byId = new Map(nodes.map((node) => [node.id, node]));
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      for (const node of nodes) {
        node.vx += (centerX - node.x) * 0.0009;
        node.vy += (centerY - node.y) * 0.0009;
      }

      for (const edge of filtered.edges) {
        const source = byId.get(edge.source);
        const target = byId.get(edge.target);
        if (!source || !target) continue;
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const desired = edge.type === "scope-hierarchy" ? 95 : 125;
        const force = (dist - desired) * 0.0008;
        const fx = dx * force;
        const fy = dy * force;
        source.vx += fx;
        source.vy += fy;
        target.vx -= fx;
        target.vy -= fy;
      }

      for (const node of nodes) {
        node.vx *= 0.86;
        node.vy *= 0.86;
        node.x = Math.min(rect.width - 14, Math.max(14, node.x + node.vx));
        node.y = Math.min(rect.height - 14, Math.max(14, node.y + node.vy));
      }

      if (filtered.focusNodeId) {
        const focused = byId.get(filtered.focusNodeId);
        if (focused) {
          focused.x += (centerX - focused.x) * 0.08;
          focused.y += (centerY - focused.y) * 0.08;
        }
      }

      ctx.lineWidth = 1;
      for (const edge of filtered.edges) {
        const source = byId.get(edge.source);
        const target = byId.get(edge.target);
        if (!source || !target) continue;
        ctx.strokeStyle = edgeColor(edge);
        ctx.globalAlpha = edge.type === "scope-hierarchy" ? 0.34 : 0.22;
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      for (const node of nodes) {
        ctx.fillStyle = colorFor(node);
        ctx.beginPath();
        ctx.arc(node.x, node.y, nodeRadius(node), 0, Math.PI * 2);
        ctx.fill();
        if (filtered.focusNodeId === node.id || hovered?.id === node.id) {
          ctx.strokeStyle = cssVar("--foreground", "black");
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      if (!disposed) frame = window.requestAnimationFrame(draw);
    }

    frame = window.requestAnimationFrame(draw);
    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
    };
  }, [filtered.edges, filtered.focusNodeId, hovered?.id]);

  function nodeAt(clientX: number, clientY: number): SimNode | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    for (const node of nodesRef.current) {
      const radius = nodeRadius(node) + 5;
      if ((node.x - x) ** 2 + (node.y - y) ** 2 <= radius ** 2) return node;
    }
    return null;
  }

  function toggleType(type: string) {
    setTypes((current) => current.includes(type) ? current.filter((item) => item !== type) : [...current, type]);
  }

  return (
    <div className="space-y-[var(--space-3)]">
      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="min-w-64 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)]"
          placeholder="Search graph"
        />
        <select
          value={scopePrefix}
          onChange={(event) => setScopePrefix(event.target.value)}
          className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-2)] py-[var(--space-2)] text-[var(--font-size-sm)]"
          aria-label="Filter by project subtree"
        >
          {scopeOptions.map((scope) => (
            <option key={scope} value={scope}>{scope}</option>
          ))}
        </select>
        <label className="inline-flex items-center gap-[var(--space-1)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
          <input type="checkbox" checked={flaggedOnly} onChange={(event) => setFlaggedOnly(event.target.checked)} />
          Flagged only
        </label>
      </div>

      <div className="flex flex-wrap gap-[var(--space-2)] text-[var(--font-size-xs)]">
        {NODE_TYPES.map((type) => (
          <label key={type} className="inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-2)] py-[var(--space-1)]">
            <input type="checkbox" checked={types.includes(type)} onChange={() => toggleType(type)} />
            {type}
          </label>
        ))}
      </div>

      <div className="relative h-[620px] overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
        <canvas
          ref={canvasRef}
          className="h-full w-full cursor-pointer"
          aria-label="Brain knowledge graph"
          onMouseMove={(event) => setHovered(nodeAt(event.clientX, event.clientY))}
          onMouseLeave={() => setHovered(null)}
          onClick={(event) => {
            const node = nodeAt(event.clientX, event.clientY);
            if (node) window.location.href = node.href;
          }}
        />
        <div className="pointer-events-none absolute left-[var(--space-3)] top-[var(--space-3)] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)]/95 px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
          {filtered.nodes.length} nodes / {filtered.edges.length} edges
          {graph.meta.truncated ? " (limited)" : ""}
        </div>
        {hovered && (
          <div className="pointer-events-none absolute bottom-[var(--space-3)] left-[var(--space-3)] max-w-md rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-xs)]">
            <div className="font-medium text-[var(--foreground)]">{hovered.title}</div>
            <div className="font-mono text-[var(--muted-foreground)]">{hovered.scopePath}{hovered.slug ? ` / ${hovered.slug}` : ""}</div>
          </div>
        )}
      </div>
    </div>
  );
}
