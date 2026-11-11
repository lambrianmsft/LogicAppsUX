import { describe, expect, it } from 'vitest';
import AdmZip from 'adm-zip';
import { readBicepParameters } from '../bicepParameters';
import { bicepString, nativeZip, parseNativeParameters, renderNativeParameters } from './nativeExportFixtures';

const original = () => new AdmZip(nativeZip('Bicep', 'main')).getEntry('app/infrastructure/resource-name.bicepparam').getData();
const read = (content: string | Buffer) => readBicepParameters(Buffer.from(content), 'resource-name.bicep', true);

describe('closed generated Bicep parameter profile', () => {
  it('decodes scalar strings and object-only json without evaluating injection-shaped data or changing source bytes', () => {
    const text = "'\\\r\n\t\u0000\u007f\u2603\ud83d\ude00${notAnExpression}\nparam injected = readEnvironmentVariable('SECRET')";
    const parameters = parseNativeParameters(original().toString());
    parameters.parameters.authentication.value = {
      parameterValues: {
        text,
        nested: [null, true, false, 1.25, 1e-7, { '${key}': text }],
      },
    };
    parameters.parameters.connectionDisplayName.value = text;
    const bytes = Buffer.from(renderNativeParameters(parameters, 'main'));
    const before = Buffer.from(bytes);
    const values = read(bytes);
    expect(values.connectionDisplayName.value).toBe(text);
    expect(values.authentication.value).toEqual(parameters.parameters.authentication.value);
    expect(bytes).toEqual(before);
    expect(Object.keys(values)).toHaveLength(8);
  });

  it('retains existing JavaScript number semantics without rewriting original large-integer bytes', () => {
    const json = '{"parameterValues":{"fraction":1.25,"exponent":1e-7,"large":9223372036854775807}}';
    const text = original()
      .toString()
      .replace(/param authentication = .*/, `param authentication = json(${bicepString(json)})`);
    const bytes = Buffer.from(text);
    expect(read(bytes).authentication.value).toEqual(JSON.parse(json));
    expect(bytes.toString()).toContain('9223372036854775807');
  });

  it('accepts CRLF, spaces, and Unicode scalar escapes', () => {
    const text = original().toString().replace("param location = 'eastus'", "param location = '\\u{65}astus'").replace(/\n/g, '\r\n');
    expect(read(` \t\r\n${text} \t`).location.value).toBe('eastus');
  });

  it.each([
    ["using './resource-name.bicep'", "using './other.template.bicep'"],
    ["using './resource-name.bicep'", "using '../resource-name.bicep'"],
    ["using './resource-name.bicep'", "using '/resource-name.bicep'"],
    ["using './resource-name.bicep'", "using 'br:registry/module:v1'"],
    ["using './resource-name.bicep'", 'using none'],
    ["using './resource-name.bicep'", "using './resource-name.bicep'\nusing './resource-name.bicep'"],
    ["param location = 'eastus'", "param location = '${readEnvironmentVariable(\\'SECRET\\')}'"],
    ["param location = 'eastus'", "param location = readEnvironmentVariable('SECRET')"],
    ["param location = 'eastus'", "param location = loadTextContent('SECRET')"],
    ["param location = 'eastus'", 'param location = json(\'"eastus"\')'],
    ["param location = 'eastus'", 'param location = 1'],
    ["param location = 'eastus'", "param location = '\\x65astus'"],
    ["param location = 'eastus'", "param location = '\\u{110000}'"],
    ["param location = 'eastus'", "param location = '\\u{}'"],
    ["param location = 'eastus'", "param location = '\\u{123'"],
    ["param location = 'eastus'", "param location = '\\$eastus'"],
    ["param location = 'eastus'", "param location = 'east\nus'"],
    ["param location = 'eastus'", "param location = 'east\u0000us'"],
    ["param location = 'eastus'", "param location = 'eastus' param tenantId = ''"],
    ["param location = 'eastus'", "param location = 'eastus'\nparam location = 'westus'"],
    ["param location = 'eastus'", "var location = 'eastus'"],
    ["param location = 'eastus'", "param unsupported = 'eastus'"],
    ["param location = 'eastus'", "param location = 'eastus' + 'suffix'"],
  ])('rejects unsupported syntax %s -> %s', (before, after) => {
    expect(() => read(original().toString().replace(before, after))).toThrow('Regenerate');
  });

  it.each([
    "\nimport * as other from './other.bicep'",
    "\nextends './other.bicepparam'",
    '\n// comment',
    '\n/* comment */',
    "\nparam __proto__ = 'value'",
    "\nparam constructor = 'value'",
    '\n;',
  ])('rejects trailing declarations and content %s', (suffix) => {
    expect(() => read(`${original()}${suffix}`)).toThrow('Regenerate');
  });

  it.each([
    "'plain-string'",
    '{}',
    "json('{}', '{}')",
    "json(readEnvironmentVariable('SECRET'))",
    "json('{}').property",
    'json(\'{"value":null,}\')',
    'json(\'{"value":null,"value":true}\')',
    'json(\'{"outer":{"duplicate":1,"duplicate":2}}\')',
    "json('[]')",
    "json('null')",
    'json(\'"object-required"\')',
    "json('{/*comment*/}')",
    "json('{')",
  ])('rejects object expressions outside exactly one escaped JSON object string: %s', (expression) => {
    const text = original()
      .toString()
      .replace(/param authentication = .*/, `param authentication = ${expression}`);
    expect(() => read(text)).toThrow('Regenerate');
  });

  it('bounds JSON depth, structural count, byte length, encoding and incomplete content', () => {
    for (const json of ['{"value":'.repeat(65) + 'null' + '}'.repeat(65), `{"value":[${'null,'.repeat(100000)}null]}`]) {
      const text = original()
        .toString()
        .replace(/param authentication = .*/, `param authentication = json(${bicepString(json)})`);
      expect(() => read(text)).toThrow('Regenerate');
    }
    for (const content of [
      Buffer.alloc(20 * 1024 * 1024 + 1),
      Buffer.from([0xff]),
      Buffer.from(''),
      Buffer.from('{"parameters":{}}'),
      Buffer.from("using './resource-name.bicep'\n"),
      Buffer.from(original().toString().replace("param location = 'eastus'", "param location = 'unfinished")),
    ]) {
      expect(() => read(content)).toThrow('Regenerate');
    }
  });

  it('requires all host inputs with the optional workspace convention and correct known types', () => {
    const bytes = new AdmZip(nativeZip('Bicep')).getEntry('app/infrastructure/app.bicepparam').getData();
    expect(readBicepParameters(bytes, 'app.bicep', false).additionalAppSettings.value).toEqual({});
    for (const text of [
      bytes.toString().replace(/param additionalAppSettings = .*/, ''),
      bytes.toString().replace(/param additionalAppSettings = .*/, "param additionalAppSettings = '{}'"),
      bytes.toString().replace(/param name = .*/, 'param name = json(\'"app"\')'),
      `${bytes}\nparam authentication = json('{}')`,
    ]) {
      expect(() => readBicepParameters(Buffer.from(text), 'app.bicep', false)).toThrow('Regenerate');
    }
  });

  it('preserves existing optional quoted host skuCode and decimal worker-count literals only', () => {
    const host = new AdmZip(nativeZip('Bicep')).getEntry('app/infrastructure/app.bicepparam').getData();
    for (const workers of [1, 50, 100]) {
      const bytes = Buffer.from(`${host}\nparam skuCode = 'WS2'\nparam numberOfWorkers = ${workers}\n`);
      const before = Buffer.from(bytes);
      expect(readBicepParameters(bytes, 'app.bicep', false)).toMatchObject({
        skuCode: { value: 'WS2' },
        numberOfWorkers: { value: workers },
      });
      expect(bytes).toEqual(before);
    }
    for (const value of ['0', '101', '-1', '+1', '01', '1.0', '1e1', '1 + 1', "'1'", "json('1')", "readEnvironmentVariable('COUNT')"]) {
      expect(() => readBicepParameters(Buffer.from(`${host}\nparam numberOfWorkers = ${value}\n`), 'app.bicep', false)).toThrow(
        'Regenerate'
      );
    }
    expect(() => readBicepParameters(Buffer.from(`${host}\nparam skuCode = 1\n`), 'app.bicep', false)).toThrow('Regenerate');
    expect(() => read(`${original()}\nparam numberOfWorkers = 1\n`)).toThrow('Regenerate');
    expect(() => read(`${original()}\nparam skuCode = 'WS1'\n`)).toThrow('Regenerate');
  });

  it('uses the trusted role rather than a reserved main filename to permit host-only options', () => {
    const host = new AdmZip(nativeZip('Bicep')).getEntry('app/infrastructure/app.bicepparam').getData().toString();
    const text = `${host.replace("using './app.bicep'", "using './main.bicep'")}\nparam numberOfWorkers = 2\n`;
    expect(readBicepParameters(Buffer.from(text), 'main.bicep', false).numberOfWorkers.value).toBe(2);
    const child = original().toString().replace("using './resource-name.bicep'", "using './main.bicep'");
    expect(readBicepParameters(Buffer.from(child), 'main.bicep', true).connectionReferenceName.value).toBe('main');
    expect(() => readBicepParameters(Buffer.from(`${child}\nparam numberOfWorkers = 2\n`), 'main.bicep', true)).toThrow('Regenerate');
  });
});
