import { describe, it, expect } from 'vitest';
import { extendUpstreamNodeIdsForScopePaste } from '../copypaste';
import type { RootState } from '../../..';
import { WORKFLOW_NODE_TYPES } from '@microsoft/logic-apps-shared';

const buildState = (): RootState => {
  // Graph shape:
  //   root
  //     ├── Init_Variable   (source node at root)
  //     └── Condition_outer (scope, comes after Init_Variable)
  //           └── Actions   (subgraph inside Condition_outer)
  //                 └── (paste site — no existing children)
  const actionsSubgraph = {
    id: 'Condition_outer-actions',
    type: WORKFLOW_NODE_TYPES.SUBGRAPH_NODE,
    children: [],
    edges: [],
  } as any;

  const conditionOuter = {
    id: 'Condition_outer',
    type: WORKFLOW_NODE_TYPES.GRAPH_NODE,
    children: [actionsSubgraph],
    edges: [],
  } as any;

  const initVariable = {
    id: 'Init_Variable',
    type: WORKFLOW_NODE_TYPES.OPERATION_NODE,
  } as any;

  const rootGraph = {
    id: 'root',
    type: WORKFLOW_NODE_TYPES.GRAPH_NODE,
    children: [initVariable, conditionOuter],
    edges: [{ id: 'Init_Variable-Condition_outer', source: 'Init_Variable', target: 'Condition_outer' }],
  } as any;

  return {
    workflow: {
      graph: rootGraph,
      nodesMetadata: {
        Init_Variable: { graphId: 'root', isRoot: true },
        Condition_outer: { graphId: 'root' },
        'Condition_outer-actions': { graphId: 'Condition_outer', parentNodeId: 'Condition_outer', subgraphType: 'CONDITIONAL_TRUE' },
      },
    },
    tokens: {
      outputTokens: {
        Init_Variable: {} as any,
        Condition_outer: {} as any,
      },
    },
  } as unknown as RootState;
};

describe('extendUpstreamNodeIdsForScopePaste', () => {
  it('returns the original upstream ids unchanged when there is no parent scope', () => {
    const state = buildState();
    const result = extendUpstreamNodeIdsForScopePaste(['Init_Variable'], undefined, state, {});
    expect(result).toEqual(['Init_Variable']);
  });

  it('adds the enclosing scope container and its upstream context when pasting inside a scope', () => {
    const state = buildState();
    const nodeMap: Record<string, string> = {
      Init_Variable: 'Init_Variable',
      Condition_outer: 'Condition_outer',
    };
    const result = extendUpstreamNodeIdsForScopePaste([], 'Condition_outer', state, nodeMap);
    expect(result).toContain('Condition_outer');
    expect(result).toContain('Init_Variable');
  });

  it('deduplicates ids that already appear in the caller-provided upstream list', () => {
    const state = buildState();
    const nodeMap: Record<string, string> = { Init_Variable: 'Init_Variable', Condition_outer: 'Condition_outer' };
    const result = extendUpstreamNodeIdsForScopePaste(['Init_Variable', 'Condition_outer'], 'Condition_outer', state, nodeMap);
    const initCount = result.filter((id) => id === 'Init_Variable').length;
    const outerCount = result.filter((id) => id === 'Condition_outer').length;
    expect(initCount).toBe(1);
    expect(outerCount).toBe(1);
  });

  it('extends via a subgraph parentId by walking up to the owning scope', () => {
    const state = buildState();
    const nodeMap: Record<string, string> = { Init_Variable: 'Init_Variable', Condition_outer: 'Condition_outer' };
    const result = extendUpstreamNodeIdsForScopePaste([], 'Condition_outer-actions', state, nodeMap);
    expect(result).toContain('Condition_outer-actions');
    expect(result).toContain('Condition_outer');
    expect(result).toContain('Init_Variable');
  });
});
