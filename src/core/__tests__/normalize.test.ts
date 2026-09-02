import { describe, expect, it } from 'vitest';
import { IngredientIndex, normalize, pretty } from '../normalize';

const index = IngredientIndex.load();

describe('normalize', () => {
  it.each([
    ['☆醤油', '醤油'],
    ['●塩コショウ 少々', '塩こしょう'],
    ['玉ねぎ 1/2個', '玉ねぎ'],
    ['豚バラ肉（薄切り）', '豚ばら肉'],
    ['牛乳200ml', '牛乳'],
    ['ﾆﾝｼﾞﾝ', 'にんじん'],
    ['じゃがいも(中)2個', 'じゃがいも'],
    ['サラダ油 大さじ1', 'さらだ油'],
    ['　キャベツ　', 'きゃべつ'],
    ['', ''],
  ])('%s → %s', (raw, expected) => {
    expect(normalize(raw)).toBe(expected);
  });

  it('分量除去で名前が消えてしまう場合は、除去しない', () => {
    expect(normalize('7味唐辛子')).toBe('7味唐辛子');
  });
});

describe('pretty', () => {
  it.each([
    ['☆豚ロース肉（薄切り）2枚', '豚ロース肉'],
    ['ﾆﾝｼﾞﾝ', 'ニンジン'],
    ['玉ねぎ 1/2個', '玉ねぎ'],
  ])('%s → %s（カタカナを保つ）', (raw, expected) => {
    expect(pretty(raw)).toBe(expected);
  });
});

describe('covers', () => {
  it.each([
    // 表記ゆれ
    ['玉ねぎ', 'たまねぎ', true],
    ['にんじん', 'ﾆﾝｼﾞﾝ', true],
    ['キャベツ', 'キャベツ（千切り）', true],
    ['卵', 'たまご 2個', true],
    // 総称 ⊃ 個別
    ['豚肉', '豚バラ肉', true],
    ['鶏肉', '鶏むね肉', true],
    ['しめじ', 'きのこ', true],
    ['豚バラ肉', '豚肉', true],
    // 兄弟同士は結ばない
    ['豚バラ肉', '豚ひき肉', false],
    ['鶏むね肉', '鶏もも肉', false],
    // 辞書に載っている語同士は部分一致させない（無いと ねぎ→玉ねぎ が通る）
    ['ねぎ', '玉ねぎ', false],
    ['長ねぎ', '玉ねぎみじん切り', false],
    ['牛乳', '牛肉', false],
    // 辞書に無い語は部分一致で救う
    ['豆腐', '絹ごし豆腐', true],
    ['長ねぎ', '小口ねぎ', true],
    ['醤油', '☆濃口しょうゆ', true],
    ['だし', 'だし汁', true],
    // 除外条件
    ['鶏肉', '鶏がらスープの素', false],
  ])('%s は %s を満たすか → %s', (have, need, expected) => {
    expect(index.covers(have, need)).toBe(expected);
  });

  it('空文字は何も満たさない', () => {
    expect(index.covers('', '玉ねぎ')).toBe(false);
    expect(index.covers('玉ねぎ', '')).toBe(false);
  });
});

describe('groupKey', () => {
  it('部位違いの肉は総称にまとめる', () => {
    expect(index.groupKey(index.canonical('豚こま切れ肉'))).toBe(index.canonical('豚肉'));
    expect(index.groupKey(index.canonical('豚ロース肉'))).toBe(index.canonical('豚肉'));
    expect(index.groupKey(index.canonical('鶏むね肉'))).toBe(index.canonical('鶏肉'));
  });

  it('それ以外はまとめない', () => {
    // じゃがいもを「いも」にまとめると、かえって分かりにくくなる
    expect(index.groupKey(index.canonical('じゃがいも'))).toBe(index.canonical('じゃがいも'));
    expect(index.groupKey(index.canonical('鮭'))).toBe(index.canonical('鮭'));
    expect(index.groupKey(index.canonical('玉ねぎ'))).toBe(index.canonical('玉ねぎ'));
  });
});
