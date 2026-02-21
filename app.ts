type Mode = "json" | "minify" | "table" | "explore" | "diff";
type UpdateSource = "input" | "paste" | "programmatic";
type PathSegment = string | number;

type ParseErrorInfo = {
  message: string;
  position: number;
  line: number;
  column: number;
  suggestion: string;
  lineText: string;
  caretLine: string;
};

type ParseResult = {
  empty: boolean;
  ok: boolean;
  value: any;
  error: ParseErrorInfo | null;
};

type DiffOp =
  | { type: "equal"; left: string; right: string }
  | { type: "del"; left: string }
  | { type: "add"; right: string };

type UnifiedDiffRow = {
  kind: "context" | "add" | "del";
  leftNo: number | null;
  rightNo: number | null;
  text: string;
};

type GapDiffRow = {
  kind: "gap";
  omitted: number;
};

type VisibleDiffRow = UnifiedDiffRow | GapDiffRow;

type FoldMarker = {
  path: PathSegment[];
  pathKey: string;
  line: number;
  depth: number;
  collapsed: boolean;
  hasChildren: boolean;
};

type TextLayoutMetrics = {
  lineHeight: number;
  lineTops: number[];
  lineHeights: number[];
  totalHeight: number;
};

type PaneResizeState = {
  pointerId: number;
  startX: number;
  startLeftWidth: number;
  availableWidth: number;
};

type HudAnchor = "left" | "right" | "center";

type CommandItem = {
  id: string;
  label: string;
  hint: string;
  keywords: string;
  run: () => void | Promise<void>;
  isAvailable?: () => boolean;
};

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element: #${id}`);
  }
  return element as T;
}

function emptyParse(): ParseResult {
  return { empty: true, ok: false, value: null, error: null };
}

const state = {
  mode: "json" as Mode,
  leftText: "",
  rightText: "",
  rightLocked: true,
  rightDirty: false,
  paneSplitRatio: null as number | null,
  leftLayout: null as TextLayoutMetrics | null,
  rightLayout: null as TextLayoutMetrics | null,
  leftParse: emptyParse(),
  rightParse: emptyParse(),
  lastHighlighted: {
    left: null as number | null,
    right: null as number | null,
  },
  errorLineFocus: {
    left: null as number | null,
    right: null as number | null,
  },
  jsonFoldCollapsed: new Set<string>(),
  jsonFoldMarkers: [] as FoldMarker[],
  explorePath: [] as PathSegment[],
  currentPath: [] as PathSegment[],
  exploreQuery: "",
  exploreHits: [] as Array<{ path: PathSegment[]; preview: string }>,
  diffRows: [] as UnifiedDiffRow[],
  diffDirtySinceRecompute: false,
  hudAnchor: "left" as HudAnchor,
  hudLabel: "Source",
  commandPaletteOpen: false,
  commandQuery: "",
  commandSelectedIndex: 0,
};

let charMeasureCanvas: HTMLCanvasElement | null = null;
const monoCharWidthCache = new Map<string, number>();
const PANE_RESIZER_WIDTH = 12;
const MIN_PANE_WIDTH_PX = 280;
let activePaneResize: PaneResizeState | null = null;

const elements = {
  workspaceGrid: byId<HTMLElement>("workspace-grid"),
  leftPane: byId<HTMLElement>("left-pane"),
  rightPane: byId<HTMLElement>("right-pane"),
  paneResizer: byId<HTMLElement>("pane-resizer"),

  commandPaletteBtn: byId<HTMLButtonElement>("command-palette-btn"),
  loadSampleBtn: byId<HTMLButtonElement>("load-sample-btn"),
  resyncBtn: byId<HTMLButtonElement>("resync-btn"),

  leftInput: byId<HTMLTextAreaElement>("left-input"),
  leftLines: byId<HTMLElement>("left-lines"),
  leftOverlay: byId<HTMLElement>("left-overlay"),
  leftStatus: byId<HTMLElement>("left-status"),
  leftStats: byId<HTMLElement>("left-stats"),

  rightEditorShell: byId<HTMLElement>("right-editor-shell"),
  rightContent: byId<HTMLElement>("right-content"),
  rightHighlight: byId<HTMLElement>("right-highlight"),
  rightInput: byId<HTMLTextAreaElement>("right-input"),
  rightLines: byId<HTMLElement>("right-lines"),
  rightFoldGutter: byId<HTMLElement>("right-fold-gutter"),
  rightOverlay: byId<HTMLElement>("right-overlay"),
  rightStatus: byId<HTMLElement>("right-status"),
  copyRightBtn: byId<HTMLButtonElement>("copy-right-btn"),
  tableModeBtn: byId<HTMLButtonElement>("table-mode-btn"),

  modeButtons: Array.from(document.querySelectorAll<HTMLButtonElement>(".mode-btn")),

  exploreView: byId<HTMLElement>("explore-view"),
  exploreSearch: byId<HTMLInputElement>("explore-search"),
  clearExploreSearch: byId<HTMLButtonElement>("clear-explore-search"),
  exploreBreadcrumb: byId<HTMLElement>("explore-breadcrumb"),
  exploreResults: byId<HTMLElement>("explore-results"),
  exploreColumns: byId<HTMLElement>("explore-columns"),

  diffView: byId<HTMLElement>("diff-view"),
  recomputeDiffBtn: byId<HTMLButtonElement>("recompute-diff-btn"),
  autoRecomputeToggle: byId<HTMLInputElement>("auto-recompute-toggle"),
  diffOutput: byId<HTMLElement>("diff-output"),
  tableView: byId<HTMLElement>("table-view"),
  tableOutput: byId<HTMLElement>("table-output"),

  rightViewError: byId<HTMLElement>("right-view-error"),
  statusBar: byId<HTMLElement>("status-bar"),
  statusPath: byId<HTMLElement>("status-path"),
  copyPathBtn: byId<HTMLButtonElement>("copy-path-btn"),
  pathHud: byId<HTMLElement>("path-hud"),
  pathHudLabel: byId<HTMLElement>("path-hud-label"),
  pathHudPath: byId<HTMLElement>("path-hud-path"),
  commandPalette: byId<HTMLElement>("command-palette"),
  commandInput: byId<HTMLInputElement>("command-input"),
  commandResults: byId<HTMLElement>("command-results"),
  toast: byId<HTMLElement>("toast"),
};

let toastTimer: number | undefined;
let leftPastePending = false;
let rightPastePending = false;

boot();

function boot() {
  bindEvents();
  renderCommandPalette();
  applyPaneSplitFromRatio();
  refreshFromLeft("programmatic");
}

function bindEvents() {
  elements.commandPaletteBtn.addEventListener("click", () => {
    if (state.commandPaletteOpen) {
      closeCommandPalette();
      return;
    }
    openCommandPalette();
  });

  elements.loadSampleBtn.addEventListener("click", () => {
    loadSampleIntoLeft();
  });

  elements.resyncBtn.addEventListener("click", () => {
    resyncRightFromLeft();
  });

  elements.leftInput.addEventListener("paste", () => {
    leftPastePending = true;
  });

  elements.leftInput.addEventListener("focus", () => {
    setHudContext("left", "Source");
  });

  elements.leftInput.addEventListener("input", () => {
    const source: UpdateSource = leftPastePending ? "paste" : "input";
    leftPastePending = false;
    state.leftText = elements.leftInput.value;
    refreshFromLeft(source);
  });

  elements.leftInput.addEventListener("scroll", () => {
    syncLineNumbers(elements.leftInput, elements.leftLines);
  });

  elements.rightInput.addEventListener("paste", () => {
    rightPastePending = true;
  });

  elements.rightInput.addEventListener("focus", () => {
    setHudContext("right", hudLabelForMode(state.mode));
  });

  elements.rightInput.addEventListener("input", () => {
    if (state.rightLocked) {
      return;
    }

    const source: UpdateSource = rightPastePending ? "paste" : "input";
    rightPastePending = false;

    state.rightDirty = true;
    state.rightText = elements.rightInput.value;
    state.rightParse = parseJsonWithDiagnostics(state.rightText);

    sanitizePathState();

    if (state.mode === "diff") {
      if (elements.autoRecomputeToggle.checked) {
        recomputeDiff(false);
      } else {
        state.diffDirtySinceRecompute = true;
      }
    }

    renderAll(source);
  });

  elements.rightInput.addEventListener("click", () => {
    updateCurrentPathFromRightCursor();
  });

  elements.rightInput.addEventListener("select", () => {
    updateCurrentPathFromRightCursor();
  });

  elements.rightInput.addEventListener("keyup", (event) => {
    if (
      event.key.startsWith("Arrow") ||
      event.key === "Home" ||
      event.key === "End" ||
      event.key === "PageUp" ||
      event.key === "PageDown"
    ) {
      updateCurrentPathFromRightCursor();
    }
  });

  elements.rightInput.addEventListener("scroll", () => {
    syncLineNumbers(elements.rightInput, elements.rightLines);
    syncRightHighlightScroll();
    if (state.mode === "json" && !state.rightLocked && state.rightParse.ok) {
      paintFoldGutter();
    }
  });

  elements.leftOverlay.addEventListener("click", () => {
    jumpToError("left", true);
  });

  elements.rightOverlay.addEventListener("click", () => {
    jumpToError("right", true);
  });

  elements.copyRightBtn.addEventListener("click", () => {
    void copyRightOutput();
  });

  elements.paneResizer.addEventListener("pointerdown", handlePaneResizePointerDown);
  elements.paneResizer.addEventListener("keydown", handlePaneResizeKeydown);

  elements.modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.mode as Mode | undefined;
      if (!mode) {
        return;
      }
      setMode(mode);
    });
  });

  elements.recomputeDiffBtn.addEventListener("click", () => {
    recomputeDiff(true);
  });

  elements.autoRecomputeToggle.addEventListener("change", () => {
    if (state.mode === "diff" && elements.autoRecomputeToggle.checked) {
      recomputeDiff(false);
    }
  });

  elements.exploreSearch.addEventListener("input", () => {
    state.exploreQuery = elements.exploreSearch.value.trim();
    updateExploreHits();
    if (state.mode === "explore") {
      renderExploreSurface();
    }
  });

  elements.exploreSearch.addEventListener("focus", () => {
    setHudContext("right", hudLabelForMode("explore"));
  });

  elements.clearExploreSearch.addEventListener("click", () => {
    state.exploreQuery = "";
    elements.exploreSearch.value = "";
    updateExploreHits();
    if (state.mode === "explore") {
      renderExploreSurface();
    }
  });

  elements.copyPathBtn.addEventListener("click", async () => {
    await copyActivePath();
  });

  elements.commandInput.addEventListener("input", () => {
    state.commandQuery = elements.commandInput.value.trim();
    state.commandSelectedIndex = 0;
    renderCommandPalette();
  });

  elements.commandPalette.addEventListener("click", (event) => {
    if (event.target === elements.commandPalette) {
      closeCommandPalette();
    }
  });

  document.addEventListener("focusin", (event) => {
    updateHudAnchorFromTarget(event.target);
  });

  window.addEventListener("keydown", handleGlobalKeydown);

  window.addEventListener("mousedown", (event) => {
    if (!state.commandPaletteOpen) {
      return;
    }
    const target = event.target as Node | null;
    if (!target) {
      return;
    }
    if (
      elements.commandPalette.contains(target) ||
      elements.commandPaletteBtn.contains(target)
    ) {
      return;
    }
    closeCommandPalette();
  });

  window.addEventListener("resize", () => {
    applyPaneSplitFromRatio();
    renderEditorLineNumbers();
    syncRightHighlightScroll();
    if (state.mode === "json" && !state.rightLocked && state.rightParse.ok) {
      paintFoldGutter();
    }
  });
}

