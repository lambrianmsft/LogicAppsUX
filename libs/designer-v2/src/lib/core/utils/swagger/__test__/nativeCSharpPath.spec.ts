import { InitWorkflowService, SwaggerParser } from '@microsoft/logic-apps-shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { getInputParametersFromSwagger, getOperationIdFromDefinition } from '../operation';
import { loadInputValuesFromDefinition, processPathInputs } from '../inputsbuilder';

const path = '#{string.Format(global::System.Globalization.CultureInfo.InvariantCulture, "/current/{0}", encodeURIComponent("98058"))}';
const swagger = new SwaggerParser({
  swagger: '2.0',
  info: { title: 'Weather', version: '1' },
  basePath: '/apim/msnweather',
  paths: {
    '/{connectionId}/current/{Location}': {
      get: {
        operationId: 'CurrentWeather',
        parameters: [{ name: 'Location', in: 'path', required: true, type: 'string' }],
        responses: { '200': { description: 'OK' } },
      },
    },
    '/{connectionId}/forecast/today/{Location}': {
      get: { operationId: 'TodaysForecast', responses: { '200': { description: 'OK' } } },
    },
  },
});

describe('native connector operation initialization', () => {
  beforeEach(() => {
    InitWorkflowService({
      getCallbackUrl: async () => {
        throw new Error('No workflow requests are expected in metadata initialization');
      },
    });
  });

  it('infers the managed operation then initializes its path parameter without mutating the definition', () => {
    const inputs = { method: 'get', path };
    const before = JSON.stringify(inputs);
    expect(getOperationIdFromDefinition(inputs, swagger)).toBe('CurrentWeather');
    const parameters = Object.values(swagger.getInputParameters('CurrentWeather').byId);
    const initialized = loadInputValuesFromDefinition(inputs, parameters, '/current/{Location}', '/apim/msnweather');
    expect(initialized.find((parameter) => parameter.name === 'Location')?.value).toBe('#{encodeURIComponent("98058")}');
    expect(() =>
      getInputParametersFromSwagger(
        'action_37229700',
        false,
        swagger,
        { type: 'ApiConnection', connectorId: '/managedApis/msnweather', operationId: 'CurrentWeather' },
        { type: 'ApiConnection', inputs }
      )
    ).not.toThrow();
    expect(JSON.stringify(inputs)).toBe(before);
  });

  it.each(['/current/98058', "/current/@{encodeURIComponent('98058')}"])('preserves the literal/WDL path flow: %s', (path) => {
    expect(getOperationIdFromDefinition({ method: 'get', path }, swagger)).toBe('CurrentWeather');
    expect(processPathInputs(path, '/current/{Location}')).toHaveProperty('Location');
  });

  it('rejects ambiguity rather than selecting the first matching operation', () => {
    const ambiguous = new SwaggerParser({
      ...swagger.api,
      paths: {
        ...swagger.api.paths,
        '/{connectionId}/current/{Other}': {
          get: { operationId: 'OtherWeather', responses: { '200': { description: 'OK' } } },
        },
      },
    });
    expect(() => getOperationIdFromDefinition({ method: 'get', path }, ambiguous)).toThrow('multiple Swagger operations');
  });

  it('keeps explicit errors for unsupported expression shapes and mismatched parameter templates', () => {
    expect(() => getOperationIdFromDefinition({ method: 'get', path: '#{GetPath()}' }, swagger)).toThrow('Unsupported native C#');
    expect(() => processPathInputs(path, '/forecast/{Location}')).toThrow('does not match');
    expect(getOperationIdFromDefinition({ method: 'post', path }, swagger)).toBeUndefined();
  });
});
