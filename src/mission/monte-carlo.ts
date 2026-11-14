// Gen Worlds © 2026 Echo Yin. PolyForm Noncommercial 1.0.0: see LICENSE.md.
/**
 * Runs the same design against many seeds: how often it succeeds, what score to expect and what
 * usually goes wrong. Heavy enough (hundreds of full missions) to belong in a worker.
 */
import { hashCombine } from '@/core/random';
import type { MissionDesign } from '@/mission/design';
import { simulateMission } from '@/mission/simulate-mission';

export interface MonteCarloSummary {
  runs: number;
  /** Shares of the runs by outcome; they sum to 1. */
  successShare: number;
  partialShare: number;
  failureShare: number;
  /** Share of runs lost before reaching the surface. */
  lostShare: number;
  /** Share of runs in which the vehicle was still working at the end. */
  survivedShare: number;
  scoreMean: number;
  /** 10th, 50th and 90th percentile scores. */
  scoreP10: number;
  scoreP50: number;
  scoreP90: number;
  /** Every run's score, ascending, for a histogram. */
  scores: number[];
  /** The most frequent things that went wrong, with the share of runs they appeared in. */
  commonProblems: { title: string; share: number }[];
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/** Strips run-specific numbers so the same kind of problem groups together. */
function problemKey(title: string): string {
  return title.replace(/\s+on surface day \d+/i, '').replace(/:\s*\d+\s*%$/, '');
}

/** @throws when the design is not launchable. */
export function runMonteCarlo(design: MissionDesign, runs: number, seed: number): MonteCarloSummary {
  const scores: number[] = [];
  const problems = new Map<string, number>();
  let success = 0;
  let partial = 0;
  let lost = 0;
  let survived = 0;
  for (let run = 0; run < runs; run++) {
    const result = simulateMission(design, hashCombine(seed, run));
    scores.push(result.score.total);
    if (result.score.outcome === 'success') success++;
    else if (result.score.outcome === 'partial') partial++;
    if (result.lostIn) lost++;
    if (result.surface?.end.kind === 'completed') survived++;
    const seen = new Set<string>();
    for (const entry of result.timeline) if (entry.tone === 'bad') seen.add(problemKey(entry.title));
    for (const finding of result.findings) {
      if (finding.tone === 'bad' && !finding.title.includes(':')) seen.add(problemKey(finding.title));
    }
    for (const key of seen) problems.set(key, (problems.get(key) ?? 0) + 1);
  }
  scores.sort((a, b) => a - b);
  const total = Math.max(runs, 1);
  return {
    runs,
    successShare: success / total,
    partialShare: partial / total,
    failureShare: (runs - success - partial) / total,
    lostShare: lost / total,
    survivedShare: survived / total,
    scoreMean: scores.reduce((sum, score) => sum + score, 0) / total,
    scoreP10: percentile(scores, 0.1),
    scoreP50: percentile(scores, 0.5),
    scoreP90: percentile(scores, 0.9),
    scores,
    commonProblems: [...problems.entries()]
      .map(([title, count]) => ({ title, share: count / total }))
      .sort((a, b) => b.share - a.share)
      .slice(0, 6),
  };
}
