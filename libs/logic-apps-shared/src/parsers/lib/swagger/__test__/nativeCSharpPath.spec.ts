import { describe, expect, it } from 'vitest';
import { matchNativeCSharpPath, parseNativeCSharpPath } from '../nativeCSharpPath';

const formatPath = (format: string, ...args: string[]) =>
  `#{string.Format(global::System.Globalization.CultureInfo.InvariantCulture, ${JSON.stringify(format)}, ${args.join(', ')})}`;
const matchPath = (value: string, route: string) => {
  const parsed = parseNativeCSharpPath(value);
  if (!parsed) {
    throw new Error('Expected a native path fixture');
  }
  return matchNativeCSharpPath(parsed, route);
};

describe('native C# connector paths', () => {
  it('preserves the exact captured weather encoding expression without executing it', () => {
    const value =
      '#{string.Format(global::System.Globalization.CultureInfo.InvariantCulture, "/current/{0}", encodeURIComponent("98058"))}';
    expect(matchPath(value, '/current/{Location}')).toEqual({ Location: '#{encodeURIComponent("98058")}' });
    expect(value).toContain('"/current/{0}"');
  });

  it('handles multiple, embedded, reordered and repeated placeholders', () => {
    const value = formatPath('/items/{1}/pre{0}post/{1}', 'encodeURIComponent(key)', 'encodeURIComponent(group)');
    expect(matchPath(value, '/items/{group}/pre{key}post/{copy}')).toEqual({
      group: '#{encodeURIComponent(group)}',
      key: '#{encodeURIComponent(key)}',
      copy: '#{encodeURIComponent(group)}',
    });
  });

  it('preserves composed parameter values and literal braces as native formatting, not WDL or evaluated text', () => {
    const args = ['encodeURIComponent(first)', 'encodeURIComponent(second)'];
    expect(matchPath(formatPath('/items/prefix{{{0}}}-{1}suffix', ...args), '/items/{id}')).toEqual({
      id: formatPath('prefix{{{0}}}-{1}suffix', ...args),
    });
  });

  it.each([
    'encodeURIComponent(Choose(values["a/b"], Tuple.Create(1, 2), new[] { "x,y", "z" }))',
    'encodeURIComponent(@"a/""b,c")',
    'encodeURIComponent(GetValue(\'/\', "a\\\\b\\"c"))',
    'encodeURIComponent(Choose<string, int>(source))',
  ])('keeps balanced nested argument source opaque: %s', (arg) => {
    expect(matchPath(formatPath('/items/{0}', arg), '/items/{id}')).toEqual({ id: `#{${arg}}` });
  });

  it('does not let a path parameter consume a literal slash or split another placeholder', () => {
    expect(matchPath(formatPath('/items/{0}/tail', 'encodeURIComponent(id)'), '/items/{id}')).toBeUndefined();
    expect(matchPath(formatPath('/items/{0}', 'encodeURIComponent(id)'), '/items/{first}0{second}')).toBeUndefined();
    expect(matchPath(formatPath('/items/{0}', 'encodeURIComponent(id)'), '/items/static')).toBeUndefined();
  });

  it('does not overwrite duplicate named parameters', () => {
    expect(matchPath(formatPath('/items/{0}/{1}', 'a', 'b'), '/items/{id}/{id}')).toBeUndefined();
  });

  it('fails explicitly on nested interpolated C# argument text instead of splitting its inner quotes or commas', () => {
    const serviceBusPath =
      '#{string.Format(global::System.Globalization.CultureInfo.InvariantCulture, "/{0}/sessions/{1}/close", encodeURIComponent(encodeURIComponent(outputs("Source").ToObject<string>().ToUpperInvariant())), encodeURIComponent($"prefix {outputs("Other").ToObject<string>()}"))}';
    expect(() => parseNativeCSharpPath(serviceBusPath)).toThrow('Unsupported native C# connector path expression');
  });

  it.each(['/current/98058', "/current/@{encodeURIComponent('98058')}", "@{variables('path')}"])(
    'leaves ordinary literal and WDL paths to the existing parser: %s',
    (value) => {
      expect(parseNativeCSharpPath(value)).toBeUndefined();
    }
  );

  it.each([
    '#{BuildPath()}',
    '#{string.Format(otherCulture, "/items/{0}", id)}',
    '#{string.Format(global::System.Globalization.CultureInfo.InvariantCulture, path, id)}',
    '#{string.Format(global::System.Globalization.CultureInfo.InvariantCulture, "/items/{0}", id)}suffix',
    formatPath('/items/{1}', 'id'),
    formatPath('/items/{0:D2}', 'id'),
    formatPath('/items/{0,2}', 'id'),
    formatPath('/items/{', 'id'),
    formatPath('/items/{0}}', 'id'),
    formatPath('/items/{0}', 'id', 'unused'),
    formatPath('/items/{0}', ''),
    formatPath('/items/{0}', 'encodeURIComponent(value]'),
    formatPath('/items/{0}', 'encodeURIComponent("unterminated)'),
    formatPath('/items/{0}', '$"{value}"'),
    formatPath('/items/{0}', '"""raw"""'),
    formatPath('/items/{0}', 'Get<string, int>()'),
    formatPath('/items/{0}', 'id /* comment */'),
    formatPath('/items/{0}', 'id; other'),
    formatPath('/items/\0{0}', 'id'),
  ])('rejects unsupported or malformed shapes instead of guessing: %s', (value) => {
    expect(() => parseNativeCSharpPath(value)).toThrow('Unsupported native C# connector path expression');
  });
});