function loadSampleIntoLeft() {
  const sample = {
    users: [
      { id: 1, name: "Ada", address: { city: "London", active: true } },
      { id: 2, name: "Linus", address: { city: "Helsinki", active: false } },
    ],
    meta: {
      version: 3,
      exportedAt: "2026-02-21T08:30:00Z",
      tags: ["sample", "demo"],
    },
    flags: { beta: null, retries: 2 },
  };

  elements.leftInput.value = JSON.stringify(sample, null, 2);
  state.leftText = elements.leftInput.value;
  state.rightDirty = false;
  refreshFromLeft("programmatic");
  setHudContext("left", "Source");
  showToast("Sample loaded on left.");
}

function resyncRightFromLeft() {
  if (state.rightLocked || !state.leftParse.ok) {
    return;
  }
  state.rightDirty = false;
  syncRightFromLeftForMode();
  renderAll("programmatic");
  if (state.mode === "diff") {
    recomputeDiff(true);
  }
  setHudContext("right", hudLabelForMode(state.mode));
  showToast("Right synced from left.");
}

async function copyRightOutput() {
  if (!state.rightText.trim()) {
    return;
  }
  const ok = await copyText(state.rightText);
  showToast(ok ? "Right JSON copied." : "Clipboard write failed.");
}

async function copyActivePath() {
  const ok = await copyPathText(state.currentPath);
  showToast(ok ? "Path copied." : "Clipboard write failed.");
}

function handlePaneResizePointerDown(event: PointerEvent) {
  if (shouldUseSingleColumnLayout()) {
    return;
  }

  const availableWidth = elements.workspaceGrid.clientWidth - PANE_RESIZER_WIDTH;
  if (availableWidth <= MIN_PANE_WIDTH_PX * 2) {
    return;
  }

  event.preventDefault();

  activePaneResize = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startLeftWidth: elements.leftPane.getBoundingClientRect().width,
    availableWidth,
  };

  elements.workspaceGrid.classList.add("is-resizing");
  document.body.classList.add("pane-resize-active");
  elements.paneResizer.setPointerCapture(event.pointerId);
  elements.paneResizer.addEventListener("pointermove", handlePaneResizePointerMove);
  elements.paneResizer.addEventListener("pointerup", handlePaneResizePointerUp);
  elements.paneResizer.addEventListener("pointercancel", handlePaneResizePointerUp);
}

function handlePaneResizePointerMove(event: PointerEvent) {
  if (!activePaneResize || event.pointerId !== activePaneResize.pointerId) {
    return;
  }

  const delta = event.clientX - activePaneResize.startX;
  const nextLeft = clamp(
    activePaneResize.startLeftWidth + delta,
    MIN_PANE_WIDTH_PX,
    activePaneResize.availableWidth - MIN_PANE_WIDTH_PX,
  );

  state.paneSplitRatio = nextLeft / activePaneResize.availableWidth;
  applyPaneSplitFromRatio();
}

function handlePaneResizePointerUp(event: PointerEvent) {
  if (!activePaneResize || event.pointerId !== activePaneResize.pointerId) {
    return;
  }

  elements.paneResizer.releasePointerCapture(event.pointerId);
  elements.paneResizer.removeEventListener("pointermove", handlePaneResizePointerMove);
  elements.paneResizer.removeEventListener("pointerup", handlePaneResizePointerUp);
  elements.paneResizer.removeEventListener("pointercancel", handlePaneResizePointerUp);
  elements.workspaceGrid.classList.remove("is-resizing");
  document.body.classList.remove("pane-resize-active");
  activePaneResize = null;
}

function handlePaneResizeKeydown(event: KeyboardEvent) {
  if (shouldUseSingleColumnLayout()) {
    return;
  }

  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
    return;
  }

  const availableWidth = elements.workspaceGrid.clientWidth - PANE_RESIZER_WIDTH;
  if (availableWidth <= MIN_PANE_WIDTH_PX * 2) {
    return;
  }

  event.preventDefault();

  const stepRatio = (event.shiftKey ? 12 : 24) / availableWidth;
  let nextRatio = state.paneSplitRatio ?? elements.leftPane.getBoundingClientRect().width / availableWidth;

  if (event.key === "ArrowLeft") {
    nextRatio -= stepRatio;
  } else if (event.key === "ArrowRight") {
    nextRatio += stepRatio;
  } else if (event.key === "Home") {
    nextRatio = MIN_PANE_WIDTH_PX / availableWidth;
  } else if (event.key === "End") {
    nextRatio = 1 - MIN_PANE_WIDTH_PX / availableWidth;
  }

  state.paneSplitRatio = nextRatio;
  applyPaneSplitFromRatio();
}

