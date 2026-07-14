import type {
  ReportFlowNode,
  StepStatus,
  TestStep,
  WebFlowAction,
  WebFlowStep,
  WebTestCase,
} from '@/lib/types';

export type FlowNodeAction = WebFlowAction | 'press' | 'scroll' | 'start' | 'end';

/** Positive / Negative fork attached to a step — where the flow goes after that outcome. */
export type FlowBranchFork = {
  enabled: boolean;
  /** Short name for Positive path (happy path) */
  positiveLabel: string;
  /** Short name for Negative path (error / fail path) */
  negativeLabel: string;
  /** What Positive means / when this path is taken */
  positiveDefinition: string;
  /** What Negative means / when this path is taken */
  negativeDefinition: string;
  /** Steps that run only on Positive after this node */
  positive: FlowChartNode[];
  /** Steps that run only on Negative after this node */
  negative: FlowChartNode[];
};

export type FlowChartNode = {
  id: string;
  action: FlowNodeAction;
  label: string;
  selector?: string;
  text?: string;
  value?: string;
  url?: string;
  /** True for start/end bookends — not saved as steps */
  locked?: boolean;
  /**
   * Decision fork: after this step, flow continues on Positive OR Negative.
   * Only one fork is supported on the main trunk (first enabled wins when splitting cases).
   */
  fork?: FlowBranchFork;
};

const STEP_ACTIONS: WebFlowAction[] = [
  'goto',
  'click',
  'fill',
  'assertVisible',
  'assertUrl',
  'wait',
  'loginRole',
  'ensureBuyer',
];

export function isWebFlowAction(a: string): a is WebFlowAction {
  return (STEP_ACTIONS as string[]).includes(a);
}

export function createEmptyFork(partial?: Partial<FlowBranchFork>): FlowBranchFork {
  return {
    enabled: true,
    positiveLabel: partial?.positiveLabel || 'Positive',
    negativeLabel: partial?.negativeLabel || 'Negative',
    positiveDefinition:
      partial?.positiveDefinition ||
      'Happy path — action succeeds; continue with success asserts / next happy steps.',
    negativeDefinition:
      partial?.negativeDefinition ||
      'Error path — action fails or invalid input; continue with error message asserts.',
    positive: partial?.positive || [],
    negative: partial?.negative || [],
  };
}

function mapEventToNode(
  e: {
    id: string;
    action: string;
    label: string;
    selector?: string;
    text?: string;
    value?: string;
    url?: string;
    path?: string;
  },
  i: number,
): FlowChartNode {
  let action: FlowNodeAction = 'click';
  if (
    e.action === 'goto' ||
    e.action === 'click' ||
    e.action === 'fill' ||
    e.action === 'press' ||
    e.action === 'scroll' ||
    e.action === 'assertVisible' ||
    e.action === 'assertUrl' ||
    e.action === 'wait' ||
    e.action === 'loginRole' ||
    e.action === 'ensureBuyer'
  ) {
    action = e.action;
  }
  return {
    id: e.id || `flow-${i + 1}`,
    action,
    label: e.label || `${action} step`,
    selector: e.selector,
    text: e.text,
    value: e.value,
    url: e.url || e.path,
  };
}

export function eventsToFlowNodes(
  events: Array<{
    id: string;
    action: string;
    label: string;
    selector?: string;
    text?: string;
    value?: string;
    url?: string;
    path?: string;
  }>,
): FlowChartNode[] {
  const actionable = events.filter((e) => e.action !== 'page');
  const mid = actionable.map((e, i) => mapEventToNode(e, i));

  return [
    { id: 'flow-start', action: 'start', label: 'Start', locked: true },
    ...mid,
    { id: 'flow-end', action: 'end', label: 'End', locked: true },
  ];
}

export function stepsToFlowNodes(steps: WebFlowStep[]): FlowChartNode[] {
  const mid = steps.map((s, i) => ({
    id: s.id || `step-${i + 1}`,
    action: s.action as FlowNodeAction,
    label: s.label || s.action,
    selector: s.selector,
    text: s.text,
    value: s.value,
    url: s.url,
  }));
  return [
    { id: 'flow-start', action: 'start', label: 'Start', locked: true },
    ...mid,
    { id: 'flow-end', action: 'end', label: 'End', locked: true },
  ];
}

