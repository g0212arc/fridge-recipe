/** 同梱のレシピ集と、利用者が取り込んだレシピの読み込み。 */

import recipesJson from '../data/recipes.json';
import type { Recipe } from './types';

interface RawRecipeFile {
  recipes: Recipe[];
}

/** リポジトリに同梱された、配布自由なレシピ集。 */
export function builtinRecipes(): Recipe[] {
  return (recipesJson as unknown as RawRecipeFile).recipes.map((r) => ({ ...r, source: 'builtin' }));
}

/**
 * 取り込んだJSONをレシピとして読む。壊れた行は黙って捨てる。
 *
 * `tools/fetch_rakuten.py` が書き出したファイルを想定しているが、
 * 形さえ合っていれば手書きのファイルでも読める。
 */
export function parseImportedRecipes(text: string): Recipe[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('JSONとして読めませんでした');
  }

  const rows = Array.isArray(parsed)
    ? parsed
    : ((parsed as { recipes?: unknown })?.recipes ?? null);
  if (!Array.isArray(rows)) throw new Error('recipes の配列が見つかりませんでした');

  const out: Recipe[] = [];
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    const r = row as Partial<Recipe>;
    const materials = Array.isArray(r.materials)
      ? r.materials.filter((m): m is string => typeof m === 'string' && m.trim() !== '')
      : [];
    if (!r.id || !r.title || materials.length === 0) continue;
    out.push({
      id: String(r.id),
      title: String(r.title),
      materials,
      indication: r.indication ? String(r.indication) : undefined,
      cost: r.cost ? String(r.cost) : undefined,
      category: r.category ? String(r.category) : undefined,
      url: r.url ? String(r.url) : null,
      image: r.image ? String(r.image) : null,
      source: 'rakuten',
    });
  }
  if (out.length === 0) throw new Error('読み込めるレシピがありませんでした');
  return out;
}