function handleGlobalKeydown(event: KeyboardEvent) {
  if (event.isComposing) {
    return;
  }

  const key = event.key.toLowerCase();
  const isPaletteShortcut = (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && key === "k";

  if (isPaletteShortcut) {
    event.preventDefault();
    if (state.commandPaletteOpen) {
      closeCommandPalette();
    } else {
      openCommandPalette();
    }
    return;
  }

  if (!state.commandPaletteOpen) {
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    closeCommandPalette();
    return;
  }

  const visible = getVisibleCommands();
  if (!visible.length) {
    return;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    state.commandSelectedIndex = (state.commandSelectedIndex + 1) % visible.length;
    renderCommandPalette();
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    state.commandSelectedIndex = (state.commandSelectedIndex - 1 + visible.length) % visible.length;
    renderCommandPalette();
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    const active = visible[state.commandSelectedIndex];
    if (active) {
      executePaletteCommand(active);
    }
  }
}

function openCommandPalette() {
  state.commandPaletteOpen = true;
  state.commandQuery = "";
  state.commandSelectedIndex = 0;
  elements.commandInput.value = "";
  setHudContext("center", "Command Palette");
  renderCommandPalette();
  window.requestAnimationFrame(() => {
    elements.commandInput.focus();
  });
}

function closeCommandPalette() {
  if (!state.commandPaletteOpen) {
    return;
  }
  state.commandPaletteOpen = false;
  state.commandQuery = "";
  state.commandSelectedIndex = 0;
  elements.commandInput.value = "";
  renderCommandPalette();
  updateHudAnchorFromTarget(document.activeElement);
  if (state.hudAnchor === "center") {
    setHudContext(state.rightLocked ? "left" : "right", state.rightLocked ? "Source" : hudLabelForMode(state.mode));
  }
}

function renderCommandPalette() {
  elements.commandPalette.classList.toggle("hidden", !state.commandPaletteOpen);
  elements.commandPaletteBtn.classList.toggle("active", state.commandPaletteOpen);
  document.body.classList.toggle("command-palette-open", state.commandPaletteOpen);

  const visible = getVisibleCommands();
  const maxIndex = Math.max(0, visible.length - 1);
  state.commandSelectedIndex = clamp(state.commandSelectedIndex, 0, maxIndex);

  elements.commandResults.textContent = "";

  if (!state.commandPaletteOpen) {
    return;
  }

  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "command-empty";
    empty.textContent = "No commands match that query.";
    elements.commandResults.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();

  visible.forEach((command, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "command-item";
    button.setAttribute("data-command-id", command.id);
    button.classList.toggle("active", index === state.commandSelectedIndex);

    const textWrap = document.createElement("span");
    textWrap.className = "command-item-copy";

    const label = document.createElement("span");
    label.className = "command-item-label";
    label.textContent = command.label;

    const hint = document.createElement("span");
    hint.className = "command-item-hint";
    hint.textContent = command.hint;

    textWrap.append(label, hint);
    button.appendChild(textWrap);

    button.addEventListener("mouseenter", () => {
      if (state.commandSelectedIndex === index) {
        return;
      }
      state.commandSelectedIndex = index;
      renderCommandPalette();
    });

    button.addEventListener("click", () => {
      executePaletteCommand(command);
    });

    fragment.appendChild(button);
  });

  elements.commandResults.appendChild(fragment);
}

function executePaletteCommand(command: CommandItem) {
  closeCommandPalette();
  void Promise.resolve(command.run()).catch(() => {
    showToast("Command failed.");
  });
}

function getVisibleCommands(): CommandItem[] {
  const query = state.commandQuery.toLowerCase();

  return getCommandItems().filter((command) => {
    if (command.isAvailable && !command.isAvailable()) {
      return false;
    }
    if (!query) {
      return true;
    }
    const haystack = `${command.label} ${command.hint} ${command.keywords}`.toLowerCase();
    return haystack.includes(query);
  });
}

function getCommandItems(): CommandItem[] {
  return [
    {
      id: "mode-json",
      label: "Switch Mode: JSON",
      hint: "Formatted and foldable JSON view",
      keywords: "mode json pretty format",
      run: () => setMode("json"),
    },
    {
      id: "mode-minify",
      label: "Switch Mode: Minify",
      hint: "Compact JSON editing mode",
      keywords: "mode minify compact",
      run: () => setMode("minify"),
    },
    {
      id: "mode-explore",
      label: "Switch Mode: Inspector",
      hint: "Browse structure with Miller columns",
      keywords: "mode explore inspector columns",
      run: () => setMode("explore"),
    },
    {
      id: "mode-diff",
      label: "Switch Mode: Diff",
      hint: "Compare left and right JSON",
      keywords: "mode diff compare",
      run: () => setMode("diff"),
    },
    {
      id: "mode-table",
      label: "Switch Mode: Table",
      hint: "Array-to-table surface",
      keywords: "mode table array grid",
      run: () => setMode("table"),
      isAvailable: () => isTableModeAvailable(),
    },
    {
      id: "load-sample",
      label: "Load Sample JSON",
      hint: "Fill left editor with demo data",
      keywords: "sample left quickstart",
      run: () => loadSampleIntoLeft(),
    },
    {
      id: "resync-right",
      label: "Resync Right From Left",
      hint: "Reset right pane to left JSON",
      keywords: "resync right sync reset",
      run: () => resyncRightFromLeft(),
      isAvailable: () => !state.rightLocked && state.leftParse.ok,
    },
    {
      id: "copy-right",
      label: "Copy Right JSON",
      hint: "Copy current right content",
      keywords: "copy right clipboard",
      run: () => copyRightOutput(),
      isAvailable: () => !state.rightLocked && !!state.rightText.trim(),
    },
    {
      id: "recompute-diff",
      label: "Recompute Diff",
      hint: "Refresh diff rows now",
      keywords: "diff recompute refresh",
      run: () => {
        if (state.mode !== "diff") {
          setMode("diff");
        }
        recomputeDiff(true);
      },
      isAvailable: () => !state.rightLocked,
    },
    {
      id: "toggle-auto-diff",
      label: "Toggle Auto Recompute",
      hint: elements.autoRecomputeToggle.checked ? "Currently enabled" : "Currently disabled",
      keywords: "diff auto recompute toggle",
      run: () => {
        elements.autoRecomputeToggle.checked = !elements.autoRecomputeToggle.checked;
        if (state.mode === "diff" && elements.autoRecomputeToggle.checked) {
          recomputeDiff(false);
        }
        showToast(`Auto recompute ${elements.autoRecomputeToggle.checked ? "enabled" : "disabled"}.`);
      },
      isAvailable: () => !state.rightLocked,
    },
    {
      id: "copy-path",
      label: "Copy Active Path",
      hint: "Copy dot path and JSONPath",
      keywords: "path copy breadcrumb",
      run: () => copyActivePath(),
      isAvailable: () => !state.rightLocked && state.rightParse.ok,
    },
  ];
}

function hudLabelForMode(mode: Mode): string {
  if (mode === "json") {
    return "Right JSON";
  }
  if (mode === "minify") {
    return "Minify";
  }
  if (mode === "explore") {
    return "Inspector";
  }
  if (mode === "diff") {
    return "Diff";
  }
  return "Table";
}

function setHudContext(anchor: HudAnchor, label: string) {
  state.hudAnchor = anchor;
  state.hudLabel = label;
  renderStatusPath();
}

function updateHudAnchorFromTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (elements.commandPalette.contains(target)) {
    if (state.commandPaletteOpen) {
      setHudContext("center", "Command Palette");
    }
    return;
  }

  if (elements.leftPane.contains(target)) {
    setHudContext("left", "Source");
    return;
  }

  if (elements.rightPane.contains(target) || elements.statusBar.contains(target)) {
    setHudContext("right", hudLabelForMode(state.mode));
  }
}

function updateCurrentPathFromRightCursor() {
  if (state.rightLocked || !state.rightParse.ok) {
    return;
  }

  if (state.mode !== "json") {
    state.currentPath = [];
    renderStatusPath();
    return;
  }

  const offset = elements.rightInput.selectionStart ?? 0;
  const line = Math.max(0, elements.rightInput.value.slice(0, offset).split(/\r?\n/).length - 1);
  const marker = findNearestFoldMarker(line);
  state.currentPath = marker ? marker.path.slice() : [];
  renderStatusPath();
}

function findNearestFoldMarker(line: number): FoldMarker | null {
  for (let index = state.jsonFoldMarkers.length - 1; index >= 0; index -= 1) {
    const marker = state.jsonFoldMarkers[index];
    if (marker.line <= line) {
      return marker;
    }
  }
  return state.jsonFoldMarkers[0] ?? null;
}

function shouldUseSingleColumnLayout(): boolean {
  return window.matchMedia("(max-width: 1220px)").matches;
}

function applyPaneSplitFromRatio() {
  if (shouldUseSingleColumnLayout()) {
    clearPaneSplit();
    return;
  }

  const availableWidth = elements.workspaceGrid.clientWidth - PANE_RESIZER_WIDTH;
  if (availableWidth <= MIN_PANE_WIDTH_PX * 2) {
    clearPaneSplit();
    return;
  }

  const minRatio = MIN_PANE_WIDTH_PX / availableWidth;
  const maxRatio = 1 - minRatio;
  const nextRatio = clamp(state.paneSplitRatio ?? 0.5, minRatio, maxRatio);
  state.paneSplitRatio = nextRatio;

  const leftWidth = Math.round(availableWidth * nextRatio);
  const rightWidth = Math.round(availableWidth - leftWidth);
  elements.workspaceGrid.style.gridTemplateColumns = `${leftWidth}px ${PANE_RESIZER_WIDTH}px ${rightWidth}px`;
  elements.paneResizer.setAttribute("aria-valuenow", String(Math.round(nextRatio * 100)));
}

function clearPaneSplit() {
  elements.workspaceGrid.style.removeProperty("grid-template-columns");
  elements.workspaceGrid.classList.remove("is-resizing");
  document.body.classList.remove("pane-resize-active");
  if (activePaneResize) {
    elements.paneResizer.removeEventListener("pointermove", handlePaneResizePointerMove);
    elements.paneResizer.removeEventListener("pointerup", handlePaneResizePointerUp);
    elements.paneResizer.removeEventListener("pointercancel", handlePaneResizePointerUp);
  }
  activePaneResize = null;
}

function refreshFromLeft(source: UpdateSource) {
  state.leftParse = parseJsonWithDiagnostics(state.leftText);

  if (state.leftText.trim()) {
    unlockRight();
  } else {
    lockRight();
  }

  if (!state.rightLocked) {
    if (state.leftParse.ok && !state.rightDirty) {
      syncRightFromLeftForMode();
    } else {
      state.rightText = elements.rightInput.value;
      state.rightParse = parseJsonWithDiagnostics(state.rightText);
    }
  }

  sanitizePathState();
  updateExploreHits();
  renderAll(source);

  if (state.mode === "diff") {
    if (elements.autoRecomputeToggle.checked) {
      recomputeDiff(false);
    } else {
      state.diffDirtySinceRecompute = true;
      renderDiffSurface();
    }
  }
}

function unlockRight() {
  if (!state.rightLocked) {
    return;
  }
  state.rightLocked = false;
  elements.rightInput.disabled = false;
  elements.rightInput.placeholder = "Right JSON";
}