function nodeToStep(node: FlowChartNode, n: number): WebFlowStep {
  let action: WebFlowAction = 'click';
  let value = node.value;
  let url = node.url;
  let selector = node.selector;
  let text = node.text;

  if (isWebFlowAction(node.action)) {
    action = node.action;
  } else if (node.action === 'press') {
    action = 'wait';
    value = value || '300';
    text = text || node.label;
  } else if (node.action === 'scroll') {
    action = 'wait';
    value = value || '400';
    text = text || 'Scroll';
  }

  return {
    id: node.id.startsWith('flow-') ? `step-${n}` : node.id || `step-${n}`,
    label: (node.label || action).trim() || `Step ${n}`,
    action,
    url: url?.trim() || undefined,
    selector: selector?.trim() || undefined,
    value: value?.toString().trim() || undefined,
    text: text?.trim() || undefined,
  };
}

/** Flatten a linear list of nodes (no fork children) into steps. */
export function flowNodesToSteps(nodes: FlowChartNode[]): WebFlowStep[] {
  const steps: WebFlowStep[] = [];
  let n = 0;
  for (const node of nodes) {
    if (node.locked || node.action === 'start' || node.action === 'end') continue;
    n += 1;
    steps.push(nodeToStep(node, n));
  }
  return steps;
}

/** Find first enabled fork on the main trunk. */
export function findTrunkFork(
  nodes: FlowChartNode[],
): { index: number; node: FlowChartNode; fork: FlowBranchFork } | null {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.fork?.enabled) {
      return { index: i, node, fork: node.fork };
    }
  }
  return null;
}

/**
 * Split branched chart into Positive and Negative linear step lists.
 * Shared trunk = Start → … → forked step; then each outcome’s branch steps.
 * Nodes after the fork on the trunk are ignored (moved into branches when fork is enabled).
 */
export function branchedFlowToPolaritySteps(nodes: FlowChartNode[]): {
  positive: WebFlowStep[];
  negative: WebFlowStep[];
  hasFork: boolean;
} {
  const forkHit = findTrunkFork(nodes);
  if (!forkHit) {
    const linear = flowNodesToSteps(nodes);
    return { positive: linear, negative: linear, hasFork: false };
  }

  // Include fork node in trunk only when it is a real runnable step (not locked decision).
  const trunkEnd = forkHit.node.locked ? forkHit.index : forkHit.index + 1;
  const shared = flowNodesToSteps(nodes.slice(0, trunkEnd));
  const posBranch = flowNodesToSteps(forkHit.fork.positive);
  const negBranch = flowNodesToSteps(forkHit.fork.negative);

  return {
    positive: [...shared, ...posBranch],
    negative: [...shared, ...negBranch],
    hasFork: true,
  };
}

/** Apply branched flowchart to a Positive+Negative draft pair (same suite). */
export function applyBranchedFlowToPair(
  drafts: WebTestCase[],
  nodes: FlowChartNode[],
): WebTestCase[] {
  const { positive, negative, hasFork } = branchedFlowToPolaritySteps(nodes);
  if (!drafts.length) return drafts;

  if (!hasFork) {
    return drafts.map((c) => applyFlowNodesToCase(c, nodes));
  }

  // Prefer updating a single combined suite draft when present
  if (drafts.length === 1 && drafts[0]?.suiteMode === 'combined') {
    const c = drafts[0];
    return [
      {
        ...c,
        steps: positive,
        positiveSteps: positive,
        negativeSteps: negative,
        flowChart: nodes as unknown[],
        suiteMode: 'combined',
        estimatedMinutes: Math.max(2, Math.ceil((positive.length + negative.length) / 3)),
      },
    ];
  }

  return drafts.map((c) => {
    const exp = c.expectation === 'negative' ? 'negative' : 'positive';
    const steps = exp === 'negative' ? negative : positive;
    return {
      ...c,
      steps,
      estimatedMinutes: Math.max(2, Math.ceil(steps.length / 2)),
    };
  });
}

