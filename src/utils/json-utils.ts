import type { ParseResult } from "../types.js";

export function emptyParse(): ParseResult {
  return { empty: true, ok: false, value: null, error: null };
}

export function parseJsonWithDiagnostics(text: string): ParseResult {
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

export function computeTypeStats(root: any) {
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
