import React, { useEffect, useRef, useState, useCallback } from 'react';
import { type TaskDAG, type TaskDependencyType } from '../../api/client';

interface DAGVisualizationProps {
  dag: TaskDAG | null;
  onNodeClick?: (taskId: string) => void;
  onAddDependency?: (fromTaskId: string, toTaskId: string) => void;
  onRemoveDependency?: (taskId: string, dependsOnTaskId: string) => void;
  selectedTaskId?: string | null;
  width?: number;
  height?: number;
}

const STATUS_COLORS: Record<string, string> = {
  incoming: '#94a3b8',
  triage: '#22d3ee',
  assigned: '#60a5fa',
  in_progress: '#fbbf24',
  review: '#e879f9',
  done: '#34d399',
  blocked: '#fb7185',
};

const DEPENDENCY_LABELS: Record<TaskDependencyType, string> = {
  finish_to_start: 'FS',
  start_to_start: 'SS',
  finish_to_finish: 'FF',
  start_to_finish: 'SF',
};

interface NodePosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function DAGVisualization({
  dag,
  onNodeClick,
  onAddDependency,
  onRemoveDependency,
  selectedTaskId,
  width = 800,
  height = 600,
}: DAGVisualizationProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [nodePositions, setNodePositions] = useState<Map<string, NodePosition>>(new Map());
  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Calculate initial node positions using topological layering
  useEffect(() => {
    if (!dag || !dag.nodes.length) return;

    const positions = new Map<string, NodePosition>();
    const nodeWidth = 160;
    const nodeHeight = 60;
    const layerGap = 200;
    const nodeGap = 80;

    // Group nodes by layer (using simple topological sort)
    const layers: string[][] = [];
    const visited = new Set<string>();
    const inDegree = new Map<string, number>();

    // Calculate in-degrees
    for (const node of dag.nodes) {
      inDegree.set(node.id, node.dependencies.length);
    }

    // Find nodes with no dependencies (first layer)
    let currentLayer = dag.nodes
      .filter(n => n.dependencies.length === 0)
      .map(n => n.id);

    while (currentLayer.length > 0) {
      layers.push(currentLayer);
      
      const nextLayer: string[] = [];
      for (const nodeId of currentLayer) {
        visited.add(nodeId);
        
        // Find nodes that depend on this one
        const dependents = dag.nodes.filter(n =>
          n.dependencies.some(d => d.dependsOnTaskId === nodeId)
        );
        
        for (const dep of dependents) {
          const newDegree = (inDegree.get(dep.id) || 0) - 1;
          inDegree.set(dep.id, newDegree);
          if (newDegree === 0 && !visited.has(dep.id)) {
            nextLayer.push(dep.id);
          }
        }
      }
      currentLayer = nextLayer;
    }

    // Position nodes in layers
    layers.forEach((layer, layerIndex) => {
      const layerWidth = layer.length * (nodeWidth + nodeGap) - nodeGap;
      const startX = (width - layerWidth) / 2;
      
      layer.forEach((nodeId, nodeIndex) => {
        const node = dag.nodes.find(n => n.id === nodeId);
        if (!node) return;

        positions.set(nodeId, {
          x: startX + nodeIndex * (nodeWidth + nodeGap),
          y: 50 + layerIndex * (nodeHeight + layerGap),
          width: nodeWidth,
          height: nodeHeight,
        });
      });
    });

    setNodePositions(positions);
  }, [dag, width, height]);

  const handleMouseDown = useCallback((e: React.MouseEvent, taskId: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const pos = nodePositions.get(taskId);
    if (!pos) return;

    setDraggingNode(taskId);
    setDragOffset({
      x: e.clientX - rect.left - pos.x,
      y: e.clientY - rect.top - pos.y,
    });
  }, [nodePositions]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setMousePos({ x, y });

    if (draggingNode) {
      setNodePositions(prev => {
        const next = new Map(prev);
        const pos = next.get(draggingNode);
        if (pos) {
          next.set(draggingNode, {
            ...pos,
            x: x - dragOffset.x,
            y: y - dragOffset.y,
          });
        }
        return next;
      });
    }
  }, [draggingNode, dragOffset]);

  const handleMouseUp = useCallback(() => {
    setDraggingNode(null);
  }, []);

  const handleNodeClick = useCallback((taskId: string) => {
    if (connectingFrom) {
      if (connectingFrom !== taskId && onAddDependency) {
        onAddDependency(connectingFrom, taskId);
      }
      setConnectingFrom(null);
    } else {
      onNodeClick?.(taskId);
    }
  }, [connectingFrom, onAddDependency, onNodeClick]);

  const handleStartConnection = useCallback((e: React.MouseEvent, taskId: string) => {
    e.stopPropagation();
    setConnectingFrom(taskId);
  }, []);

  if (!dag || dag.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <p>No tasks to display</p>
      </div>
    );
  }

  return (
    <div className="relative overflow-auto bg-slate-900 rounded-lg border border-slate-700">
      <svg
        ref={svgRef}
        width={width}
        height={height}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className="cursor-grab active:cursor-grabbing"
      >
        {/* Grid background */}
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e293b" strokeWidth="1"/>
          </pattern>
          <marker
            id="arrowhead"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="#64748b"/>
          </marker>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)"/>

        {/* Edges */}
        {dag.edges.map((edge, index) => {
          const fromPos = nodePositions.get(edge.from);
          const toPos = nodePositions.get(edge.to);
          if (!fromPos || !toPos) return null;

          const startX = fromPos.x + fromPos.width / 2;
          const startY = fromPos.y + fromPos.height;
          const endX = toPos.x + toPos.width / 2;
          const endY = toPos.y;

          // Curved path
          const midY = (startY + endY) / 2;
          const path = `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`;

          return (
            <g key={`${edge.from}-${edge.to}-${index}`}>
              <path
                d={path}
                fill="none"
                stroke="#64748b"
                strokeWidth="2"
                markerEnd="url(#arrowhead)"
              />
              {/* Dependency type label */}
              <rect
                x={(startX + endX) / 2 - 12}
                y={midY - 10}
                width="24"
                height="20"
                fill="#1e293b"
                stroke="#475569"
                rx="4"
              />
              <text
                x={(startX + endX) / 2}
                y={midY + 4}
                textAnchor="middle"
                fill="#94a3b8"
                fontSize="10"
              >
                {DEPENDENCY_LABELS[edge.type]}
              </text>
            </g>
          );
        })}

        {/* Connection line when dragging */}
        {connectingFrom && (() => {
          const fromPos = nodePositions.get(connectingFrom);
          if (!fromPos) return null;
          return (
            <line
              x1={fromPos.x + fromPos.width / 2}
              y1={fromPos.y + fromPos.height / 2}
              x2={mousePos.x}
              y2={mousePos.y}
              stroke="#3b82f6"
              strokeWidth="2"
              strokeDasharray="5,5"
            />
          );
        })()}

        {/* Nodes */}
        {dag.nodes.map(node => {
          const pos = nodePositions.get(node.id);
          if (!pos) return null;

          const isSelected = selectedTaskId === node.id;
          const isConnecting = connectingFrom === node.id;
          const color = STATUS_COLORS[node.status] || '#94a3b8';

          return (
            <g
              key={node.id}
              transform={`translate(${pos.x}, ${pos.y})`}
              onMouseDown={(e) => handleMouseDown(e, node.id)}
              onClick={() => handleNodeClick(node.id)}
              className="cursor-pointer"
            >
              {/* Node body */}
              <rect
                width={pos.width}
                height={pos.height}
                rx="8"
                fill="#0f172a"
                stroke={isSelected ? '#3b82f6' : isConnecting ? '#22c55e' : color}
                strokeWidth={isSelected || isConnecting ? '3' : '2'}
                className="transition-all duration-200 hover:brightness-110"
              />
              
              {/* Status indicator */}
              <rect
                width="6"
                height={pos.height - 8}
                x="4"
                y="4"
                rx="3"
                fill={color}
              />

              {/* Title */}
              <text
                x="18"
                y="24"
                fill="#e2e8f0"
                fontSize="12"
                fontWeight="500"
                className="select-none"
              >
                {node.title.slice(0, 18)}{node.title.length > 18 ? '...' : ''}
              </text>

              {/* Status label */}
              <text
                x="18"
                y="44"
                fill="#64748b"
                fontSize="10"
                className="select-none"
              >
                {node.status}
              </text>

              {/* Connection handle */}
              <circle
                cx={pos.width / 2}
                cy={pos.height}
                r="6"
                fill="#3b82f6"
                className="cursor-crosshair"
                onMouseDown={(e) => handleStartConnection(e, node.id)}
              />
              
              {/* Input handle */}
              <circle
                cx={pos.width / 2}
                cy="0"
                r="6"
                fill="#64748b"
              />
            </g>
          );
        })}
      </svg>

      {/* Controls */}
      <div className="absolute top-4 right-4 flex gap-2">
        {connectingFrom && (
          <div className="bg-blue-500 text-white px-3 py-1 rounded-md text-sm">
            Click target task to connect
            <button
              onClick={() => setConnectingFrom(null)}
              className="ml-2 text-blue-200 hover:text-white"
            >
              Cancel
            </button>
          </div>
        )}
        <div className="bg-slate-800 text-slate-300 px-3 py-1 rounded-md text-xs">
          Drag to move • Drag blue handle to connect
        </div>
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-slate-800 rounded-lg p-3 border border-slate-700">
        <div className="text-xs text-slate-400 mb-2">Status</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {Object.entries(STATUS_COLORS).map(([status, color]) => (
            <div key={status} className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="text-xs text-slate-300 capitalize">{status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