function lockRight() {
  state.rightLocked = true;
  state.rightDirty = false;
  state.rightLayout = null;
  state.rightText = "";
  state.rightParse = emptyParse();
  state.jsonFoldCollapsed.clear();
  state.jsonFoldMarkers = [];
  state.explorePath = [];
  state.currentPath = [];
  state.exploreHits = [];
  state.exploreQuery = "";
  state.diffRows = [];
  state.diffDirtySinceRecompute = false;
  state.errorLineFocus.right = null;

  elements.exploreSearch.value = "";
  elements.rightInput.disabled = true;
  elements.rightInput.readOnly = false;
  elements.rightInput.value = "";
  elements.rightInput.placeholder = "Right editor is locked until left has content.";
  elements.rightFoldGutter.classList.add("hidden");
  setHudContext("left", "Source");
}

function setMode(mode: Mode) {
  if (state.mode === mode) {
    setHudContext("right", hudLabelForMode(state.mode));
    return;
  }

  state.mode = mode;

  if (!state.rightLocked && state.leftParse.ok && !state.rightDirty) {
    syncRightFromLeftForMode();
  }

  if (mode !== "explore" && mode !== "json") {
    state.currentPath = [];
  }

  renderAll("programmatic");
  setHudContext("right", hudLabelForMode(state.mode));

  if (state.mode === "diff") {
    recomputeDiff(true);
  }
}

function syncRightFromLeftForMode() {
  if (state.rightLocked || !state.leftParse.ok) {
    return;
  }

  const formatted = state.mode === "minify"
    ? JSON.stringify(state.leftParse.value)
    : JSON.stringify(state.leftParse.value, null, 2);

  state.rightText = formatted;
  state.rightParse = parseJsonWithDiagnostics(formatted);
}

function normalizeModeAvailability() {
  if (state.mode === "table" && !isTableModeAvailable()) {
    state.mode = "json";
  }
}

function isTableModeAvailable(): boolean {
  return !state.rightLocked && state.rightParse.ok && Array.isArray(state.rightParse.value);
}

function renderAll(source: UpdateSource) {
  normalizeModeAvailability();
  renderLeftPanel(source);
  renderRightPanel(source);
  renderModePanels();
  renderEditorLineNumbers();
  renderStatusPath();
}

function renderLeftPanel(source: UpdateSource) {
  renderStatePill(elements.leftStatus, state.leftParse, false);

  if (state.leftParse.ok) {
    const stats = computeTypeStats(state.leftParse.value);
    elements.leftStats.textContent = `${stats.keys} keys, ${stats.objects} objects, ${stats.arrays} arrays, ${stats.nulls} null.`;
  } else if (state.leftParse.empty) {
    elements.leftStats.textContent = "Left is source. Right unlocks after first paste.";
  } else {
    elements.leftStats.textContent = "Left JSON is invalid.";
  }

  renderErrorOverlay({
    side: "left",
    source,
    parse: state.leftParse,
    textarea: elements.leftInput,
    overlay: elements.leftOverlay,
  });
}

function renderRightPanel(source: UpdateSource) {
  renderStatePill(elements.rightStatus, state.rightParse, state.rightLocked);

  const editorVisible = state.mode !== "explore" && state.mode !== "table";
  const showOverlay =
    editorVisible &&
    state.mode !== "diff" &&
    !state.rightLocked &&
    !state.rightParse.empty &&
    !state.rightParse.ok;

  if (showOverlay) {
    renderErrorOverlay({
      side: "right",
      source,
      parse: state.rightParse,
      textarea: elements.rightInput,
      overlay: elements.rightOverlay,
    });
  } else {
    elements.rightOverlay.classList.add("hidden");
    elements.rightInput.classList.remove("has-error", "error-focus");
  }

  elements.copyRightBtn.disabled = state.rightLocked || !state.rightText.trim().length;
  elements.resyncBtn.disabled = state.rightLocked || !state.leftParse.ok;
}

function renderStatePill(target: HTMLElement, parse: ParseResult, locked: boolean) {
  target.classList.remove("neutral", "valid", "invalid");

  if (locked) {
    target.classList.add("neutral");
    target.textContent = "Locked";
    return;
  }

  if (parse.empty) {
    target.classList.add("neutral");
    target.textContent = "Waiting";
    return;
  }

  if (parse.ok) {
    target.classList.add("valid");
    target.textContent = `Valid ${valueType(parse.value)}`;
    return;
  }

  target.classList.add("invalid");
  target.textContent = `Invalid ${parse.error?.line}:${parse.error?.column}`;
}

function renderErrorOverlay(config: {
  side: "left" | "right";
  source: UpdateSource;
  parse: ParseResult;
  textarea: HTMLTextAreaElement;
  overlay: HTMLElement;
}) {
  const { side, source, parse, textarea, overlay } = config;

  if (side === "right" && state.rightLocked) {
    overlay.classList.add("hidden");
    textarea.classList.remove("has-error");
    return;
  }

  if (parse.empty || parse.ok || !parse.error) {
    overlay.classList.add("hidden");
    textarea.classList.remove("has-error", "error-focus");
    state.errorLineFocus[side] = null;
    if (parse.ok) {
      state.lastHighlighted[side] = null;
    }
    return;
  }

  textarea.classList.add("has-error");
  overlay.classList.remove("hidden");
  overlay.textContent = "";

  const title = document.createElement("p");
  title.className = "overlay-title";
  title.textContent = `Invalid JSON at line ${parse.error.line}, column ${parse.error.column} (click to jump)`;
  overlay.appendChild(title);

  const message = document.createElement("p");
  message.className = "overlay-line";
  message.textContent = parse.error.message;
  overlay.appendChild(message);

  const suggestion = document.createElement("p");
  suggestion.className = "overlay-line";
  suggestion.textContent = parse.error.suggestion;
  overlay.appendChild(suggestion);

  const code = document.createElement("pre");
  code.className = "overlay-code";
  code.textContent = `${truncate(parse.error.lineText, 140)}\n${truncate(parse.error.caretLine, 140)}`;
  overlay.appendChild(code);
  state.errorLineFocus[side] = parse.error.line;

  if ((source === "paste" || source === "programmatic") && state.lastHighlighted[side] !== parse.error.position) {
    highlightError(textarea, parse.error.position, false);
    state.lastHighlighted[side] = parse.error.position;
  }
}

function jumpToError(side: "left" | "right", focus: boolean) {
  const parse = side === "left" ? state.leftParse : state.rightParse;
  const textarea = side === "left" ? elements.leftInput : elements.rightInput;
  if (!parse.error) {
    return;
  }
  state.errorLineFocus[side] = parse.error.line;
  highlightError(textarea, parse.error.position, focus);
  renderEditorLineNumbers();
}

function highlightError(textarea: HTMLTextAreaElement, position: number, focus: boolean) {
  if (!textarea.value.length) {
    return;
  }

  const start = clamp(position, 0, textarea.value.length - 1);
  const end = clamp(start + 1, 0, textarea.value.length);

  if (focus) {
    textarea.focus();
  }

  textarea.setSelectionRange(start, end);
  const lineNumber = textarea.value.slice(0, start).split(/\r?\n/).length;
  const layout = computeTextLayoutMetrics(textarea);
  const lineTop = layout.lineTops[Math.max(0, lineNumber - 1)] ?? 0;
  textarea.scrollTop = Math.max(0, lineTop - layout.lineHeight * 2);

  textarea.classList.add("error-focus");
  window.setTimeout(() => {
    textarea.classList.remove("error-focus");
  }, 450);
}

function renderModePanels() {
  const tableModeVisible = isTableModeAvailable();
  elements.tableModeBtn.classList.toggle("hidden", !tableModeVisible);

  elements.modeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === state.mode);
  });

  elements.rightEditorShell.classList.toggle("hidden", state.mode === "explore" || state.mode === "table");
  elements.tableView.classList.toggle("hidden", state.mode !== "table");
  elements.exploreView.classList.toggle("hidden", state.mode !== "explore");
  elements.diffView.classList.toggle("hidden", state.mode !== "diff");
  elements.statusBar.classList.toggle("hidden", state.mode !== "explore");
  elements.rightContent.classList.toggle("diff-active", state.mode === "diff");

  elements.rightViewError.classList.add("hidden");

  updateRightEditorDisplay();

  if (state.mode === "explore") {
    renderExploreSurface();
  }

  if (state.mode === "diff") {
    renderDiffSurface();
  }

  if (state.mode === "table") {
    renderTableSurface();
  }
}

