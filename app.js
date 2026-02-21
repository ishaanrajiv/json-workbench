function byId(id) {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Missing required element: #${id}`);
    }
    return element;
}
function emptyParse() {
    return { empty: true, ok: false, value: null, error: null };
}
const state = {
    mode: "json",
    leftText: "",
    rightText: "",
    rightLocked: true,
    rightDirty: false,
    leftLayout: null,
    rightLayout: null,
    leftParse: emptyParse(),
    rightParse: emptyParse(),
    lastHighlighted: {
        left: null,
        right: null,
    },
    errorLineFocus: {
        left: null,
        right: null,
    },
    jsonFoldCollapsed: new Set(),
    jsonFoldMarkers: [],
    explorePath: [],
    currentPath: [],
    exploreQuery: "",
    exploreHits: [],
    diffRows: [],
    diffDirtySinceRecompute: false,
};
let charMeasureCanvas = null;
const monoCharWidthCache = new Map();
const elements = {
    loadSampleBtn: byId("load-sample-btn"),
    resyncBtn: byId("resync-btn"),
    leftInput: byId("left-input"),
    leftLines: byId("left-lines"),
    leftOverlay: byId("left-overlay"),
    leftStatus: byId("left-status"),
    leftStats: byId("left-stats"),
    rightEditorShell: byId("right-editor-shell"),
    rightContent: byId("right-content"),
    rightHighlight: byId("right-highlight"),
    rightInput: byId("right-input"),
    rightLines: byId("right-lines"),
    rightFoldGutter: byId("right-fold-gutter"),
    rightOverlay: byId("right-overlay"),
    rightStatus: byId("right-status"),
    copyRightBtn: byId("copy-right-btn"),
    modeButtons: Array.from(document.querySelectorAll(".mode-btn")),
    exploreView: byId("explore-view"),
    exploreSearch: byId("explore-search"),
    clearExploreSearch: byId("clear-explore-search"),
    exploreBreadcrumb: byId("explore-breadcrumb"),
    exploreResults: byId("explore-results"),
    exploreColumns: byId("explore-columns"),
    diffView: byId("diff-view"),
    recomputeDiffBtn: byId("recompute-diff-btn"),
    autoRecomputeToggle: byId("auto-recompute-toggle"),
    diffOutput: byId("diff-output"),
    rightViewError: byId("right-view-error"),
    statusBar: byId("status-bar"),
    statusPath: byId("status-path"),
    copyPathBtn: byId("copy-path-btn"),
    toast: byId("toast"),
};
let toastTimer;
let leftPastePending = false;
let rightPastePending = false;
boot();
function boot() {
    bindEvents();
    refreshFromLeft("programmatic");
}
function bindEvents() {
    elements.loadSampleBtn.addEventListener("click", () => {
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
        showToast("Sample loaded on left.");
    });
    elements.resyncBtn.addEventListener("click", () => {
        if (state.rightLocked || !state.leftParse.ok) {
            return;
        }
        state.rightDirty = false;
        syncRightFromLeftForMode();
        renderAll("programmatic");
        if (state.mode === "diff") {
            recomputeDiff(true);
        }
        showToast("Right synced from left.");
    });
    elements.leftInput.addEventListener("paste", () => {
        leftPastePending = true;
    });
    elements.leftInput.addEventListener("input", () => {
        const source = leftPastePending ? "paste" : "input";
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
    elements.rightInput.addEventListener("input", () => {
        if (state.rightLocked) {
            return;
        }
        const source = rightPastePending ? "paste" : "input";
        rightPastePending = false;
        state.rightDirty = true;
        state.rightText = elements.rightInput.value;
        state.rightParse = parseJsonWithDiagnostics(state.rightText);
        sanitizePathState();
        if (state.mode === "diff") {
            if (elements.autoRecomputeToggle.checked) {
                recomputeDiff(false);
            }
            else {
                state.diffDirtySinceRecompute = true;
            }
        }
        renderAll(source);
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
    elements.copyRightBtn.addEventListener("click", async () => {
        if (!state.rightText.trim()) {
            return;
        }
        const ok = await copyText(state.rightText);
        showToast(ok ? "Right JSON copied." : "Clipboard write failed.");
    });
    elements.modeButtons.forEach((button) => {
        button.addEventListener("click", () => {
            const mode = button.dataset.mode;
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
    elements.clearExploreSearch.addEventListener("click", () => {
        state.exploreQuery = "";
        elements.exploreSearch.value = "";
        updateExploreHits();
        if (state.mode === "explore") {
            renderExploreSurface();
        }
    });
    elements.copyPathBtn.addEventListener("click", async () => {
        const ok = await copyPathText(state.currentPath);
        showToast(ok ? "Path copied." : "Clipboard write failed.");
    });
    window.addEventListener("resize", () => {
        renderEditorLineNumbers();
        syncRightHighlightScroll();
        if (state.mode === "json" && !state.rightLocked && state.rightParse.ok) {
            paintFoldGutter();
        }
    });
}
function refreshFromLeft(source) {
    state.leftParse = parseJsonWithDiagnostics(state.leftText);
    if (state.leftText.trim()) {
        unlockRight();
    }
    else {
        lockRight();
    }
    if (!state.rightLocked) {
        if (state.leftParse.ok && !state.rightDirty) {
            syncRightFromLeftForMode();
        }
        else {
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
        }
        else {
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
}
function setMode(mode) {
    if (state.mode === mode) {
        return;
    }
    state.mode = mode;
    if (!state.rightLocked && state.leftParse.ok && !state.rightDirty) {
        syncRightFromLeftForMode();
    }
    renderAll("programmatic");
    if (mode === "diff") {
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
function renderAll(source) {
    renderLeftPanel(source);
    renderRightPanel(source);
    renderModePanels();
    renderEditorLineNumbers();
    renderStatusPath();
}
function renderLeftPanel(source) {
    renderStatePill(elements.leftStatus, state.leftParse, false);
    if (state.leftParse.ok) {
        const stats = computeTypeStats(state.leftParse.value);
        elements.leftStats.textContent = `${stats.keys} keys, ${stats.objects} objects, ${stats.arrays} arrays, ${stats.nulls} null.`;
    }
    else if (state.leftParse.empty) {
        elements.leftStats.textContent = "Left is source. Right unlocks after first paste.";
    }
    else {
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
function renderRightPanel(source) {
    renderStatePill(elements.rightStatus, state.rightParse, state.rightLocked);
    const editorVisible = state.mode !== "explore";
    const showOverlay = editorVisible &&
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
    }
    else {
        elements.rightOverlay.classList.add("hidden");
        elements.rightInput.classList.remove("has-error", "error-focus");
    }
    elements.copyRightBtn.disabled = state.rightLocked || !state.rightText.trim().length;
    elements.resyncBtn.disabled = state.rightLocked || !state.leftParse.ok;
}
function renderStatePill(target, parse, locked) {
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
function renderErrorOverlay(config) {
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
function jumpToError(side, focus) {
    const parse = side === "left" ? state.leftParse : state.rightParse;
    const textarea = side === "left" ? elements.leftInput : elements.rightInput;
    if (!parse.error) {
        return;
    }
    state.errorLineFocus[side] = parse.error.line;
    highlightError(textarea, parse.error.position, focus);
    renderEditorLineNumbers();
}
function highlightError(textarea, position, focus) {
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
    elements.modeButtons.forEach((button) => {
        button.classList.toggle("active", button.dataset.mode === state.mode);
    });
    elements.rightEditorShell.classList.toggle("hidden", state.mode === "explore");
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
function renderRightSyntaxHighlight(text) {
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
function buildJsonSyntaxHtml(text) {
    const parts = [];
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
        if (text.startsWith("true", index) &&
            isWordBoundary(text[index - 1]) &&
            isWordBoundary(text[index + 4])) {
            parts.push(wrapJsonToken("true", "tok-boolean"));
            index += 4;
            continue;
        }
        if (text.startsWith("false", index) &&
            isWordBoundary(text[index - 1]) &&
            isWordBoundary(text[index + 5])) {
            parts.push(wrapJsonToken("false", "tok-boolean"));
            index += 5;
            continue;
        }
        if (text.startsWith("null", index) &&
            isWordBoundary(text[index - 1]) &&
            isWordBoundary(text[index + 4])) {
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
function readJsonStringEnd(text, start) {
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
function isWordBoundary(char) {
    if (!char) {
        return true;
    }
    return /[\s\[\]{}:,]/.test(char);
}
function wrapJsonToken(token, className) {
    return `<span class="syntax-token ${className}">${escapeHtml(token)}</span>`;
}
function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
function renderFoldedJsonText(root, collapsed) {
    const lines = [];
    const markers = [];
    renderNode(root, 0, [], null, true);
    return { text: lines.join("\n"), markers };
    function renderNode(value, depth, path, key, isLast) {
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
function toggleFold(pathKey) {
    if (state.jsonFoldCollapsed.has(pathKey)) {
        state.jsonFoldCollapsed.delete(pathKey);
    }
    else {
        state.jsonFoldCollapsed.add(pathKey);
    }
    updateRightEditorDisplay();
    renderEditorLineNumbers();
}
function renderEditorLineNumbers() {
    state.leftLayout = renderLineNumbersFor(elements.leftInput, elements.leftLines, state.errorLineFocus.left);
    if (state.rightLocked) {
        elements.rightLines.textContent = "";
        elements.rightLines.style.transform = "translateY(0px)";
        state.rightLayout = null;
        return;
    }
    state.rightLayout = renderLineNumbersFor(elements.rightInput, elements.rightLines, state.errorLineFocus.right);
    if (state.mode === "json" && state.rightParse.ok) {
        paintFoldGutter();
    }
}
function renderLineNumbersFor(textarea, linesContainer, errorLine) {
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
function syncLineNumbers(textarea, linesContainer) {
    linesContainer.style.transform = `translateY(${-textarea.scrollTop}px)`;
}
function getEditorLineHeight(textarea) {
    const computed = window.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(computed.lineHeight);
    return Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : 20;
}
function computeTextLayoutMetrics(textarea) {
    const lineHeight = getEditorLineHeight(textarea);
    const wrapColumns = computeWrapColumns(textarea);
    const lines = textarea.value.split(/\r?\n/);
    const lineCount = Math.max(1, lines.length);
    const lineTops = [];
    const lineHeights = [];
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
function computeWrapColumns(textarea) {
    const computed = window.getComputedStyle(textarea);
    const paddingLeft = Number.parseFloat(computed.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(computed.paddingRight) || 0;
    const contentWidth = Math.max(1, textarea.clientWidth - paddingLeft - paddingRight);
    const charWidth = getMonoCharWidth(computed);
    return Math.max(1, Math.floor(contentWidth / charWidth));
}
function getMonoCharWidth(computed) {
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
function estimateWrappedRows(text, wrapColumns) {
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
        renderRightViewError(`Right invalid at ${state.rightParse.error?.line}:${state.rightParse.error?.column}. ${state.rightParse.error?.message ?? ""}`);
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
    const columns = [{
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
        node = node[selected];
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
function recomputeDiff(formatBoth) {
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
        const invalidLines = [];
        if (state.leftParse.error) {
            invalidLines.push(`Left invalid at ${state.leftParse.error.line}:${state.leftParse.error.column} - ${state.leftParse.error.message}`);
        }
        if (state.rightParse.error) {
            invalidLines.push(`Right invalid at ${state.rightParse.error.line}:${state.rightParse.error.column} - ${state.rightParse.error.message}`);
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
function renderRightViewError(message) {
    elements.rightViewError.classList.remove("hidden");
    elements.rightViewError.textContent = message;
}
function renderStatusPath() {
    elements.statusPath.textContent = `path: ${formatPath(state.currentPath)}`;
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
function parseJsonWithDiagnostics(text) {
    if (!text.trim()) {
        return emptyParse();
    }
    try {
        const value = JSON.parse(text);
        return { empty: false, ok: true, value, error: null };
    }
    catch (rawError) {
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
function extractPositionFromMessage(text, message) {
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
function normalizeParserMessage(message) {
    return message.replace(/\s+in\s+JSON\s+at\s+position\s+\d+/i, "");
}
function toLineColumn(text, position) {
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
function toOffset(text, line, column) {
    const lines = text.split(/\r?\n/);
    let offset = 0;
    for (let i = 0; i < line - 1 && i < lines.length; i += 1) {
        offset += lines[i].length + 1;
    }
    return clamp(offset + Math.max(0, column - 1), 0, Math.max(0, text.length - 1));
}
function suggestFix(text, position, message) {
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
function buildErrorContext(text, line, column) {
    const lines = text.split(/\r?\n/);
    const lineText = lines[Math.max(0, line - 1)] || "";
    const caretLine = `${" ".repeat(Math.max(0, column - 1))}^`;
    return { lineText, caretLine };
}
function computeTypeStats(root) {
    const stats = {
        keys: 0,
        objects: 0,
        arrays: 0,
        nulls: 0,
    };
    walk(root, true);
    return stats;
    function walk(value, isRoot) {
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
function diffLines(left, right) {
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
            }
            else {
                table[i][j] = Math.max(table[i + 1][j], table[i][j + 1]);
            }
        }
    }
    const ops = [];
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
        }
        else {
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
function quickDiff(left, right) {
    const ops = [];
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
function operationsToUnifiedRows(ops) {
    const rows = [];
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
function sliceDiffWithContext(rows, contextLines) {
    const changedIndexes = [];
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
    const visible = [];
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
function getEntries(value) {
    if (Array.isArray(value)) {
        return value.map((item, index) => [index, item]);
    }
    return Object.entries(value);
}
function sanitizePath(path, root) {
    const clean = [];
    let cursor = root;
    for (let i = 0; i < path.length; i += 1) {
        const segment = path[i];
        if (!isContainer(cursor) || !hasChild(cursor, segment)) {
            break;
        }
        clean.push(segment);
        cursor = cursor[segment];
    }
    return clean;
}
function hasChild(container, key) {
    if (Array.isArray(container)) {
        return typeof key === "number" && Number.isInteger(key) && key >= 0 && key < container.length;
    }
    return Object.prototype.hasOwnProperty.call(container, key);
}
function isContainer(value) {
    return Array.isArray(value) || isPlainObject(value);
}
function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function valueType(value) {
    if (value === null) {
        return "null";
    }
    if (Array.isArray(value)) {
        return "array";
    }
    return typeof value;
}
function entryMeta(value) {
    if (Array.isArray(value)) {
        return `array (${value.length})`;
    }
    if (isPlainObject(value)) {
        return `object (${Object.keys(value).length})`;
    }
    return `${valueType(value)} ${truncate(String(value), 22)}`;
}
function matchesQuery(key, value, query) {
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
function searchTree(root, query, maxResults) {
    const lower = query.toLowerCase();
    const hits = [];
    walk(root, []);
    return hits;
    function walk(value, path) {
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
function formatPath(path) {
    if (!path.length) {
        return "root";
    }
    return `root > ${path.map((segment) => String(segment)).join(" > ")}`;
}
function toDotPath(path) {
    let output = "root";
    path.forEach((segment) => {
        if (typeof segment === "number") {
            output += `[${segment}]`;
        }
        else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)) {
            output += `.${segment}`;
        }
        else {
            output += `[${JSON.stringify(segment)}]`;
        }
    });
    return output;
}
function toJsonPath(path) {
    let output = "$";
    path.forEach((segment) => {
        if (typeof segment === "number") {
            output += `[${segment}]`;
        }
        else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)) {
            output += `.${segment}`;
        }
        else {
            output += `[${JSON.stringify(segment)}]`;
        }
    });
    return output;
}
async function copyPathText(path) {
    const dot = toDotPath(path);
    const jsonPath = toJsonPath(path);
    return copyText(`${dot}\n${jsonPath}`);
}
async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    }
    catch (_error) {
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
        }
        catch (_ignored) {
            success = false;
        }
        document.body.removeChild(helper);
        return success;
    }
}
function showToast(message) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("show");
    toastTimer = window.setTimeout(() => {
        elements.toast.classList.remove("show");
    }, 1300);
}
function truncate(value, length) {
    if (value.length <= length) {
        return value;
    }
    return `${value.slice(0, Math.max(0, length - 1))}...`;
}
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
