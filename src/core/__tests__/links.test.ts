import { describe, expect, it } from 'vitest';
import { SITES, buildQuery, searchLinks } from '../links';

describe('buildQuery', () => {
  it('キーワードは3つまでに絞る', () => {
    expect(buildQuery(['鶏肉', '玉ねぎ', '卵', 'にんじん'])).toBe('鶏肉 玉ねぎ 卵');
  });

  it('空文字は飛ばす', () => {
    expect(buildQuery(['', '  ', '卵'])).toBe('卵');
  });
});

describe('searchLinks', () => {
  it('食材が無ければ空', () => {
    expect(searchLinks([])).toEqual({ query: '', sites: [] });
  });

  it('全サイトぶんのURLを作る', () => {
    const links = searchLinks(['鶏肉', '玉ねぎ']);
    expect(links.sites).toHaveLength(SITES.length);
    expect(links.sites.every((s) => s.url.startsWith('https://'))).toBe(true);
  });

  it('クックパッドはパスにキーワードを載せる', () => {
    const cookpad = searchLinks(['鶏肉', '玉ねぎ']).sites.find((s) => s.key === 'cookpad')!;
    expect(decodeURIComponent(new URL(cookpad.url).pathname)).toBe('/search/鶏肉 玉ねぎ');
  });

  it('味の素パークは word パラメータを使う', () => {
    const ajinomoto = searchLinks(['鶏肉', '玉ねぎ']).sites.find((s) => s.key === 'ajinomoto')!;
    expect(new URL(ajinomoto.url).searchParams.get('word')).toBe('鶏肉 玉ねぎ');
  });
});