function updateRightEditorDisplay() {
  const preservedScrollTop = elements.rightInput.scrollTop;
  const preservedScrollLeft = elements.rightInput.scrollLeft;

  if (state.rightLocked) {
    elements.rightInput.disabled = true;
    elements.rightInput.readOnly = false;
    elements.rightInput.value = "";
    elements.rightInput.scrollTop = 0;
    elements.rightInput.scrollLeft = 0;
    elements.rightFoldGutter.classList.add("hidden");
    elements.rightInput.classList.remove("with-gutter");
    disableRightSyntaxHighlight();
    return;
  }

  elements.rightInput.disabled = false;

  if (state.mode === "json") {
    if (!state.rightParse.ok) {
      elements.rightInput.readOnly = false;
      elements.rightInput.classList.remove("with-gutter");
      elements.rightInput.value = state.rightText;
      elements.rightInput.scrollTop = preservedScrollTop;
      elements.rightInput.scrollLeft = preservedScrollLeft;
      elements.rightFoldGutter.classList.add("hidden");
      disableRightSyntaxHighlight();
      return;
    }

    elements.rightInput.readOnly = true;
    elements.rightInput.classList.add("with-gutter");

    const folded = renderFoldedJsonText(state.rightParse.value, state.jsonFoldCollapsed);
    state.jsonFoldMarkers = folded.markers;
    elements.rightInput.value = folded.text;
    elements.rightInput.scrollTop = preservedScrollTop;
    elements.rightInput.scrollLeft = preservedScrollLeft;
    renderRightSyntaxHighlight(folded.text);
    syncRightHighlightScroll();
    paintFoldGutter();
    updateCurrentPathFromRightCursor();
    return;
  }

  elements.rightInput.readOnly = false;
  elements.rightInput.classList.remove("with-gutter");
  elements.rightInput.value = state.rightText;
  elements.rightInput.scrollTop = preservedScrollTop;
  elements.rightInput.scrollLeft = preservedScrollLeft;
  elements.rightFoldGutter.classList.add("hidden");
  disableRightSyntaxHighlight();
}

function renderRightSyntaxHighlight(text: string) {
  elements.rightEditorShell.classList.add("json-syntax-active");
  elements.rightHighlight.classList.remove("hidden");
  elements.rightHighlight.innerHTML = buildJsonSyntaxHtml(text);
}

function disableRightSyntaxHighlight() {
  elements.rightEditorShell.classList.remove("json-syntax-active");
  elements.rightHighlight.classList.add("hidden");
  elements.rightHighlight.textContent = "";
}

function syncRightHighlightScroll() {
  elements.rightHighlight.scrollTop = elements.rightInput.scrollTop;
  elements.rightHighlight.scrollLeft = elements.rightInput.scrollLeft;
}

function buildJsonSyntaxHtml(text: string): string {
  const parts: string[] = [];
  let index = 0;

  while (index < text.length) {
    const char = text[index];

    if (char === "\"") {
      const end = readJsonStringEnd(text, index);
      const token = text.slice(index, end);
      let lookahead = end;
      while (lookahead < text.length && /\s/.test(text[lookahead])) {
        lookahead += 1;
      }
      const className = text[lookahead] === ":" ? "tok-key" : "tok-string";
      parts.push(wrapJsonToken(token, className));
      index = end;
      continue;
    }

    if (char === "-" || /[0-9]/.test(char)) {
      const match = text.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      if (match) {
        parts.push(wrapJsonToken(match[0], "tok-number"));
        index += match[0].length;
        continue;
      }
    }

    if (
      text.startsWith("true", index) &&
      isWordBoundary(text[index - 1]) &&
      isWordBoundary(text[index + 4])
    ) {
      parts.push(wrapJsonToken("true", "tok-boolean"));
      index += 4;
      continue;
    }

    if (
      text.startsWith("false", index) &&
      isWordBoundary(text[index - 1]) &&
      isWordBoundary(text[index + 5])
    ) {
      parts.push(wrapJsonToken("false", "tok-boolean"));
      index += 5;
      continue;
    }

    if (
      text.startsWith("null", index) &&
      isWordBoundary(text[index - 1]) &&
      isWordBoundary(text[index + 4])
    ) {
      parts.push(wrapJsonToken("null", "tok-null"));
      index += 4;
      continue;
    }

    if ("{}[],:".includes(char)) {
      parts.push(wrapJsonToken(char, "tok-punc"));
      index += 1;
      continue;
    }

    parts.push(escapeHtml(char));
    index += 1;
  }

  return parts.join("");
}

function readJsonStringEnd(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "\"") {
      return index + 1;
    }
    index += 1;
  }
  return text.length;
}

function isWordBoundary(char: string | undefined): boolean {
  if (!char) {
    return true;
  }
  return /[\s\[\]{}:,]/.test(char);
}

