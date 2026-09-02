/**
 * 各レシピサイトの検索URLを組み立てる。
 *
 * クックパッドと味の素パークは公開APIが無く、規約上も自動取得ができないので、
 * 「冷蔵庫の中身から検索クエリを作って、利用者のブラウザで開く」形にする。
 * ここでやるのはURL文字列を作ることだけで、こちらからアクセスはしない。
 */

export interface RecipeSite {
  key: string;
  name: string;
  note: string;
  url: (query: string) => string;
}

export const SITES: readonly RecipeSite[] = [
  {
    key: 'cookpad',
    name: 'クックパッド',
    note: '投稿数が最多。家庭のアレンジを探すなら',
    url: (q) => `https://cookpad.com/search/${encodeURIComponent(q)}`,
  },
  {
    key: 'ajinomoto',
    name: '味の素パーク',
    note: '分量と手順が丁寧。失敗しにくい',
    url: (q) => `https://park.ajinomoto.co.jp/search/recipe/?word=${encodeURIComponent(q)}`,
  },
  {
    key: 'rakuten',
    name: '楽天レシピ',
    note: '材料から探しやすい',
    url: (q) => `https://recipe.rakuten.co.jp/search/${encodeURIComponent(q)}/`,
  },
  {
    key: 'kurashiru',
    name: 'クラシル',
    note: '動画で手順を見たいとき',
    url: (q) => `https://www.kurashiru.com/search?query=${encodeURIComponent(q)}`,
  },
  {
    key: 'delish',
    name: 'DELISH KITCHEN',
    note: '同じく動画つき',
    url: (q) => `https://delishkitchen.tv/search?q=${encodeURIComponent(q)}`,
  },
  {
    key: 'kyounoryouri',
    name: 'みんなのきょうの料理',
    note: 'プロのレシピを確実に作りたいとき',
    url: (q) => `https://www.kyounoryouri.jp/search/recipe?keyword=${encodeURIComponent(q)}`,
  },
] as const;

/** 検索キーワード。多すぎるとヒット0件になるので、先頭のいくつかに絞る。 */
export function buildQuery(names: readonly string[], limit = 3): string {
  return names
    .map((n) => n.trim())
    .filter(Boolean)
    .slice(0, limit)
    .join(' ');
}

export interface SearchLinks {
  query: string;
  sites: Array<{ key: string; name: string; note: string; url: string }>;
}

export function searchLinks(names: readonly string[], limit = 3): SearchLinks {
  const query = buildQuery(names, limit);
  if (!query) return { query: '', sites: [] };
  return {
    query,
    sites: SITES.map((s) => ({ key: s.key, name: s.name, note: s.note, url: s.url(query) })),
  };
}
