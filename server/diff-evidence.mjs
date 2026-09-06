const MAX_EXACT_MIDDLE_LINES = 8_000;
const MAX_MYERS_WORK = 2_000_000;

function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value == null) return Buffer.alloc(0);
  return Buffer.from(value);
}

function decodeUtf8(buffer) {
  const value = toBuffer(buffer);
  if (value.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    return null;
  }
}

function splitLines(text) {
  if (!text) return [];
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function trimEqualEdges(before, after) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;

  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  return {
    before: before.slice(start, beforeEnd),
    after: after.slice(start, afterEnd),
  };
}

function myersDistance(before, after) {
  const n = before.length;
  const m = after.length;
  const max = n + m;
  if (max === 0) return 0;

  const offset = max + 1;
  const frontier = new Int32Array((max * 2) + 3);
  frontier.fill(-1);
  frontier[offset + 1] = 0;
  let work = 0;

  for (let d = 0; d <= max; d += 1) {
    for (let k = -d; k <= d; k += 2) {
      work += 1;
      if (work > MAX_MYERS_WORK) return null;

      const index = offset + k;
      let x;
      if (k === -d || (k !== d && frontier[index - 1] < frontier[index + 1])) {
        x = frontier[index + 1];
      } else {
        x = frontier[index - 1] + 1;
      }

      let y = x - k;
      while (x < n && y < m && before[x] === after[y]) {
        x += 1;
        y += 1;
        work += 1;
        if (work > MAX_MYERS_WORK) return null;
      }
      frontier[index] = x;
      if (x >= n && y >= m) return d;
    }
  }
  return null;
}

function replacementEstimate(beforeLines, afterLines) {
  return {
    additions: afterLines.length,
    deletions: beforeLines.length,
    diffExact: false,
    diffKind: "bounded-replacement",
  };
}

export function createDiffEvidence({
  beforeContent,
  afterContent,
  beforeExists = true,
  afterExists = true,
} = {}) {
  const beforeBuffer = beforeExists ? toBuffer(beforeContent) : Buffer.alloc(0);
  const afterBuffer = afterExists ? toBuffer(afterContent) : Buffer.alloc(0);
  const changed = beforeExists !== afterExists || !beforeBuffer.equals(afterBuffer);

  const beforeText = decodeUtf8(beforeBuffer);
  const afterText = decodeUtf8(afterBuffer);
  if (beforeText == null || afterText == null) {
    return {
      changed,
      additions: null,
      deletions: null,
      diffExact: false,
      diffKind: "non-text",
    };
  }

  const beforeLines = splitLines(beforeText);
  const afterLines = splitLines(afterText);

  if (!changed) {
    return { changed: false, additions: 0, deletions: 0, diffExact: true, diffKind: "unchanged" };
  }
  if (!beforeExists) {
    return { changed: true, additions: afterLines.length, deletions: 0, diffExact: true, diffKind: "created" };
  }
  if (!afterExists) {
    return { changed: true, additions: 0, deletions: beforeLines.length, diffExact: true, diffKind: "deleted" };
  }

  const middle = trimEqualEdges(beforeLines, afterLines);
  const n = middle.before.length;
  const m = middle.after.length;
  if (n === 0) return { changed: true, additions: m, deletions: 0, diffExact: true, diffKind: "line-exact" };
  if (m === 0) return { changed: true, additions: 0, deletions: n, diffExact: true, diffKind: "line-exact" };

  if (n + m > MAX_EXACT_MIDDLE_LINES) return { changed: true, ...replacementEstimate(middle.before, middle.after) };

  const distance = myersDistance(middle.before, middle.after);
  if (distance == null) return { changed: true, ...replacementEstimate(middle.before, middle.after) };

  const deletions = (distance + n - m) / 2;
  const additions = distance - deletions;
  if (!Number.isInteger(additions) || !Number.isInteger(deletions) || additions < 0 || deletions < 0) {
    return { changed: true, ...replacementEstimate(middle.before, middle.after) };
  }

  return {
    changed: true,
    additions,
    deletions,
    diffExact: true,
    diffKind: "line-exact",
  };
}
