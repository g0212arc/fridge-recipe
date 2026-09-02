import { describe, expect, it } from 'vitest';
import { Matcher, groupByMissing, urgencyBonus } from '../matching';
import { IngredientIndex, loadDefaultSeasonings } from '../normalize';
import type { InventoryItem, Recipe } from '../types';

const TODAY = new Date(2026, 8, 2); // 2026-09-02
const index = IngredientIndex.load();
const matcher = new Matcher(index, loadDefaultSeasonings(), TODAY);

function item(name: string, days?: number): InventoryItem {
  let expiresOn: string | null = null;
  if (days !== undefined) {
    const d = new Date(TODAY.getTime() + days * 86_400_000);
    expiresOn = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return { id: name, name, category: 'その他', expiresOn, addedOn: '2026-09-02' };
}

const OYAKODON: Recipe = {
  id: 'r1',
  title: '親子丼',
  materials: ['鶏もも肉', '玉ねぎ', '卵', 'ごはん', '☆醤油', '☆みりん', 'だし汁'],
};

describe('evaluate', () => {
  it('不足が無ければ「作れる」', () => {
    const r = matcher.evaluate(OYAKODON, [item('鶏もも肉'), item('玉ねぎ'), item('卵')]);
    expect(r.missing).toEqual([]);
    expect(new Set(r.used.map((i) => i.name))).toEqual(new Set(['鶏もも肉', '玉ねぎ', '卵']));
  });

  it('調味料は不足に数えない', () => {
    const r = matcher.evaluate(OYAKODON, [item('鶏もも肉'), item('玉ねぎ'), item('卵')]);
    expect(r.pantry).toContain('醤油');
    expect(r.pantry).toContain('みりん');
  });

  it('同じ不足食材は1回だけ挙げる', () => {
    const r = matcher.evaluate({ id: 'r2', title: '卵づくし', materials: ['卵', '卵黄', '玉ねぎ'] }, [
      item('玉ねぎ'),
    ]);
    expect(r.missingKeys.filter((k) => k === index.canonical('卵'))).toHaveLength(1);
  });

  it('総称の在庫は個別の材料を満たす', () => {
    const r = matcher.evaluate(
      { id: 'r3', title: '生姜焼き', materials: ['豚ロース肉', '玉ねぎ', '醤油'] },
      [item('豚肉'), item('玉ねぎ')],
    );
    expect(r.missing).toEqual([]);
  });

  it('不足食材の表示は元の表記を保つ', () => {
    const r = matcher.evaluate({ id: 'a', title: 'x', materials: ['豚ロース肉', '玉ねぎ'] }, [
      item('玉ねぎ'),
    ]);
    expect(r.missing).toEqual(['豚ロース肉']); // 「豚ろーす肉」に崩れない
  });

  it('期限が近い食材を使うほどスコアが高い', () => {
    const fresh = matcher.evaluate(OYAKODON, [item('鶏もも肉', 30), item('玉ねぎ'), item('卵')]);
    const urgent = matcher.evaluate(OYAKODON, [item('鶏もも肉', 0), item('玉ねぎ'), item('卵')]);
    expect(urgent.score).toBeGreaterThan(fresh.score);
  });
});

describe('urgencyBonus', () => {
  it.each([
    [-3, 40],
    [0, 40],
    [1, 30],
    [3, 20],
    [7, 8],
    [30, 0],
    [null, 0],
  ])('あと%s日 → %s', (days, expected) => {
    expect(urgencyBonus(days)).toBe(expected);
  });
});

describe('suggest', () => {
  it('作れる／ちょい足しに仕分ける', () => {
    const recipes: Recipe[] = [
      OYAKODON,
      { id: 'r4', title: '肉じゃが', materials: ['豚こま切れ肉', 'じゃがいも', '玉ねぎ', 'にんじん', '醤油'] },
      { id: 'r5', title: '冷奴', materials: ['豆腐', '長ねぎ', '醤油'] },
    ];
    const out = matcher.suggest(recipes, [item('鶏もも肉'), item('玉ねぎ'), item('卵')]);

    expect(out.ready.map((r) => r.recipe.title)).toEqual(['親子丼']);
    // 肉じゃがは不足3品なので落ちる。冷奴は冷蔵庫の食材を使わないので出さない
    expect(out.almost).toEqual([]);
  });

  it('冷蔵庫が空なら何も出さない', () => {
    expect(matcher.suggest([OYAKODON], [])).toEqual({ ready: [], almost: [] });
  });

  it('ちょい足しは不足の少ない順', () => {
    const out = matcher.suggest(
      [
        { id: 'a', title: '不足2', materials: ['玉ねぎ', 'にんじん', 'じゃがいも'] },
        { id: 'b', title: '不足1', materials: ['玉ねぎ', 'にんじん'] },
      ],
      [item('玉ねぎ')],
    );
    expect(out.almost.map((r) => r.recipe.title)).toEqual(['不足1', '不足2']);
  });
});

describe('groupByMissing', () => {
  it('不足食材ごとにまとめ、件数の多い順に並べる', () => {
    const out = matcher.suggest(
      [
        { id: 'a', title: 'オムライス', materials: ['卵', '玉ねぎ', 'ごはん'] },
        { id: 'b', title: 'かき玉スープ', materials: ['卵', '玉ねぎ'] },
        { id: 'c', title: 'ポテトサラダ', materials: ['じゃがいも', '玉ねぎ'] },
      ],
      [item('玉ねぎ')],
    );
    const groups = groupByMissing(out.almost, index);

    expect(groups[0]!.label).toBe('卵');
    expect(groups[0]!.recipes).toHaveLength(2);
    expect(groups.find((g) => g.label === 'じゃがいも')!.recipes).toHaveLength(1);
  });

  it('部位違いの肉は総称にまとめる', () => {
    const out = matcher.suggest(
      [
        { id: 'a', title: '生姜焼き', materials: ['豚ロース肉', '玉ねぎ'] },
        { id: 'b', title: '肉じゃが', materials: ['豚こま切れ肉', '玉ねぎ'] },
      ],
      [item('玉ねぎ')],
    );
    const groups = groupByMissing(out.almost, index);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBe('豚肉');
    expect(groups[0]!.recipes).toHaveLength(2);
  });

  it('1種類しか無いなら総称に丸めない', () => {
    const out = matcher.suggest([{ id: 'a', title: 'チキン南蛮', materials: ['鶏むね肉', '玉ねぎ'] }], [
      item('玉ねぎ'),
    ]);
    expect(groupByMissing(out.almost, index).map((g) => g.label)).toEqual(['鶏むね肉']);
  });
});

describe('常備品の設定', () => {
  it('外すと不足に数えられる', () => {
    const recipe: Recipe = { id: 'x', title: '塩むすび', materials: ['ごはん', '塩'] };
    const withSalt = new Matcher(index, ['塩', 'ごはん'], TODAY);
    const withoutSalt = new Matcher(index, ['ごはん'], TODAY);

    expect(withSalt.evaluate(recipe, [item('ごはん')]).missing).toEqual([]);
    expect(withoutSalt.evaluate(recipe, [item('ごはん')]).missing).toEqual(['塩']);
  });
});
