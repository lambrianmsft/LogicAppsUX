export interface NativeCSharpPath {
  template: string;
  arguments: string[];
}

const invariantCulture = 'global::System.Globalization.CultureInfo.InvariantCulture';
const unsupportedPath = 'Unsupported native C# connector path expression.';

/**
 * Recognizes the SDK's invariant string.Format path contract without evaluating C#.
 * Arguments are opaque source; unsupported lexical forms fail rather than guessing.
 */
export function parseNativeCSharpPath(value: string): NativeCSharpPath | undefined {
  if (!value.trimStart().startsWith('#{')) {
    return undefined;
  }
  const match = /^#\{\s*string\.Format\s*\(([\s\S]*)\)\s*\}$/.exec(value.trim());
  if (!match) {
    throw new Error(unsupportedPath);
  }
  const parts = splitArguments(match[1]);
  if (parts.length < 3 || parts[0] !== invariantCulture || !parts[1].startsWith('"')) {
    throw new Error(unsupportedPath);
  }
  let format: unknown;
  try {
    format = JSON.parse(parts[1]);
  } catch {
    throw new Error(unsupportedPath);
  }
  if (typeof format !== 'string' || !format.startsWith('/') || format.includes('\0')) {
    throw new Error(unsupportedPath);
  }
  const args = parts.slice(2);
  const used = new Set<number>();
  let template = '';
  for (let i = 0; i < format.length; i++) {
    const char = format[i];
    if ((char === '{' || char === '}') && format[i + 1] === char) {
      template += char;
      i++;
    } else if (char === '{') {
      const placeholder = /^\{(\d+)\}/.exec(format.slice(i));
      const index = placeholder ? Number(placeholder[1]) : -1;
      if (!placeholder || !Number.isSafeInteger(index) || index < 0 || index >= args.length) {
        throw new Error(unsupportedPath);
      }
      used.add(index);
      // Opaque markers keep slashes, quotes and commas inside C# arguments out of route matching.
      template += `\0${index}\0`;
      i += placeholder[0].length - 1;
    } else if (char === '}') {
      throw new Error(unsupportedPath);
    } else {
      template += char;
    }
  }
  if (used.size !== args.length) {
    throw new Error(unsupportedPath);
  }
  return { template, arguments: args };
}

/** Matches static route structure and preserves native arguments for parameter display. */
export function matchNativeCSharpPath(path: NativeCSharpPath, route: string): Record<string, string> | undefined {
  const names: string[] = [];
  let pattern = '^';
  let offset = 0;
  for (const match of route.matchAll(/\{([^{}]+)\}/g)) {
    const literal = route.slice(offset, match.index);
    // Multiple named parameters within one segment can have ambiguous boundaries.
    if (names.includes(match[1]) || (names.length > 0 && !literal.includes('/'))) {
      return undefined;
    }
    names.push(match[1]);
    pattern += `${escapeRegex(literal)}([^/]*)`;
    offset = match.index + match[0].length;
  }
  pattern += `${escapeRegex(route.slice(offset))}$`;
  const captures = new RegExp(pattern).exec(path.template);
  if (!captures) {
    return undefined;
  }
  const entries: [string, string][] = [];
  for (let i = 0; i < names.length; i++) {
    const capture = captures[i + 1];
    const tokens = [...capture.matchAll(/\0(\d+)\0/g)];
    if (capture.replace(/\0\d+\0/g, '').includes('\0')) {
      return undefined;
    }
    if (!tokens.length) {
      entries.push([names[i], capture]);
    } else if (tokens.length === 1 && tokens[0][0] === capture) {
      entries.push([names[i], `#{${path.arguments[Number(tokens[0][1])]}}`]);
    } else {
      let partOffset = 0;
      let format = '';
      const args: string[] = [];
      for (const token of tokens) {
        format += `${escapeFormatLiteral(capture.slice(partOffset, token.index))}{${args.length}}`;
        args.push(path.arguments[Number(token[1])]);
        partOffset = token.index + token[0].length;
      }
      format += escapeFormatLiteral(capture.slice(partOffset));
      entries.push([names[i], `#{string.Format(${invariantCulture}, ${JSON.stringify(format)}, ${args.join(', ')})}`]);
    }
  }
  return Object.fromEntries(entries);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeFormatLiteral(value: string): string {
  return value.replace(/[{}]/g, '$&$&');
}

function splitArguments(source: string): string[] {
  const args: string[] = [];
  const stack: string[] = [];
  const closing: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"' || char === "'") {
      if (source.startsWith('"""', i)) {
        throw new Error(unsupportedPath);
      }
      const verbatim = char === '"' && source[i - 1] === '@';
      let ended = false;
      for (i++; i < source.length; i++) {
        if (!verbatim && source[i] === '\\') {
          i++;
        } else if (source[i] === char) {
          if (verbatim && source[i + 1] === '"') {
            i++;
          } else {
            ended = true;
            break;
          }
        } else if (!verbatim && /[\r\n]/.test(source[i])) {
          throw new Error(unsupportedPath);
        }
      }
      if (!ended) {
        throw new Error(unsupportedPath);
      }
    } else if (char === '$' || char === ';' || (char === '/' && /[/*]/.test(source[i + 1] ?? ''))) {
      throw new Error(unsupportedPath);
    } else if (closing[char]) {
      stack.push(closing[char]);
    } else if (')]}'.includes(char)) {
      if (stack.pop() !== char) {
        throw new Error(unsupportedPath);
      }
    } else if (stack.length === 0 && (char === '<' || char === '>')) {
      throw new Error(unsupportedPath);
    } else if (stack.length === 0 && char === ',') {
      args.push(source.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(source.slice(start).trim());
  if (stack.length || args.some((arg) => !arg)) {
    throw new Error(unsupportedPath);
  }
  return args;
}