export function applyFlowNodesToCase(
  draft: WebTestCase,
  nodes: FlowChartNode[],
): WebTestCase {
  const { positive, negative, hasFork } = branchedFlowToPolaritySteps(nodes);
  if (draft.suiteMode === 'combined' || hasFork) {
    return {
      ...draft,
      suiteMode: 'combined',
      steps: positive,
      positiveSteps: positive,
      negativeSteps: negative,
      flowChart: nodes as unknown[],
      estimatedMinutes: Math.max(2, Math.ceil((positive.length + negative.length) / 3)),
    };
  }
  const steps = flowNodesToSteps(nodes);
  return {
    ...draft,
    steps,
    estimatedMinutes: Math.max(2, Math.ceil(steps.length / 2)),
  };
}

/** Count editable steps including both branch arms. */
export function countFlowChartSteps(nodes: FlowChartNode[]): number {
  let n = 0;
  for (const node of nodes) {
    if (node.locked || node.action === 'start' || node.action === 'end') continue;
    n += 1;
    if (node.fork?.enabled) {
      n += countFlowChartSteps(node.fork.positive);
      n += countFlowChartSteps(node.fork.negative);
    }
  }
  return n;
}

function stepKey(s: WebFlowStep): string {
  return [s.action, s.label, s.selector || '', s.text || '', s.url || '', s.value || '']
    .join('|')
    .toLowerCase();
}

/**
 * Build one branched chart from a Positive+Negative pair:
 * shared prefix steps → fork → polarity-only suffixes.
 */
export function mergePairIntoBranchedChart(
  positive: WebTestCase,
  negative: WebTestCase,
): FlowChartNode[] {
  const pos = positive.steps || [];
  const neg = negative.steps || [];
  let i = 0;
  const max = Math.min(pos.length, neg.length);
  while (i < max && stepKey(pos[i]!) === stepKey(neg[i]!)) i += 1;

  if (i === 0) {
    // Paths diverge immediately — locked decision node (not a runnable assert).
    const decision: FlowChartNode = {
      id: 'flow-decision',
      action: 'wait',
      label: 'Happy path ↔ Error path',
      locked: true,
      fork: createEmptyFork({
        positiveDefinition: 'Positive (happy path) — success flow.',
        negativeDefinition: 'Negative (error path) — invalid / unauthorized flow.',
        positive: pos.map((s, idx) => ({
          id: s.id || `pos-${idx + 1}`,
          action: s.action as FlowNodeAction,
          label: s.label,
          selector: s.selector,
          text: s.text,
          value: s.value,
          url: s.url,
        })),
        negative: neg.map((s, idx) => ({
          id: s.id || `neg-${idx + 1}`,
          action: s.action as FlowNodeAction,
          label: s.label,
          selector: s.selector,
          text: s.text,
          value: s.value,
          url: s.url,
        })),
      }),
    };
    return [
      { id: 'flow-start', action: 'start', label: 'Start', locked: true },
      decision,
      { id: 'flow-end', action: 'end', label: 'End', locked: true },
    ];
  }

  const shared: FlowChartNode[] = pos.slice(0, i).map((s, idx) => ({
    id: s.id || `shared-${idx + 1}`,
    action: s.action as FlowNodeAction,
    label: s.label,
    selector: s.selector,
    text: s.text,
    value: s.value,
    url: s.url,
  }));

  const lastShared = shared[shared.length - 1]!;
  lastShared.fork = createEmptyFork({
    positiveDefinition: 'Positive — continue with happy-path steps after this point.',
    negativeDefinition: 'Negative — continue with error-path / invalid steps after this point.',
    positive: pos.slice(i).map((s, idx) => ({
      id: s.id || `pos-${idx + 1}`,
      action: s.action as FlowNodeAction,
      label: s.label,
      selector: s.selector,
      text: s.text,
      value: s.value,
      url: s.url,
    })),
    negative: neg.slice(i).map((s, idx) => ({
      id: s.id || `neg-${idx + 1}`,
      action: s.action as FlowNodeAction,
      label: s.label,
      selector: s.selector,
      text: s.text,
      value: s.value,
      url: s.url,
    })),
  });

  return [
    { id: 'flow-start', action: 'start', label: 'Start', locked: true },
    ...shared,
    { id: 'flow-end', action: 'end', label: 'End', locked: true },
  ];
}