function wrapJsonToken(token: string, className: string): string {
  return `<span class="syntax-token ${className}">${escapeHtml(token)}</span>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderFoldedJsonText(root: any, collapsed: Set<string>) {
  const lines: string[] = [];
  const markers: FoldMarker[] = [];

  renderNode(root, 0, [], null, true);

  return { text: lines.join("\n"), markers };

  function renderNode(value: any, depth: number, path: PathSegment[], key: PathSegment | null, isLast: boolean) {
    const indent = "  ".repeat(depth);
    const keyPrefix = key === null ? "" : `${JSON.stringify(String(key))}: `;

    if (Array.isArray(value) || isPlainObject(value)) {
      const entries = getEntries(value);
      const open = Array.isArray(value) ? "[" : "{";
      const close = Array.isArray(value) ? "]" : "}";

      const pathKey = JSON.stringify(path);
      const hasChildren = entries.length > 0;
      const isCollapsed = hasChildren && collapsed.has(pathKey);

      markers.push({
        path: path.slice(),
        pathKey,
        line: lines.length,
        depth,
        collapsed: isCollapsed,
        hasChildren,
      });

      if (isCollapsed) {
        const summary = Array.isArray(value)
          ? `${open} ... ${entries.length} item${entries.length === 1 ? "" : "s"} ... ${close}`
          : `${open} ... ${entries.length} key${entries.length === 1 ? "" : "s"} ... ${close}`;
        lines.push(`${indent}${keyPrefix}${summary}${isLast ? "" : ","}`);
        return;
      }

      lines.push(`${indent}${keyPrefix}${open}`);
      entries.forEach(([childKey, childValue], index) => {
        const childPath = path.concat(childKey);
        const childKeyLabel = Array.isArray(value) ? null : childKey;
        renderNode(childValue, depth + 1, childPath, childKeyLabel, index === entries.length - 1);
      });
      lines.push(`${indent}${close}${isLast ? "" : ","}`);
      return;
    }

    lines.push(`${indent}${keyPrefix}${JSON.stringify(value)}${isLast ? "" : ","}`);
  }
}

function paintFoldGutter() {
  if (state.mode !== "json" || state.rightLocked || !state.rightParse.ok) {
    elements.rightFoldGutter.classList.add("hidden");
    elements.rightFoldGutter.textContent = "";
    return;
  }

  const markers = state.jsonFoldMarkers.filter((marker) => marker.hasChildren);
  if (!markers.length) {
    elements.rightFoldGutter.classList.add("hidden");
    elements.rightFoldGutter.textContent = "";
    return;
  }

  const gutter = elements.rightFoldGutter;
  gutter.classList.remove("hidden");
  gutter.textContent = "";

  const computed = window.getComputedStyle(elements.rightInput);
  const lineHeight = Number.parseFloat(computed.lineHeight) || 20;
  const paddingTop = Number.parseFloat(computed.paddingTop) || 12;
  const scrollTop = elements.rightInput.scrollTop;
  const viewportHeight = elements.rightInput.clientHeight;
  const lineCount = Math.max(1, elements.rightInput.value.split(/\r?\n/).length);
  const layout = state.rightLayout && state.rightLayout.lineHeights.length === lineCount
    ? state.rightLayout
    : computeTextLayoutMetrics(elements.rightInput);

  markers.forEach((marker) => {
    const lineTop = layout.lineTops[marker.line] ?? marker.line * lineHeight;
    const y = paddingTop + lineTop - scrollTop;
    if (y < -20 || y > viewportHeight + 20) {
      return;
    }

    const iconSize = 16;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `fold-icon ${marker.collapsed ? "collapsed" : "expanded"}`;
    button.textContent = "";
    button.setAttribute("aria-label", marker.collapsed ? "Expand node" : "Collapse node");
    button.title = marker.collapsed ? "Expand" : "Collapse";
    button.style.top = `${Math.round(y + Math.max(0, (lineHeight - iconSize) / 2))}px`;
    button.style.left = "1px";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleFold(marker.pathKey);
    });
    gutter.appendChild(button);
  });
}

function toggleFold(pathKey: string) {
  if (state.jsonFoldCollapsed.has(pathKey)) {
    state.jsonFoldCollapsed.delete(pathKey);
  } else {
    state.jsonFoldCollapsed.add(pathKey);
  }

  updateRightEditorDisplay();
  renderEditorLineNumbers();
}

function renderEditorLineNumbers() {
  state.leftLayout = renderLineNumbersFor(
    elements.leftInput,
    elements.leftLines,
    state.errorLineFocus.left,
  );

  if (state.rightLocked) {
    elements.rightLines.textContent = "";
    elements.rightLines.style.transform = "translateY(0px)";
    state.rightLayout = null;
    return;
  }

  state.rightLayout = renderLineNumbersFor(
    elements.rightInput,
    elements.rightLines,
    state.errorLineFocus.right,
  );

  if (state.mode === "json" && state.rightParse.ok) {
    paintFoldGutter();
  }
}

function renderLineNumbersFor(
  textarea: HTMLTextAreaElement,
  linesContainer: HTMLElement,
  errorLine: number | null,
): TextLayoutMetrics {
  const metrics = computeTextLayoutMetrics(textarea);
  const lineCount = Math.max(1, metrics.lineHeights.length);

  const fragment = document.createDocumentFragment();
  for (let line = 1; line <= lineCount; line += 1) {
    const item = document.createElement("div");
    item.className = "line-number";
    if (errorLine === line) {
      item.classList.add("error-line");
    }
    item.style.height = `${metrics.lineHeights[line - 1]}px`;
    item.style.lineHeight = `${metrics.lineHeight}px`;
    item.textContent = String(line);
    fragment.appendChild(item);
  }

  linesContainer.textContent = "";
  linesContainer.appendChild(fragment);
  syncLineNumbers(textarea, linesContainer);
  return metrics;
}

function syncLineNumbers(textarea: HTMLTextAreaElement, linesContainer: HTMLElement) {
  linesContainer.style.transform = `translateY(${-textarea.scrollTop}px)`;
}

function getEditorLineHeight(textarea: HTMLTextAreaElement): number {
  const computed = window.getComputedStyle(textarea);
  const lineHeight = Number.parseFloat(computed.lineHeight);
  return Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : 20;
}

function computeTextLayoutMetrics(textarea: HTMLTextAreaElement): TextLayoutMetrics {
  const lineHeight = getEditorLineHeight(textarea);
  const wrapColumns = computeWrapColumns(textarea);
  const lines = textarea.value.split(/\r?\n/);
  const lineCount = Math.max(1, lines.length);
  const lineTops: number[] = [];
  const lineHeights: number[] = [];

  let top = 0;
  for (let index = 0; index < lineCount; index += 1) {
    const text = lines[index] ?? "";
    const rows = estimateWrappedRows(text, wrapColumns);
    const height = Math.max(lineHeight, rows * lineHeight);

    lineTops.push(top);
    lineHeights.push(height);
    top += height;
  }

  return {
    lineHeight,
    lineTops,
    lineHeights,
    totalHeight: top,
  };
}

function computeWrapColumns(textarea: HTMLTextAreaElement): number {
  const computed = window.getComputedStyle(textarea);
  const paddingLeft = Number.parseFloat(computed.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(computed.paddingRight) || 0;
  const contentWidth = Math.max(1, textarea.clientWidth - paddingLeft - paddingRight);
  const charWidth = getMonoCharWidth(computed);
  return Math.max(1, Math.floor(contentWidth / charWidth));
}

function getMonoCharWidth(computed: CSSStyleDeclaration): number {
  const key = `${computed.font}|${computed.letterSpacing}`;
  const cached = monoCharWidthCache.get(key);
  if (cached) {
    return cached;
  }

  if (!charMeasureCanvas) {
    charMeasureCanvas = document.createElement("canvas");
  }

  const context = charMeasureCanvas.getContext("2d");
  let width = 8;
  if (context) {
    context.font = computed.font;
    width = context.measureText("0").width;
  }

  const letterSpacing = Number.parseFloat(computed.letterSpacing);
  if (Number.isFinite(letterSpacing)) {
    width += letterSpacing;
  }

  const normalized = Number.isFinite(width) && width > 0 ? width : 8;
  monoCharWidthCache.set(key, normalized);
  return normalized;
}

function estimateWrappedRows(text: string, wrapColumns: number): number {
  if (wrapColumns <= 1) {
    return Math.max(1, text.length || 1);
  }

  const normalized = text.replace(/\t/g, "  ");
  return Math.max(1, Math.ceil((normalized.length || 1) / wrapColumns));
}

function renderExploreSurface() {
  if (!state.rightParse.ok) {
    elements.exploreColumns.classList.add("empty-state");
    elements.exploreColumns.textContent = "Right JSON is invalid. Switch to minify/diff mode to edit and fix.";
    elements.exploreBreadcrumb.textContent = "root";
    elements.exploreResults.textContent = "";
    elements.exploreSearch.disabled = true;
    elements.clearExploreSearch.disabled = true;
    renderRightViewError(
      `Right invalid at ${state.rightParse.error?.line}:${state.rightParse.error?.column}. ${state.rightParse.error?.message ?? ""}`,
    );
    return;
  }

  elements.exploreSearch.disabled = false;
  elements.clearExploreSearch.disabled = false;

  renderExploreBreadcrumb();
  renderExploreHits();
  renderExploreColumns();
}

function renderExploreBreadcrumb() {
  const root = state.rightParse.value;
  state.explorePath = sanitizePath(state.explorePath, root);
  state.currentPath = state.explorePath.slice();

  const container = elements.exploreBreadcrumb;
  container.textContent = "";

  const rootCrumb = document.createElement("button");
  rootCrumb.type = "button";
  rootCrumb.className = "crumb";
  rootCrumb.textContent = "root";
  rootCrumb.addEventListener("click", () => {
    state.explorePath = [];
    state.currentPath = [];
    renderExploreSurface();
    renderStatusPath();
  });
  container.appendChild(rootCrumb);

  state.explorePath.forEach((segment, index) => {
    const sep = document.createElement("span");
    sep.className = "crumb-sep";
    sep.textContent = ">";
    container.appendChild(sep);

    const crumb = document.createElement("button");
    crumb.type = "button";
    crumb.className = "crumb";
    crumb.textContent = String(segment);
    crumb.addEventListener("click", () => {
      const next = state.explorePath.slice(0, index + 1);
      state.explorePath = sanitizePath(next, root);
      state.currentPath = state.explorePath.slice();
      renderExploreSurface();
      renderStatusPath();
    });
    container.appendChild(crumb);
  });
}

function renderExploreColumns() {
  elements.exploreColumns.textContent = "";
  elements.exploreColumns.classList.remove("empty-state");

  const root = state.rightParse.value;
  let node = root;

  const columns: Array<{ basePath: PathSegment[]; node: any; depth: number }> = [{
    basePath: [],
    node,
    depth: 0,
  }];

  let depth = 0;
  while (isContainer(node)) {
    const selected = state.explorePath[depth];
    if (selected === undefined || !hasChild(node, selected)) {
      break;
    }

    node = node[selected as any];
    if (!isContainer(node)) {
      break;
    }

    columns.push({
      basePath: state.explorePath.slice(0, depth + 1),
      node,
      depth: depth + 1,
    });
    depth += 1;
  }

  columns.forEach((columnInfo) => {
    const column = document.createElement("section");
    column.className = "miller-col";

    const head = document.createElement("header");
    head.className = "miller-head";
    head.textContent = columnInfo.depth === 0 ? "root" : formatPath(columnInfo.basePath);
    column.appendChild(head);

    const list = document.createElement("ul");
    list.className = "miller-list";

    getEntries(columnInfo.node).forEach(([key, value]) => {
      const path = columnInfo.basePath.concat(key);

      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "miller-item";

      if (JSON.stringify(path) === JSON.stringify(state.explorePath)) {
        button.classList.add("active");
      }
      if (matchesQuery(key, value, state.exploreQuery)) {
        button.classList.add("match");
      }

      const keyText = document.createElement("span");
      keyText.className = "item-key";
      keyText.textContent = Array.isArray(columnInfo.node) ? `[${key}]` : String(key);

      const metaText = document.createElement("span");
      metaText.className = "item-meta";
      metaText.textContent = entryMeta(value);

      button.append(keyText, metaText);
      button.addEventListener("click", () => {
        state.explorePath = sanitizePath(path, root);
        state.currentPath = state.explorePath.slice();
        renderExploreSurface();
        renderStatusPath();
      });

      item.appendChild(button);
      list.appendChild(item);
    });

    column.appendChild(list);
    elements.exploreColumns.appendChild(column);
  });
}

function updateExploreHits() {
  if (!state.rightParse.ok || !state.exploreQuery) {
    state.exploreHits = [];
    return;
  }
  state.exploreHits = searchTree(state.rightParse.value, state.exploreQuery, 80);
}

function renderExploreHits() {
  const container = elements.exploreResults;
  container.textContent = "";

  if (!state.exploreQuery) {
    return;
  }

  updateExploreHits();

  if (!state.exploreHits.length) {
    const line = document.createElement("p");
    line.className = "meta-text";
    line.textContent = "No matches.";
    container.appendChild(line);
    return;
  }

  state.exploreHits.forEach((hit) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "search-hit";
    button.textContent = `${formatPath(hit.path)} - ${hit.preview}`;
    button.addEventListener("click", () => {
      state.explorePath = sanitizePath(hit.path, state.rightParse.value);
      state.currentPath = state.explorePath.slice();
      renderExploreSurface();
      renderStatusPath();
    });
    container.appendChild(button);
  });
}

function renderTableSurface() {
  const output = elements.tableOutput;
  output.textContent = "";

  if (!isTableModeAvailable()) {
    output.classList.add("empty-state");
    output.textContent = "Table mode requires a top-level array.";
    return;
  }

  const rows = state.rightParse.value as any[];
  if (!rows.length) {
    output.classList.add("empty-state");
    output.textContent = "Array is empty.";
    return;
  }

  output.classList.remove("empty-state");

  const columns = collectTableColumns(rows);

  const table = document.createElement("table");
  table.className = "json-table";

  const head = document.createElement("thead");
  const headRow = document.createElement("tr");

  const indexHead = document.createElement("th");
  indexHead.className = "json-table-index-head";
  indexHead.textContent = "#";
  headRow.appendChild(indexHead);

  columns.forEach((column) => {
    const cell = document.createElement("th");
    cell.textContent = formatTableColumnLabel(column);
    headRow.appendChild(cell);
  });

  head.appendChild(headRow);
  table.appendChild(head);

  const body = document.createElement("tbody");

  rows.forEach((row, rowIndex) => {
    const rowEl = document.createElement("tr");

    const rowLabel = document.createElement("th");
    rowLabel.className = "json-table-index-cell";
    rowLabel.textContent = String(rowIndex);
    rowEl.appendChild(rowLabel);

    columns.forEach((column) => {
      const cell = document.createElement("td");
      const value = getTableCellValue(row, column);
      const formatted = formatTableCellValue(value);
      cell.textContent = formatted;
      cell.classList.add(getTableCellClass(value));
      if (formatted.length > 120) {
        cell.title = formatted;
      }
      rowEl.appendChild(cell);
    });

    body.appendChild(rowEl);
  });

  table.appendChild(body);
  output.appendChild(table);
}

function collectTableColumns(rows: any[]): string[] {
  const objectKeys = new Set<string>();
  let sawObjectRow = false;

  rows.forEach((row) => {
    if (!isPlainObject(row)) {
      return;
    }
    sawObjectRow = true;
    Object.keys(row).forEach((key) => objectKeys.add(key));
  });

  if (sawObjectRow && objectKeys.size) {
    return Array.from(objectKeys);
  }

  let maxArrayLength = 0;
  rows.forEach((row) => {
    if (Array.isArray(row)) {
      maxArrayLength = Math.max(maxArrayLength, row.length);
    }
  });

  if (maxArrayLength > 0) {
    return Array.from({ length: maxArrayLength }, (_, index) => String(index));
  }

  return ["value"];
}

function formatTableColumnLabel(column: string): string {
  if (column === "value") {
    return "value";
  }
  return /^\d+$/.test(column) ? `[${column}]` : column;
}

function getTableCellValue(row: any, column: string): any {
  if (column === "value") {
    return row;
  }
  if (isPlainObject(row)) {
    return row[column];
  }
  if (Array.isArray(row) && /^\d+$/.test(column)) {
    return row[Number(column)];
  }
  return undefined;
}

function formatTableCellValue(value: any): string {
  if (value === undefined) {
    return "—";
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return truncate(JSON.stringify(value), 160);
  } catch (_error) {
    return truncate(String(value), 160);
  }
}

function getTableCellClass(value: any): string {
  if (value === undefined) {
    return "table-cell-empty";
  }
  if (value === null) {
    return "table-cell-null";
  }
  if (typeof value === "string") {
    return "table-cell-string";
  }
  if (typeof value === "number") {
    return "table-cell-number";
  }
  if (typeof value === "boolean") {
    return "table-cell-boolean";
  }
  if (Array.isArray(value)) {
    return "table-cell-array";
  }
  if (isPlainObject(value)) {
    return "table-cell-object";
  }
  return "table-cell-raw";
}

function recomputeDiff(formatBoth: boolean) {
  state.leftParse = parseJsonWithDiagnostics(state.leftText);
  state.rightParse = parseJsonWithDiagnostics(state.rightText);

  if (!state.leftParse.ok || !state.rightParse.ok) {
    state.diffRows = [];
    state.diffDirtySinceRecompute = false;
    renderAll("programmatic");
    return;
  }

  if (formatBoth) {
    state.leftText = JSON.stringify(state.leftParse.value, null, 2);
    state.rightText = JSON.stringify(state.rightParse.value, null, 2);

    elements.leftInput.value = state.leftText;

    state.leftParse = parseJsonWithDiagnostics(state.leftText);
    state.rightParse = parseJsonWithDiagnostics(state.rightText);
  }

  const leftLines = state.leftText.split("\n");
  const rightLines = state.rightText.split("\n");
  const ops = diffLines(leftLines, rightLines);
  state.diffRows = operationsToUnifiedRows(ops);
  state.diffDirtySinceRecompute = false;

  renderAll("programmatic");
}

function renderDiffSurface() {
  const output = elements.diffOutput;
  output.textContent = "";

  if (!state.leftParse.ok || !state.rightParse.ok) {
    output.classList.remove("empty-state");
    const invalidLines: string[] = [];
    if (state.leftParse.error) {
      invalidLines.push(
        `Left invalid at ${state.leftParse.error.line}:${state.leftParse.error.column} - ${state.leftParse.error.message}`,
      );
    }
    if (state.rightParse.error) {
      invalidLines.push(
        `Right invalid at ${state.rightParse.error.line}:${state.rightParse.error.column} - ${state.rightParse.error.message}`,
      );
    }
    const errorBox = document.createElement("div");
    errorBox.className = "view-error";
    errorBox.textContent = invalidLines.join("\n");
    output.appendChild(errorBox);
    return;
  }

  if (!state.diffRows.length) {
    output.classList.add("empty-state");
    output.textContent = "Recompute diff to view inline changes.";
    return;
  }

  const changed = state.diffRows.filter((row) => row.kind !== "context").length;
  if (changed === 0) {
    output.classList.add("empty-state");
    output.textContent = "No differences found.";
    return;
  }

  output.classList.remove("empty-state");
  const visibleRows = sliceDiffWithContext(state.diffRows, 1);

  const summary = document.createElement("p");
  summary.className = "diff-summary";
  summary.textContent = state.diffDirtySinceRecompute
    ? `${changed} changed lines (outdated, recompute to refresh)`
    : `${changed} changed lines`;
  output.appendChild(summary);

  visibleRows.forEach((row) => {
    if (row.kind === "gap") {
      const gap = document.createElement("div");
      gap.className = "udiff-gap";
      gap.textContent = `... ${row.omitted} unchanged line${row.omitted === 1 ? "" : "s"} hidden ...`;
      output.appendChild(gap);
      return;
    }

    const rowEl = document.createElement("div");
    rowEl.className = `udiff-row ${row.kind === "context" ? "ctx" : row.kind}`;

    const leftNo = document.createElement("span");
    leftNo.className = "udiff-ln";
    leftNo.textContent = row.leftNo === null ? "" : String(row.leftNo);

    const rightNo = document.createElement("span");
    rightNo.className = "udiff-ln";
    rightNo.textContent = row.rightNo === null ? "" : String(row.rightNo);

    const text = document.createElement("span");
    text.className = "udiff-txt";
    const sign = row.kind === "add" ? "+" : row.kind === "del" ? "-" : " ";
    text.textContent = `${sign}${row.text}`;

    rowEl.append(leftNo, rightNo, text);
    output.appendChild(rowEl);
  });
}

function renderRightViewError(message: string) {
  elements.rightViewError.classList.remove("hidden");
  elements.rightViewError.textContent = message;
}

function renderStatusPath() {
  const pathText = formatPath(state.currentPath);
  elements.statusPath.textContent = `path: ${pathText}`;
  elements.pathHudLabel.textContent = state.hudLabel;
  elements.pathHudPath.textContent = pathText;
  elements.pathHud.classList.remove("left", "right", "center");
  elements.pathHud.classList.add(state.hudAnchor);
}

function sanitizePathState() {
  if (!state.rightParse.ok) {
    state.explorePath = [];
    state.currentPath = [];
    return;
  }

  state.explorePath = sanitizePath(state.explorePath, state.rightParse.value);
  state.currentPath = sanitizePath(state.currentPath, state.rightParse.value);
}

function parseJsonWithDiagnostics(text: string): ParseResult {
  if (!text.trim()) {
    return emptyParse();
  }

  try {
    const value = JSON.parse(text);
    return { empty: false, ok: true, value, error: null };
  } catch (rawError) {
    const message = String(rawError instanceof Error ? rawError.message : "Invalid JSON");
    const position = extractPositionFromMessage(text, message);
    const location = toLineColumn(text, position);
    const suggestion = suggestFix(text, position, message);
    const context = buildErrorContext(text, location.line, location.column);

    return {
      empty: false,
      ok: false,
      value: null,
      error: {
        message: normalizeParserMessage(message),
        position,
        line: location.line,
        column: location.column,
        suggestion,
        lineText: context.lineText,
        caretLine: context.caretLine,
      },
    };
  }
}

function extractPositionFromMessage(text: string, message: string): number {
  const positionMatch = message.match(/position\s+(\d+)/i);
  if (positionMatch) {
    return clamp(Number(positionMatch[1]), 0, Math.max(0, text.length - 1));
  }

  const lineColMatch = message.match(/line\s+(\d+)\s+column\s+(\d+)/i);
  if (lineColMatch) {
    return toOffset(text, Number(lineColMatch[1]), Number(lineColMatch[2]));
  }

  return Math.max(0, text.length - 1);
}

function normalizeParserMessage(message: string): string {
  return message.replace(/\s+in\s+JSON\s+at\s+position\s+\d+/i, "");
}

function toLineColumn(text: string, position: number) {
  const lines = text.split(/\r?\n/);
  let consumed = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const len = lines[index].length;
    if (position <= consumed + len) {
      return { line: index + 1, column: position - consumed + 1 };
    }
    consumed += len + 1;
  }

  const fallback = lines.length || 1;
  return {
    line: fallback,
    column: (lines[fallback - 1] || "").length + 1,
  };
}

function toOffset(text: string, line: number, column: number): number {
  const lines = text.split(/\r?\n/);
  let offset = 0;

  for (let i = 0; i < line - 1 && i < lines.length; i += 1) {
    offset += lines[i].length + 1;
  }

  return clamp(offset + Math.max(0, column - 1), 0, Math.max(0, text.length - 1));
}

function suggestFix(text: string, position: number, message: string): string {
  const around = text.slice(Math.max(0, position - 40), Math.min(text.length, position + 40));

  if (/\,\s*[}\]]/.test(around) || /Unexpected token [}\]]/.test(message)) {
    return "Check for a trailing comma before a closing brace or bracket.";
  }
  if (/'[^']*'\s*:|:\s*'[^']*'/.test(around) || /Unexpected token '/.test(message)) {
    return "Use double quotes for keys and string values.";
  }
  if (/[{,]\s*[A-Za-z_$][\w$-]*\s*:/.test(around)) {
    return "Wrap object keys in double quotes.";
  }
  if (/\/\*|\/\//.test(around)) {
    return "Remove comments. JSON does not allow comments.";
  }
  if (/Unexpected end of JSON input/i.test(message)) {
    return "The document looks truncated. Check missing closing braces or brackets.";
  }
  if (/"\s*"/.test(around) || /\d\s*"/.test(around) || /true\s*"/.test(around)) {
    return "You may be missing a comma between values.";
  }

  return "Inspect this position for missing commas, quotes, or invalid characters.";
}

function buildErrorContext(text: string, line: number, column: number) {
  const lines = text.split(/\r?\n/);
  const lineText = lines[Math.max(0, line - 1)] || "";
  const caretLine = `${" ".repeat(Math.max(0, column - 1))}^`;
  return { lineText, caretLine };
}

function computeTypeStats(root: any) {
  const stats = {
    keys: 0,
    objects: 0,
    arrays: 0,
    nulls: 0,
  };

  walk(root, true);
  return stats;

  function walk(value: any, isRoot: boolean) {
    if (value === null) {
      stats.nulls += 1;
      return;
    }

    if (Array.isArray(value)) {
      stats.arrays += 1;
      value.forEach((item) => walk(item, false));
      return;
    }

    if (typeof value === "object") {
      if (!isRoot) {
        stats.objects += 1;
      }
      const keys = Object.keys(value);
      stats.keys += keys.length;
      keys.forEach((key) => walk(value[key], false));
    }
  }
}

function diffLines(left: string[], right: string[]): DiffOp[] {
  const n = left.length;
  const m = right.length;

  if (n * m > 3000000) {
    return quickDiff(left, right);
  }

  const table = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      if (left[i] === right[j]) {
        table[i][j] = table[i + 1][j + 1] + 1;
      } else {
        table[i][j] = Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;

  while (i < n && j < m) {
    if (left[i] === right[j]) {
      ops.push({ type: "equal", left: left[i], right: right[j] });
      i += 1;
      j += 1;
      continue;
    }

    if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ type: "del", left: left[i] });
      i += 1;
    } else {
      ops.push({ type: "add", right: right[j] });
      j += 1;
    }
  }

  while (i < n) {
    ops.push({ type: "del", left: left[i] });
    i += 1;
  }

  while (j < m) {
    ops.push({ type: "add", right: right[j] });
    j += 1;
  }

  return ops;
}

function quickDiff(left: string[], right: string[]): DiffOp[] {
  const ops: DiffOp[] = [];
  const max = Math.max(left.length, right.length);

  for (let i = 0; i < max; i += 1) {
    const l = left[i];
    const r = right[i];

    if (l === r && l !== undefined) {
      ops.push({ type: "equal", left: l, right: r });
      continue;
    }

    if (l !== undefined) {
      ops.push({ type: "del", left: l });
    }

    if (r !== undefined) {
      ops.push({ type: "add", right: r });
    }
  }

  return ops;
}

function operationsToUnifiedRows(ops: DiffOp[]): UnifiedDiffRow[] {
  const rows: UnifiedDiffRow[] = [];
  let leftNo = 1;
  let rightNo = 1;

  ops.forEach((op) => {
    if (op.type === "equal") {
      rows.push({ kind: "context", leftNo, rightNo, text: op.left });
      leftNo += 1;
      rightNo += 1;
      return;
    }

    if (op.type === "del") {
      rows.push({ kind: "del", leftNo, rightNo: null, text: op.left });
      leftNo += 1;
      return;
    }

    rows.push({ kind: "add", leftNo: null, rightNo, text: op.right });
    rightNo += 1;
  });

  return rows;
}

function sliceDiffWithContext(rows: UnifiedDiffRow[], contextLines: number): VisibleDiffRow[] {
  const changedIndexes: number[] = [];
  rows.forEach((row, index) => {
    if (row.kind !== "context") {
      changedIndexes.push(index);
    }
  });

  if (!changedIndexes.length) {
    return [];
  }

  const keep = new Array(rows.length).fill(false);
  changedIndexes.forEach((index) => {
    const start = Math.max(0, index - contextLines);
    const end = Math.min(rows.length - 1, index + contextLines);
    for (let i = start; i <= end; i += 1) {
      keep[i] = true;
    }
  });

  const visible: VisibleDiffRow[] = [];
  let cursor = 0;

  while (cursor < rows.length) {
    if (keep[cursor]) {
      visible.push(rows[cursor]);
      cursor += 1;
      continue;
    }

    const start = cursor;
    while (cursor < rows.length && !keep[cursor]) {
      cursor += 1;
    }
    const omitted = cursor - start;
    if (omitted > 0) {
      visible.push({ kind: "gap", omitted });
    }
  }

  return visible;
}

function getEntries(value: any): Array<[PathSegment, any]> {
  if (Array.isArray(value)) {
    return value.map((item, index) => [index, item]);
  }
  return Object.entries(value) as Array<[PathSegment, any]>;
}

function sanitizePath(path: PathSegment[], root: any): PathSegment[] {
  const clean: PathSegment[] = [];
  let cursor = root;

  for (let i = 0; i < path.length; i += 1) {
    const segment = path[i];
    if (!isContainer(cursor) || !hasChild(cursor, segment)) {
      break;
    }
    clean.push(segment);
    cursor = cursor[segment as keyof typeof cursor];
  }

  return clean;
}

function hasChild(container: any, key: PathSegment): boolean {
  if (Array.isArray(container)) {
    return typeof key === "number" && Number.isInteger(key) && key >= 0 && key < container.length;
  }
  return Object.prototype.hasOwnProperty.call(container, key);
}

function isContainer(value: any): boolean {
  return Array.isArray(value) || isPlainObject(value);
}

function isPlainObject(value: any): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function valueType(value: any): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

function entryMeta(value: any): string {
  if (Array.isArray(value)) {
    return `array (${value.length})`;
  }
  if (isPlainObject(value)) {
    return `object (${Object.keys(value).length})`;
  }
  return `${valueType(value)} ${truncate(String(value), 22)}`;
}

function matchesQuery(key: PathSegment, value: any, query: string): boolean {
  if (!query) {
    return false;
  }
  const lower = query.toLowerCase();
  if (String(key).toLowerCase().includes(lower)) {
    return true;
  }
  if (isContainer(value)) {
    return false;
  }
  return String(value).toLowerCase().includes(lower);
}

function searchTree(root: any, query: string, maxResults: number) {
  const lower = query.toLowerCase();
  const hits: Array<{ path: PathSegment[]; preview: string }> = [];

  walk(root, []);
  return hits;

  function walk(value: any, path: PathSegment[]) {
    if (hits.length >= maxResults) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, path.concat(index)));
      return;
    }

    if (isPlainObject(value)) {
      Object.keys(value).forEach((key) => {
        const nextPath = path.concat(key);
        if (key.toLowerCase().includes(lower) && hits.length < maxResults) {
          hits.push({ path: nextPath, preview: `key "${key}"` });
        }
        walk(value[key], nextPath);
      });
      return;
    }

    const text = String(value);
    if (text.toLowerCase().includes(lower) && hits.length < maxResults) {
      hits.push({ path, preview: `${valueType(value)} ${truncate(text, 26)}` });
    }
  }
}

function formatPath(path: PathSegment[]): string {
  if (!path.length) {
    return "root";
  }
  return `root > ${path.map((segment) => String(segment)).join(" > ")}`;
}

function toDotPath(path: PathSegment[]): string {
  let output = "root";
  path.forEach((segment) => {
    if (typeof segment === "number") {
      output += `[${segment}]`;
    } else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)) {
      output += `.${segment}`;
    } else {
      output += `[${JSON.stringify(segment)}]`;
    }
  });
  return output;
}

function toJsonPath(path: PathSegment[]): string {
  let output = "$";
  path.forEach((segment) => {
    if (typeof segment === "number") {
      output += `[${segment}]`;
    } else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)) {
      output += `.${segment}`;
    } else {
      output += `[${JSON.stringify(segment)}]`;
    }
  });
  return output;
}

async function copyPathText(path: PathSegment[]) {
  const dot = toDotPath(path);
  const jsonPath = toJsonPath(path);
  return copyText(`${dot}\n${jsonPath}`);
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_error) {
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.focus();
    helper.select();

    let success = false;
    try {
      success = document.execCommand("copy");
    } catch (_ignored) {
      success = false;
    }

    document.body.removeChild(helper);
    return success;
  }
}

function showToast(message: string) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("show");
  }, 1300);
}

function truncate(value: string, length: number): string {
  if (value.length <= length) {
    return value;
  }
  return `${value.slice(0, Math.max(0, length - 1))}...`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
