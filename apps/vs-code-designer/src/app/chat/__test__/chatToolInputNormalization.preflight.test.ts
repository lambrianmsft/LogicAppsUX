import { describe, expect, it } from 'vitest';
import {
  normalizeChatToolInput,
  sanitizeWorkflowProjectNameOnToolInput,
  withParameterTextOnAddActionToolInput,
} from '../logicAppsChatParticipant';

const maxParameterTextLength = 512;

describe('chat tool input normalization preflight contracts', () => {
  it('removes model-inferred project names that are really connector parameters', () => {
    const input = sanitizeWorkflowProjectNameOnToolInput(
      'logicapps_addAction',
      {
        workflowName: 'Stateful1',
        projectName: 'Imperial',
        actionName: 'Get_Current_Weather',
      },
      ['test-workspace']
    ) as Record<string, unknown>;

    expect(input.projectName).toBeUndefined();
    expect(input.workflowName).toBe('Stateful1');
    expect(input.actionName).toBe('Get_Current_Weather');
  });

  it('appends the full user request to model-supplied parameterText for connector inference', () => {
    const prompt = 'Add an action to Stateful1 that gets the current weather for Redmond, WA.';
    const input = withParameterTextOnAddActionToolInput(
      'logicapps_addAction',
      {
        workflowName: 'Stateful1',
        actionName: 'Get_Current_Weather',
        parameterText: 'current weather',
      },
      prompt
    ) as Record<string, unknown>;

    expect(input.parameterText).toBe(`current weather\n\nUser request: ${prompt}`);
  });

  it('prioritizes preserving the full user request when model parameterText is verbose', () => {
    const prompt = 'Add an action to Stateful1 that gets the current weather for Redmond, WA.';
    const verboseModelText = 'model '.repeat(120);
    const input = withParameterTextOnAddActionToolInput(
      'logicapps_addAction',
      {
        workflowName: 'Stateful1',
        actionName: 'Get_Current_Weather',
        parameterText: verboseModelText,
      },
      prompt
    ) as Record<string, unknown>;

    const parameterText = input.parameterText as string;
    expect(parameterText.length).toBeLessThanOrEqual(maxParameterTextLength);
    expect(parameterText).toContain(`User request: ${prompt}`);
    expect(parameterText).toContain('Redmond, WA');
  });

  it('preserves the tail of very long user requests so late connector parameters survive truncation', () => {
    const prompt = `${'background context '.repeat(60)}Add an action to Stateful1 that gets the current weather for Redmond, WA.`;
    const input = withParameterTextOnAddActionToolInput(
      'logicapps_addAction',
      {
        workflowName: 'Stateful1',
        actionName: 'Get_Current_Weather',
        parameterText: 'current weather',
      },
      prompt
    ) as Record<string, unknown>;

    const parameterText = input.parameterText as string;
    expect(parameterText.length).toBeLessThanOrEqual(maxParameterTextLength);
    expect(parameterText).toContain('User request:');
    expect(parameterText).toContain('Redmond, WA');
  });

  it('preserves the tail of long user requests when model parameterText is absent', () => {
    const prompt = `${'background context '.repeat(60)}Add an action to Stateful1 that gets the current weather in Honolulu, HI.`;
    const input = withParameterTextOnAddActionToolInput(
      'logicapps_addAction',
      {
        workflowName: 'Stateful1',
        actionName: 'Get_Current_Weather',
      },
      prompt
    ) as Record<string, unknown>;

    const parameterText = input.parameterText as string;
    expect(parameterText.length).toBeLessThanOrEqual(maxParameterTextLength);
    expect(parameterText).toContain('Honolulu, HI');
  });

  it('does not duplicate the user request when model parameterText already contains it', () => {
    const prompt = 'Add an action to Stateful1 that gets the current weather for Redmond, WA.';
    const input = withParameterTextOnAddActionToolInput(
      'logicapps_addAction',
      {
        workflowName: 'Stateful1',
        actionName: 'Get_Current_Weather',
        parameterText: prompt,
      },
      prompt
    ) as Record<string, unknown>;

    expect(input.parameterText).toBe(prompt);
  });

  it('normalizes chat tool input before invocation with project sanitization and full prompt parameterText', () => {
    const prompt = 'Add an action to Stateful1 that gets the current weather for Redmond, WA.';
    const input = normalizeChatToolInput(
      'logicapps_addAction',
      {
        workflowName: 'Stateful1',
        actionName: 'Get_Current_Weather',
        projectName: 'Imperial',
        parameterText: 'current weather',
      },
      prompt,
      { validProjectNames: ['test-workspace'] }
    ) as Record<string, unknown>;

    expect(input.projectName).toBeUndefined();
    expect(input.parameterText).toBe(`current weather\n\nUser request: ${prompt}`);
  });

  it('preserves weather location and units from the exact add-action prompt before tool invocation', () => {
    const prompt = 'Add an action to Stateful1 that gets the current weather for Seattle, WA in Imperial units.';
    const input = normalizeChatToolInput(
      'logicapps_addAction',
      {
        workflowName: 'Stateful1',
        actionName: 'Get_Current_Weather',
        projectName: 'Imperial',
        parameterText: 'current weather',
      },
      prompt,
      { validProjectNames: ['test-workspace'] }
    ) as Record<string, unknown>;

    const parameterText = input.parameterText as string;
    expect(input.workflowName).toBe('Stateful1');
    expect(input.projectName).toBeUndefined();
    expect(parameterText).toContain('Seattle, WA');
    expect(parameterText).toContain('Imperial units');
  });

  it('normalizes chat tool input by forcing contextual project names over model guesses', () => {
    const input = normalizeChatToolInput(
      'logicapps_addAction',
      {
        workflowName: 'Stateful1',
        actionName: 'Get_Current_Weather',
        projectName: 'Imperial',
      },
      'Add weather for Redmond, WA',
      { forcedProjectName: 'test-workspace', validProjectNames: ['test-workspace'] }
    ) as Record<string, unknown>;

    expect(input.projectName).toBe('test-workspace');
    expect(input.parameterText).toBe('Add weather for Redmond, WA');
  });

  it('does not sanitize project names when project validation context is unavailable', () => {
    const input = normalizeChatToolInput(
      'logicapps_addAction',
      {
        workflowName: 'Stateful1',
        actionName: 'Get_Current_Weather',
        projectName: 'Imperial',
      },
      'Add weather for Redmond, WA'
    ) as Record<string, unknown>;

    expect(input.projectName).toBe('Imperial');
    expect(input.parameterText).toBe('Add weather for Redmond, WA');
  });
});
