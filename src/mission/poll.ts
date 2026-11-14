// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
/**
 * The Go/No-Go poll: each role looks at the part of the design it answers for and votes. A No-Go
 * must say why. Launch needs every role at Go and a design with nothing failed.
 */
import { MISSION_CONSTANTS, ROLE_IDS, type Role, type RoleId } from '@/data/mission-constants';
import { type BudgetLine, type BudgetStatus, worstStatus } from '@/mission/budget-line';
import type { DesignEvaluation } from '@/mission/evaluate-design';
import { roleForSlot } from '@/mission/roles';
import type { DesignIssue } from '@/mission/validation';

export interface RoleVote {
  vote: 'go' | 'no_go' | null;
  /** Required for a No-Go: what has to change. */
  reason: string;
}

export type PollVotes = Record<RoleId, RoleVote>;

export function emptyVotes(): PollVotes {
  const votes = {} as PollVotes;
  for (const id of ROLE_IDS) votes[id] = { vote: null, reason: '' };
  return votes;
}

export interface RoleReadiness {
  role: Role;
  /** Worst status among what the role answers for. */
  status: BudgetStatus;
  lines: BudgetLine[];
  issues: DesignIssue[];
}

/** What each role sees in the poll: its budget lines and rule issues, with the worst status. */
export function roleReadiness(evaluation: DesignEvaluation): RoleReadiness[] {
  return MISSION_CONSTANTS.roles.map((role) => {
    const lines = evaluation.budgets.filter((line) => role.resources.includes(line.id));
    const issues = evaluation.issues.filter((issue) => roleForSlot(issue.slot) === role.id);
    const issueStatuses: BudgetStatus[] = issues.map((issue) =>
      issue.severity === 'error' ? 'fail' : 'warning',
    );
    return {
      role,
      status: worstStatus([...lines.map((line) => line.status), ...issueStatuses]),
      lines,
      issues,
    };
  });
}

export interface PollOutcome {
  canLaunch: boolean;
  /** What is still in the way, or the confirmation that all is Go. */
  why: string;
}

export function pollOutcome(votes: PollVotes, evaluation: DesignEvaluation): PollOutcome {
  if (!evaluation.launchable) {
    return {
      canLaunch: false,
      why: 'The design has a failed or unfinished budget: fix it before the poll can pass.',
    };
  }
  const roles = MISSION_CONSTANTS.roles;
  const noGo = roles.filter((role) => votes[role.id].vote === 'no_go');
  if (noGo.length > 0) {
    const unexplained = noGo.find((role) => votes[role.id].reason.trim() === '');
    if (unexplained) return { canLaunch: false, why: `${unexplained.name} is No-Go and must give a reason.` };
    return {
      canLaunch: false,
      why: `${noGo.map((role) => role.name).join(' and ')} ${noGo.length === 1 ? 'is' : 'are'} No-Go. Change the design or the vote.`,
    };
  }
  const waiting = roles.filter((role) => votes[role.id].vote === null);
  if (waiting.length > 0) {
    return { canLaunch: false, why: `Waiting for ${waiting.map((role) => role.name).join(', ')}.` };
  }
  return { canLaunch: true, why: 'All four roles are Go.' };
}