/** Compact flowchart for AI prompts */
export function formatFlowChartForPrompt(nodes: FlowChartNode[]): string {
  const lines = [
    '### EDITABLE FLOW CHART (user-edited — source of truth for step order & Positive/Negative fork)',
  ];

  function walk(list: FlowChartNode[], indent: string) {
    let i = 0;
    for (const node of list) {
      if (node.action === 'start' || node.action === 'end') {
        lines.push(`${indent}${node.action.toUpperCase()}: ${node.label}`);
        continue;
      }
      i += 1;
      const bits = [
        `#${i}`,
        `action=${node.action}`,
        `label="${node.label}"`,
        node.selector ? `selector=${node.selector}` : '',
        node.text ? `text="${node.text}"` : '',
        node.value ? `value="${node.value}"` : '',
        node.url ? `url=${node.url}` : '',
      ].filter(Boolean);
      lines.push(`${indent}${bits.join(' | ')}`);
      if (node.fork?.enabled) {
        lines.push(
          `${indent}  FORK Positive (${node.fork.positiveLabel}): ${node.fork.positiveDefinition}`,
        );
        walk(node.fork.positive, `${indent}    `);
        lines.push(
          `${indent}  FORK Negative (${node.fork.negativeLabel}): ${node.fork.negativeDefinition}`,
        );
        walk(node.fork.negative, `${indent}    `);
      }
    }
  }

  walk(nodes, '');
  return lines.join('\n');
}

export const FLOW_ACTION_OPTIONS: { value: FlowNodeAction; label: string }[] = [
  { value: 'goto', label: 'Go to URL' },
  { value: 'click', label: 'Click' },
  { value: 'fill', label: 'Fill' },
  { value: 'assertVisible', label: 'Assert visible' },
  { value: 'assertUrl', label: 'Assert URL' },
  { value: 'wait', label: 'Wait' },
  { value: 'loginRole', label: 'Login role' },
  { value: 'ensureBuyer', label: 'Ensure buyer' },
  { value: 'press', label: 'Key press' },
  { value: 'scroll', label: 'Scroll' },
];

/** Build a report flow chart from executed (or pending) test steps — Start → steps → End. */
export function buildReportFlowChart(steps: TestStep[]): ReportFlowNode[] {
  const mid: ReportFlowNode[] = (steps || []).map((s) => ({
    id: s.id,
    label: s.label || s.id,
    status: (s.status || 'pending') as StepStatus,
    action: s.action,
    message: s.message,
  }));

  const allDone =
    mid.length > 0 &&
    mid.every((n) => n.status === 'passed' || n.status === 'failed' || n.status === 'skipped');
  const anyFailed = mid.some((n) => n.status === 'failed');
  const endStatus: StepStatus = !mid.length
    ? 'pending'
    : anyFailed
      ? 'failed'
      : allDone
        ? 'passed'
        : mid.some((n) => n.status === 'running')
          ? 'running'
          : 'pending';

  return [
    {
      id: 'flow-start',
      label: 'Start',
      status: mid.some((n) => n.status !== 'pending') ? 'passed' : 'pending',
      action: 'start',
      locked: true,
    },
    ...mid,
    {
      id: 'flow-end',
      label: 'End',
      status: endStatus,
      action: 'end',
      locked: true,
    },
  ];
}

/** Ensure report has a flow chart (derive from steps if missing — older reports). */
export function ensureReportFlowChart(report: {
  steps?: TestStep[];
  flowChart?: ReportFlowNode[];
}): ReportFlowNode[] {
  if (Array.isArray(report.flowChart) && report.flowChart.length) {
    return report.flowChart;
  }
  return buildReportFlowChart(report.steps || []);
}
