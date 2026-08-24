'use strict';

// Line-based diff (common prefix/suffix trim + LCS DP with size cap).
// Returns [{ t: 'ctx'|'add'|'del', a: oldLineNo|null, b: newLineNo|null, s: text }]

const MAX_CELLS = 4_000_000;

function diffLines(a, b) {
  let start = 0;
  const minLen = Math.min(a.length, b.length);
  while (start < minLen && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

  const out = [];
  for (let i = 0; i < start; i++) out.push({ t: 'ctx', a: i + 1, b: i + 1, s: a[i] });

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length, m = midB.length;

  if (n === 0) {
    for (let j = 0; j < m; j++) out.push({ t: 'add', a: null, b: start + j + 1, s: midB[j] });
  } else if (m === 0) {
    for (let i = 0; i < n; i++) out.push({ t: 'del', a: start + i + 1, b: null, s: midA[i] });
  } else if (n * m > MAX_CELLS) {
    // Too large for DP — emit as a full block replace.
    for (let i = 0; i < n; i++) out.push({ t: 'del', a: start + i + 1, b: null, s: midA[i] });
    for (let j = 0; j < m; j++) out.push({ t: 'add', a: null, b: start + j + 1, s: midB[j] });
  } else {
    const w = m + 1;
    const dp = new Int32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] = midA[i] === midB[j]
          ? dp[(i + 1) * w + j + 1] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
      }
    }
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        out.push({ t: 'ctx', a: start + i + 1, b: start + j + 1, s: midA[i] });
        i++; j++;
      } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
        out.push({ t: 'del', a: start + i + 1, b: null, s: midA[i] });
        i++;
      } else {
        out.push({ t: 'add', a: null, b: start + j + 1, s: midB[j] });
        j++;
      }
    }
    while (i < n) { out.push({ t: 'del', a: start + i + 1, b: null, s: midA[i] }); i++; }
    while (j < m) { out.push({ t: 'add', a: null, b: start + j + 1, s: midB[j] }); j++; }
  }

  for (let k = 0; k < a.length - endA; k++) {
    out.push({ t: 'ctx', a: endA + k + 1, b: endB + k + 1, s: a[endA + k] });
  }
  return out;
}

function diffStats(rows) {
  let add = 0, del = 0;
  for (const r of rows) {
    if (r.t === 'add') add++;
    else if (r.t === 'del') del++;
  }
  return { add, del };
}

module.exports = { diffLines, diffStats };
