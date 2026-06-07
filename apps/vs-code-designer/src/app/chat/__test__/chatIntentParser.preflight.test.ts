import { describe, expect, it } from 'vitest';
import { parseIntentFromPrompt } from '../logicAppsChatParticipant';

describe('chat intent preflight contracts', () => {
  it.each([
    {
      prompt: 'Add an action to Stateful1 that gets the current weather for Seattle, WA in Imperial units.',
      action: 'modifyAction',
      confidence: 'high',
    },
    {
      prompt: 'In Stateful1, build a workflow that receives an HTTP request and replies with the current weather for Seattle, WA.',
      action: 'modifyAction',
      confidence: 'high',
    },
    {
      prompt: 'In Stateful1 add an action that gets the current weather for Redmond, WA.',
      action: 'modifyAction',
      confidence: 'high',
    },
    {
      prompt: 'Add a response to MyWorkflow',
      action: 'modifyAction',
      confidence: 'high',
    },
    {
      prompt: 'Create 5 stateful workflows under TonyProject from Stateful1-5',
      action: 'createWorkflows',
      confidence: 'high',
    },
    {
      prompt: 'create new rule engine logic app with one workflow called stateful',
      action: 'createProject',
      confidence: 'high',
    },
  ])('routes "$prompt" to $action', ({ prompt, action, confidence }) => {
    const result = parseIntentFromPrompt(prompt);

    expect(result.action).toBe(action);
    expect(result.confidence).toBe(confidence);
  });

  it.each([
    'what is the weather for Seattle, WA in Imperial units?',
    'In Seattle, add an HTTP trigger that handles weather requests',
    'Add a response to Seattle',
  ])('does not treat parameter/location phrasing as a workflow target: "$prompt"', (prompt) => {
    const result = parseIntentFromPrompt(prompt);

    expect(result.action).toBe('unknown');
    expect(result.confidence).toBe('low');
  });
});
