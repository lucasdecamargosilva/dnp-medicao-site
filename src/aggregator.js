function percentile(sortedNums, p) {
  const idx = (sortedNums.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedNums[lo];
  const frac = idx - lo;
  return sortedNums[lo] * (1 - frac) + sortedNums[hi] * frac;
}

function summarize(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  const value = percentile(sorted, 0.5);
  const margin = (percentile(sorted, 0.9) - percentile(sorted, 0.1)) / 2;
  return {
    value: Math.round(value * 10) / 10,
    margin: Math.round(margin * 10) / 10,
  };
}

export function aggregate(samples) {
  if (!samples || samples.length === 0) {
    throw new Error('aggregate: lista de amostras vazia');
  }
  return {
    left: summarize(samples.map((s) => s.left)),
    right: summarize(samples.map((s) => s.right)),
    total: summarize(samples.map((s) => s.total)),
  };
}
