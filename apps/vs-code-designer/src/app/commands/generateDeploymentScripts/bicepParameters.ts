import { visit } from 'jsonc-parser';

const hostStrings = ['name', 'location', 'hostingPlanName', 'storageAccountName', 'workspaceResourceId', 'skuCode'];
const connectionStrings = [
  'connectionName',
  'connectionDisplayName',
  'connectionReferenceName',
  'connectorName',
  'location',
  'principalId',
  'tenantId',
];

function invalid(): never {
  throw new Error('Unsupported generated Bicep parameter file. Regenerate with a matching backend; parameter contents are not displayed.');
}

function readObject(text: string): Record<string, unknown> {
  const containers: (Set<string> | undefined)[] = [];
  let tokens = 0;
  const count = () => {
    if (++tokens > 100000) {
      invalid();
    }
  };
  const begin = (keys?: Set<string>) => {
    count();
    if (containers.length >= 64) {
      invalid();
    }
    containers.push(keys);
  };
  visit(
    text,
    {
      onObjectBegin: () => begin(new Set()),
      onArrayBegin: () => begin(),
      onObjectEnd: () => containers.pop(),
      onArrayEnd: () => containers.pop(),
      onLiteralValue: count,
      onObjectProperty: (key) => {
        count();
        const keys = containers[containers.length - 1];
        if (!keys || keys.has(key)) {
          invalid();
        }
        keys.add(key);
      },
      onError: invalid,
    },
    { disallowComments: true, allowTrailingComma: false }
  );
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid();
  }
  return value as Record<string, unknown>;
}

/**
 * Reads only the closed profile emitted by the export service, never arbitrary Bicep.
 * The original bytes remain the exported artifact; decoded values are validation-only.
 */
export function readBicepParameters(content: Buffer, template: string, connection: boolean): Record<string, { value: unknown }> {
  if (!content.length || content.length > 20 * 1024 * 1024) {
    invalid();
  }
  const text = content.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(content)) {
    invalid();
  }
  let offset = 0;
  const spaces = () => {
    while (text[offset] === ' ' || text[offset] === '\t') {
      offset++;
    }
  };
  const lines = () => {
    while (offset < text.length && /[ \t\r\n]/.test(text[offset])) {
      offset++;
    }
  };
  const take = (expected: string) => {
    if (!text.startsWith(expected, offset)) {
      invalid();
    }
    offset += expected.length;
  };
  const string = (): string => {
    take("'");
    let value = '';
    while (offset < text.length) {
      const character = text[offset++];
      if (character === "'") {
        return value;
      }
      if (character.charCodeAt(0) < 32 || (character === '$' && text[offset] === '{')) {
        invalid();
      }
      if (character !== '\\') {
        value += character;
        continue;
      }
      const escapedCharacter = text[offset++];
      const escapes: Record<string, string> = { '\\': '\\', "'": "'", n: '\n', r: '\r', t: '\t' };
      if (Object.hasOwn(escapes, escapedCharacter)) {
        value += escapes[escapedCharacter];
      } else if (escapedCharacter === '$' && text[offset] === '{') {
        value += '$';
      } else if (escapedCharacter === 'u') {
        take('{');
        const end = text.indexOf('}', offset);
        const hex = text.slice(offset, end);
        if (end < offset || !/^[0-9a-fA-F]{1,6}$/.test(hex) || Number.parseInt(hex, 16) > 0x10ffff) {
          invalid();
        }
        value += String.fromCodePoint(Number.parseInt(hex, 16));
        offset = end + 1;
      } else {
        invalid();
      }
    }
    return invalid();
  };
  const endLine = () => {
    spaces();
    if (offset < text.length && text[offset] !== '\r' && text[offset] !== '\n') {
      invalid();
    }
    lines();
  };
  const requiredSpace = () => {
    const previous = offset;
    spaces();
    if (previous === offset) {
      invalid();
    }
  };
  lines();
  take('using');
  requiredSpace();
  if (string() !== `./${template}`) {
    invalid();
  }
  endLine();
  const parameters: Record<string, { value: unknown }> = Object.create(null);
  const scalarNames = connection ? connectionStrings : hostStrings;
  const objectName = connection ? 'authentication' : 'additionalAppSettings';
  while (offset < text.length) {
    take('param');
    requiredSpace();
    const start = offset;
    while (offset < text.length && /[A-Za-z0-9_]/.test(text[offset])) {
      offset++;
    }
    const name = text.slice(start, offset);
    const workerCount = !connection && name === 'numberOfWorkers';
    if ((!scalarNames.includes(name) && name !== objectName && !workerCount) || Object.hasOwn(parameters, name)) {
      invalid();
    }
    spaces();
    take('=');
    spaces();
    let value: unknown;
    if (name === objectName) {
      take('json');
      spaces();
      take('(');
      spaces();
      value = readObject(string());
      spaces();
      take(')');
    } else if (workerCount) {
      const start = offset;
      while (offset < text.length && /[0-9]/.test(text[offset])) {
        offset++;
      }
      const literal = text.slice(start, offset);
      if (!/^(?:[1-9][0-9]?|100)$/.test(literal)) {
        invalid();
      }
      value = Number(literal);
    } else {
      value = string();
    }
    parameters[name] = { value };
    endLine();
  }
  const required = [...scalarNames.filter((name) => !['workspaceResourceId', 'skuCode'].includes(name)), objectName];
  if (required.some((name) => !Object.hasOwn(parameters, name))) {
    invalid();
  }
  return parameters;
}
