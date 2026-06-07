import { describe, expect, it } from 'vitest';
import {
  constructManagedApiConnectorId,
  getWeatherManagedApiOverrideHints,
  normalizeManagedApiConnectorName,
  routeParametersToApiConnectionInputs,
  shouldAutoUseWeatherConnector,
} from '../tools/workflowTools';

const msnweatherParams = [
  {
    name: 'Location',
    in: 'path' as const,
    required: true,
    type: 'string',
    xMsSummary: 'Location',
  },
  {
    name: 'units',
    in: 'query' as const,
    required: false,
    type: 'string',
    enum: ['I', 'C'],
    xMsEnum: {
      values: [
        { value: 'I', displayName: 'Imperial' },
        { value: 'C', displayName: 'Metric' },
      ],
    },
  },
];

describe('workflow tool validation preflight contracts', () => {
  it('normalizes relative managedApis connector hints before building ARM connector IDs', () => {
    const result = constructManagedApiConnectorId(
      '/subscriptions/80d4fe69-c95b-4dd2-a938-9250f1c8ab03/providers/Microsoft.Web/locations/eastus2euap/managedApis/',
      '/managedapis/weather'
    );

    expect(normalizeManagedApiConnectorName('/managedapis/weather')).toBe('weather');
    expect(result).toBe(
      '/subscriptions/80d4fe69-c95b-4dd2-a938-9250f1c8ab03/providers/Microsoft.Web/locations/eastus2euap/managedApis/weather'
    );
    expect(result).not.toContain('managedApis//managedapis');
  });

  it('uses canonical weather connector hints after malformed generic weather metadata resolution fails', () => {
    expect(getWeatherManagedApiOverrideHints(undefined, undefined, undefined, undefined)).toEqual({
      connectorReference: 'msnweather',
      connectorId: 'msnweather',
      operationId: 'CurrentWeather',
      method: 'get',
      path: undefined,
    });
  });

  it('does not trigger weather fallback from location text alone', () => {
    expect(shouldAutoUseWeatherConnector('Http', 'In_Seattle_Add_HTTP_Trigger', {})).toBe(false);
    expect(shouldAutoUseWeatherConnector('ApiConnection', 'Seattle_Action', { path: '/v2/something' })).toBe(false);
  });

  it('routes natural weather location into the path and omits optional units when not requested', () => {
    const result = routeParametersToApiConnectionInputs(
      undefined,
      undefined,
      '/current/{Location}',
      msnweatherParams,
      'Add an action to Stateful1 that gets the current weather for Redmond, WA.'
    );

    expect(result.missing).toEqual([]);
    expect(result.path).toBe("/current/@{encodeURIComponent('Redmond, WA')}");
    expect(result.queries).toBeUndefined();
  });

  it('routes natural weather location into path and unit display name into query code', () => {
    const result = routeParametersToApiConnectionInputs(
      undefined,
      undefined,
      '/current/{Location}',
      msnweatherParams,
      'Add an action to Stateful1 that gets the current weather for Seattle, WA in Imperial units.'
    );

    expect(result.missing).toEqual([]);
    expect(result.path).toBe("/current/@{encodeURIComponent('Seattle, WA')}");
    expect(result.queries).toEqual({ units: 'I' });
  });

  it.each(['Seattle, WA', 'Los Angeles, CA', 'Honolulu, HI', 'Tokyo, Japan', 'Tokyo', '90210'])(
    'routes natural weather location "%s" into the path',
    (location) => {
      const result = routeParametersToApiConnectionInputs(
        undefined,
        undefined,
        '/current/{Location}',
        msnweatherParams,
        `Add an action to Stateful1 that gets the current weather for ${location}.`
      );

      expect(result.missing).toEqual([]);
      expect(result.path).toBe(`/current/@{encodeURIComponent('${location}')}`);
      expect(result.queries).toBeUndefined();
    }
  );

  it.each(['Seattle, WA', 'Los Angeles, CA', 'Honolulu, HI', 'Tokyo, Japan', 'Tokyo', '90210'])(
    'routes natural weather-in location "%s" into the path',
    (location) => {
      const result = routeParametersToApiConnectionInputs(
        undefined,
        undefined,
        '/current/{Location}',
        msnweatherParams,
        `Add an action to Stateful1 that gets the current weather in ${location}.`
      );

      expect(result.missing).toEqual([]);
      expect(result.path).toBe(`/current/@{encodeURIComponent('${location}')}`);
      expect(result.queries).toBeUndefined();
    }
  );

  it('does not treat weather unit text as a location', () => {
    const result = routeParametersToApiConnectionInputs(
      undefined,
      undefined,
      '/current/{Location}',
      msnweatherParams,
      'Add an action to Stateful1 that gets the current weather in Imperial units.'
    );

    expect(result.missing).toEqual(['Location']);
    expect(result.queries).toEqual({ units: 'I' });
  });

  it('does not treat workflow expression braces in explicit paths as unresolved connector placeholders', () => {
    const result = routeParametersToApiConnectionInputs(
      undefined,
      undefined,
      "/datasets/@{variables('table{with}braces')}/items/@{variables('item{id}')}/fields",
      [
        { name: 'dataset', in: 'path' as const, required: true, type: 'string' },
        { name: 'item', in: 'path' as const, required: true, type: 'string' },
      ]
    );

    expect(result.missing).toEqual([]);
  });
});
