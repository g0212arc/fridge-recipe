/**
 * 冷蔵庫の中身とレシピの材料を突き合わせる。
 *
 *     レシピの材料 −（冷蔵庫の食材 ＋ 基本調味料）＝ 不足リスト
 *
 * 不足0品なら「いま作れる」、1〜2品なら「ちょい足し」。
 */

import { IngredientIndex, pretty } from './normalize';
import { daysLeft, type InventoryItem, type Recipe } from './types';

/** 賞味期限が近い食材を使うレシピを上に出すための重み。 */
const URGENCY_STEPS: ReadonlyArray<readonly [number, number]> = [
  [0, 40], // 期限切れ・当日
  [1, 30], // 明日まで
  [3, 20], // 3日以内
  [7, 8], // 1週間以内
];

const USED_ITEM_WEIGHT = 10;

export function urgencyBonus(left: number | null): number {
  if (left === null) return 0;
  for (const [limit, bonus] of URGENCY_STEPS) {
    if (left <= limit) return bonus;
  }
  return 0;
}

export interface MatchResult {
  recipe: Recipe;
  used: InventoryItem[];
  /** 表示用の不足食材名。 */
  missing: string[];
  /** 代表名（グルーピング用）。 */
  missingKeys: string[];
  /** 常備扱いで数えなかった材料。 */
  pantry: string[];
  score: number;
}

export interface MissingGroup {
  key: string;
  label: string;
  recipes: MatchResult[];
}

export class Matcher {
  private readonly seasoningCanons: string[];

  constructor(
    private readonly index: IngredientIndex,
    seasonings: readonly string[],
    private readonly today: Date = new Date(),
  ) {
    this.seasoningCanons = seasonings
      .filter((s) => s.trim())
      .map((s) => index.canonical(s));
  }

  /** 基本調味料（常にある前提のもの）か。 */
  isPantry(materialCanon: string): boolean {
    return this.seasoningCanons.some((s) => this.index.covers(s, materialCanon));
  }

  evaluate(recipe: Recipe, items: readonly InventoryItem[]): MatchResult {
    const canonItems = items.map((item) => ({ canon: this.index.canonical(item.name), item }));

    const used = new Map<string, InventoryItem>();
    const missingKeys: string[] = [];
    const missing: string[] = [];
    const pantry: string[] = [];
    const seen = new Set<string>();

    for (const raw of recipe.materials) {
      const canon = this.index.canonical(raw);
      if (!canon || seen.has(canon)) continue;
      seen.add(canon);

      const hit = canonItems.find((entry) => this.index.covers(entry.canon, canon));
      if (hit) {
        if (!used.has(hit.item.id)) used.set(hit.item.id, hit.item);
        continue;
      }

      if (this.isPantry(canon)) {
        pantry.push(this.index.isKnown(canon) ? this.index.display(canon) : pretty(raw));
        continue;
      }

      if (!missingKeys.includes(canon)) {
        missingKeys.push(canon);
        // 辞書に無い材料は、ひらがなに崩れた正規化結果ではなく元の表記を見せる
        missing.push(this.index.isKnown(canon) ? this.index.display(canon) : pretty(raw));
      }
    }

    const usedItems = [...used.values()];
    const score =
      USED_ITEM_WEIGHT * usedItems.length +
      usedItems.reduce((sum, item) => sum + urgencyBonus(daysLeft(item, this.today)), 0);

    return { recipe, used: usedItems, missing, missingKeys, pantry, score };
  }

  /** レシピを「いま作れる」「ちょい足し」に仕分けて返す。 */
  suggest(
    recipes: readonly Recipe[],
    items: readonly InventoryItem[],
    { maxMissing = 2, limitReady = 40, limitAlmost = 60 } = {},
  ): { ready: MatchResult[]; almost: MatchResult[] } {
    if (items.length === 0) return { ready: [], almost: [] };

    const ready: MatchResult[] = [];
    const almost: MatchResult[] = [];

    for (const recipe of recipes) {
      const result = this.evaluate(recipe, items);
      // 冷蔵庫の食材をひとつも使わないレシピは提案しない
      if (result.used.length === 0) continue;
      if (result.missingKeys.length === 0) ready.push(result);
      else if (result.missingKeys.length <= maxMissing) almost.push(result);
    }

    ready.sort((a, b) => b.score - a.score || a.recipe.title.localeCompare(b.recipe.title, 'ja'));
    almost.sort(
      (a, b) =>
        a.missingKeys.length - b.missingKeys.length ||
        b.score - a.score ||
        a.recipe.title.localeCompare(b.recipe.title, 'ja'),
    );

    return { ready: ready.slice(0, limitReady), almost: almost.slice(0, limitAlmost) };
  }
}

/**
 * 「たまごを買うと、あと4品作れます」の単位にまとめる。
 *
 * 不足が複数あるレシピは、そのうち最初の1つの見出しに入れる。
 * 『豚こま切れ肉』と『豚ロース肉』のように部位が違うだけのものは
 * `IngredientIndex.groupKey` が『豚肉』へまとめる。ただし中身が1種類しか
 * 無いときは総称に丸めず、元の食材名（『鶏むね肉』）を見出しにする。
 */
export function groupByMissing(
  results: readonly MatchResult[],
  index: IngredientIndex,
): MissingGroup[] {
  const groups = new Map<string, MissingGroup & { labels: Map<string, string> }>();

  for (const result of results) {
    const canon = result.missingKeys[0];
    const label = result.missing[0];
    if (canon === undefined || label === undefined) continue;

    const key = index.groupKey(canon);
    let group = groups.get(key);
    if (!group) {
      group = { key, label, recipes: [], labels: new Map() };
      groups.set(key, group);
    }
    if (!group.labels.has(canon)) group.labels.set(canon, label);
    group.recipes.push(result);
  }

  const out: MissingGroup[] = [];
  for (const [key, group] of groups) {
    const labels = [...group.labels.values()];
    // 1種類しか無いなら総称に丸めない（『鶏肉』ではなく『鶏むね肉』）
    const label = labels.length === 1 ? labels[0]! : index.display(key);
    out.push({ key, label, recipes: group.recipes });
  }

  return out.sort(
    (a, b) => b.recipes.length - a.recipes.length || a.label.localeCompare(b.label, 'ja'),
  );
}
