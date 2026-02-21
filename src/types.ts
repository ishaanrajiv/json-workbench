export type Mode = "json" | "minify" | "table" | "explore" | "diff";
export type UpdateSource = "input" | "paste" | "programmatic";
export type PathSegment = string | number;

export type ParseErrorInfo = {
  message: string;
  position: number;
  line: number;
  column: number;
  suggestion: string;
  lineText: string;
  caretLine: string;
};

export type ParseResult = {
  empty: boolean;
  ok: boolean;
  value: any;
  error: ParseErrorInfo | null;
};

export type DiffOp =
  | { type: "equal"; left: string; right: string }
  | { type: "del"; left: string }
  | { type: "add"; right: string };

export type UnifiedDiffRow = {
  kind: "context" | "add" | "del";
  leftNo: number | null;
  rightNo: number | null;
  text: string;
};

export type GapDiffRow = {
  kind: "gap";
  omitted: number;
};

export type VisibleDiffRow = UnifiedDiffRow | GapDiffRow;

export type FoldMarker = {
  path: PathSegment[];
  pathKey: string;
  line: number;
  depth: number;
  collapsed: boolean;
  hasChildren: boolean;
};

export type TextLayoutMetrics = {
  lineHeight: number;
  lineTops: number[];
  lineHeights: number[];
  totalHeight: number;
};

export type PaneResizeState = {
  pointerId: number;
  startX: number;
  startLeftWidth: number;
  availableWidth: number;
};

export type HudAnchor = "left" | "right" | "center";

export type CommandItem = {
  id: string;
  label: string;
  hint: string;
  keywords: string;
  run: () => void | Promise<void>;
  isAvailable?: () => boolean;
};

export type ExploreHit = {
  path: PathSegment[];
  preview: string;
};
