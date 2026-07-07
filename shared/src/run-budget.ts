/**
 * Derive the per-source per-term job cap from a run budget. Shared by the Run
 * modal (live preview) and the pipeline route (server-side resolution when a
 * Profile owns the budget). Provider instances are not part of the divisor —
 * the budget is spread across `termCount × sourceCount` built-in extractor
 * platforms, mirroring the client's original derivation.
 */
export function deriveMaxJobsPerTerm(args: {
  budget: number;
  termCount: number;
  sourceCount: number;
}): number {
  const budget = Math.max(1, Math.round(args.budget));
  const termCount = Math.max(1, args.termCount);
  const sourceCount = Math.max(1, args.sourceCount);
  return Math.max(1, Math.floor(budget / (termCount * sourceCount)));
}
