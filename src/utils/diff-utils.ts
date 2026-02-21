import type { DiffOp, UnifiedDiffRow, VisibleDiffRow } from "../types.js";

export function diffLines(left: string[], right: string[]): DiffOp[] {
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

export function operationsToUnifiedRows(ops: DiffOp[]): UnifiedDiffRow[] {
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

export function sliceDiffWithContext(rows: UnifiedDiffRow[], contextLines: number): VisibleDiffRow[] {
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
