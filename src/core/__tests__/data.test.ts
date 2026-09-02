/** 同梱データの健全性チェック。辞書を編集したときの事故を早く見つけるためのもの。 */

import { describe, expect, it } from 'vitest';
import { Matcher } from '../matching';
import { IngredientIndex, loadDefaultSeasonings, pretty } from '../normalize';
import { builtinRecipes, parseImportedRecipes } from '../recipes';

const index = IngredientIndex.load();
const matcher = new Matcher(index, loadDefaultSeasonings());
const recipes = builtinRecipes();

describe('同梱レシピ集', () => {
  it('十分な数がある', () => {
    expect(recipes.length).toBeGreaterThanOrEqual(150);
  });

  it('IDとタイトルが重複していない', () => {
    expect(new Set(recipes.map((r) => r.id)).size).toBe(recipes.length);
    expect(new Set(recipes.map((r) => r.title)).size).toBe(recipes.length);
  });

  it('材料が空のレシピが無い', () => {
    expect(recipes.filter((r) => r.materials.length === 0)).toEqual([]);
  });

  it('常備品だけで構成されたレシピが無い（提案に出てこないので）', () => {
    const pantryOnly = recipes.filter((r) =>
      r.materials.every((m) => matcher.isPantry(index.canonical(m))),
    );
    expect(pantryOnly.map((r) => r.title)).toEqual([]);
  });

  it('材料名が正規化で消えない', () => {
    const vanished = recipes.flatMap((r) =>
      r.materials.filter((m) => index.canonical(m) === '').map((m) => `${r.title}: ${m}`),
    );
    expect(vanished).toEqual([]);
  });

  it('材料の表示名がひらがなに崩れない', () => {
    // 辞書に無い材料は pretty() で元の表記を出すので、カタカナ・漢字が保たれる
    const broken = recipes.flatMap((r) =>
      r.materials
        .map((m) => ({ raw: pretty(m), shown: index.isKnown(index.canonical(m)) ? index.display(index.canonical(m)) : pretty(m) }))
        .filter((x) => x.shown !== x.raw && !index.isKnown(index.canonical(x.raw)))
        .map((x) => `${r.title}: ${x.raw} → ${x.shown}`),
    );
    expect(broken).toEqual([]);
  });
});

describe('辞書', () => {
  it('代表名が十分にある', () => {
    expect(index.knownCanons().length).toBeGreaterThanOrEqual(140);
  });

  it('部位違いを代表名に足しても、兄弟同士は結ばれないまま', () => {
    expect(index.covers('豚バラ肉', '豚ひき肉')).toBe(false);
    expect(index.covers('豚こま切れ肉', '豚ロース肉')).toBe(false);
    expect(index.covers('鶏ひき肉', '豚ひき肉')).toBe(false);
    // 総称との関係は保たれる
    expect(index.covers('豚肉', '豚こま切れ肉')).toBe(true);
    expect(index.covers('ひき肉', '豚ひき肉')).toBe(true);
  });
});

describe('parseImportedRecipes', () => {
  it('recipes 配列を読む', () => {
    const out = parseImportedRecipes(
      JSON.stringify({ recipes: [{ id: 'a', title: '親子丼', materials: ['卵'] }] }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.source).toBe('rakuten');
  });

  it('裸の配列も読む', () => {
    const out = parseImportedRecipes(JSON.stringify([{ id: 'a', title: 'x', materials: ['卵'] }]));
    expect(out).toHaveLength(1);
  });

  it('壊れた行は捨てる', () => {
    const out = parseImportedRecipes(
      JSON.stringify({
        recipes: [
          { id: 'a', title: 'ok', materials: ['卵'] },
          { id: '', title: 'IDなし', materials: ['卵'] },
          { id: 'c', title: '材料なし', materials: [] },
          null,
        ],
      }),
    );
    expect(out.map((r) => r.title)).toEqual(['ok']);
  });

  it.each([
    ['これはJSONではない', 'JSONとして読めませんでした'],
    ['{"foo": 1}', 'recipes の配列が見つかりませんでした'],
    ['{"recipes": []}', '読み込めるレシピがありませんでした'],
  ])('%s は分かるエラーになる', (text, message) => {
    expect(() => parseImportedRecipes(text)).toThrow(message);
  });
});
