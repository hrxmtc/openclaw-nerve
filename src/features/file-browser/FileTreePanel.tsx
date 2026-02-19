/**
 * FileTreePanel — Collapsible file tree sidebar on the far left.
 *
 * Shows workspace files in a tree structure. Directories lazy-load on expand.
 * Double-click a file to open it as an editor tab.
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { PanelLeftClose, PanelLeftOpen, RefreshCw } from 'lucide-react';
import { FileTreeNode } from './FileTreeNode';
import { useFileTree } from './hooks/useFileTree';

const MIN_WIDTH = 160;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 220;
const COLLAPSED_WIDTH = 0;

const WIDTH_STORAGE_KEY = 'nerve-file-tree-width';
const COLLAPSED_STORAGE_KEY = 'nerve-file-tree-collapsed';

function loadWidth(): number {
  try {
    const v = localStorage.getItem(WIDTH_STORAGE_KEY);
    return v ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Number(v))) : DEFAULT_WIDTH;
  } catch { return DEFAULT_WIDTH; }
}

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true';
  } catch { return false; }
}

interface FileTreePanelProps {
  onOpenFile: (path: string) => void;
  /** Called externally when a file changes (SSE) — refreshes affected directory */
  lastChangedPath?: string | null;
}

export function FileTreePanel({ onOpenFile, lastChangedPath }: FileTreePanelProps) {
  const {
    entries, loading, error, expandedPaths, selectedPath,
    loadingPaths, toggleDirectory, selectFile, refresh, handleFileChange,
  } = useFileTree();

  // React to external file changes
  const prevChangedPath = useRef<string | null>(null);
  useEffect(() => {
    if (lastChangedPath && lastChangedPath !== prevChangedPath.current) {
      prevChangedPath.current = lastChangedPath;
      handleFileChange(lastChangedPath);
    }
  }, [lastChangedPath, handleFileChange]);

  const panelRef = useRef<HTMLDivElement>(null);
  const widthRef = useRef(loadWidth());
  const collapsedRef = useRef(loadCollapsed());
  const draggingRef = useRef(false);

  // State-driven rendering (refs hold source of truth, state triggers re-render)
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [width, setWidth] = useState(() => {
    const c = loadCollapsed();
    return c ? COLLAPSED_WIDTH : loadWidth();
  });

  const toggleCollapsed = useCallback(() => {
    collapsedRef.current = !collapsedRef.current;
    setCollapsed(collapsedRef.current);
    setWidth(collapsedRef.current ? COLLAPSED_WIDTH : widthRef.current);
    try { localStorage.setItem(COLLAPSED_STORAGE_KEY, String(collapsedRef.current)); } catch { /* ignore */ }
  }, []);

  // Resize drag handling
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    const startX = e.clientX;
    const startWidth = widthRef.current;

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + delta));
      widthRef.current = newWidth;
      if (panelRef.current) {
        panelRef.current.style.width = `${newWidth}px`;
      }
    };

    const onMouseUp = () => {
      draggingRef.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try { localStorage.setItem(WIDTH_STORAGE_KEY, String(widthRef.current)); } catch { /* ignore */ }
      setWidth(widthRef.current);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  const handleDoubleClickResize = useCallback(() => {
    widthRef.current = DEFAULT_WIDTH;
    if (panelRef.current) panelRef.current.style.width = `${DEFAULT_WIDTH}px`;
    try { localStorage.setItem(WIDTH_STORAGE_KEY, String(DEFAULT_WIDTH)); } catch { /* ignore */ }
    setWidth(DEFAULT_WIDTH);
  }, []);

  if (collapsed) {
    return (
      <div className="shrink-0 border-r border-border bg-background flex flex-col items-center pt-2 w-9">
        <button
          onClick={toggleCollapsed}
          className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
          title="Open file explorer (Ctrl+B)"
          aria-label="Open file explorer"
        >
          <PanelLeftOpen size={16} />
        </button>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      className="shrink-0 border-r border-border bg-background flex flex-col min-h-0 relative"
      style={{ width }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
          Workspace
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={refresh}
            className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
            title="Refresh file tree"
            aria-label="Refresh file tree"
          >
            <RefreshCw size={12} />
          </button>
          <button
            onClick={toggleCollapsed}
            className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
            title="Close file explorer (Ctrl+B)"
            aria-label="Close file explorer"
          >
            <PanelLeftClose size={12} />
          </button>
        </div>
      </div>

      {/* Tree content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1" role="tree" aria-label="File explorer">
        {loading ? (
          <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
            <RefreshCw className="animate-spin" size={12} />
            Loading...
          </div>
        ) : error ? (
          <div className="px-3 py-4 text-xs text-destructive">
            {error}
            <button
              onClick={refresh}
              className="block mt-2 text-primary hover:underline"
            >
              Retry
            </button>
          </div>
        ) : entries.length === 0 ? (
          <div className="px-3 py-4 text-xs text-muted-foreground">
            Empty workspace
          </div>
        ) : (
          entries.map((entry) => (
            <FileTreeNode
              key={entry.path}
              entry={entry}
              depth={0}
              expandedPaths={expandedPaths}
              selectedPath={selectedPath}
              loadingPaths={loadingPaths}
              onToggleDir={toggleDirectory}
              onOpenFile={onOpenFile}
              onSelect={selectFile}
            />
          ))
        )}
      </div>

      {/* Resize handle */}
      <div
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/50 active:bg-primary/50 transition-colors z-10"
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClickResize}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize file explorer"
      />
    </div>
  );
}

