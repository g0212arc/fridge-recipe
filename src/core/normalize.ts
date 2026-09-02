/**
 * 食材名の正規化と、同義語・総称の解決。
 *
 * レシピの材料名は `"☆醤油"` `"玉ねぎ 1/2個"` `"豚バラ肉（薄切り）"` のように
 * 揺れるので、比較する前にここで表記を揃える。
 */

import ingredientsJson from '../data/ingredients.json';
import genericsJson from '../data/generics.json';
import seasoningsJson from '../data/seasonings.json';

/** 材料名の先頭につく装飾記号（☆印・○印などのグループ分け記号）。 */
const LEADING_MARKERS = '○●◎☆★△▲▽▼□■◇◆※・＊*〇◯♦♢〜~-−ー–—+＋:：/／|｜.,、。 　';

/** 括弧とその中身（「玉ねぎ（中）」→「玉ねぎ」）。 */
const BRACKETS = /[（(【〔[{〈《『「][^）)】〕\]}〉》』」]*[）)】〕\]}〉》』」]?/g;

/** 分量の始まり。ここより後ろは全部捨てる（「玉ねぎ 1/2個」→「玉ねぎ」）。 */
const QUANTITY =
  /[\s　]*(?:[0-9]+|[½¼¾⅓⅔⅛]|大さじ|小さじ|カップ|適量|適宜|少々|少量|お好み|ひとつまみ|一つまみ|各適量|お好きなだけ|適当).*$/;

/** 末尾に残りがちな飾り。 */
const TRAILING = /(?:など|等|お好みで|好みで|用)$/;

function stripMarkers(text: string, from: 'both' | 'end' = 'both'): string {
  let start = 0;
  let end = text.length;
  if (from === 'both') {
    while (start < end && LEADING_MARKERS.includes(text[start]!)) start += 1;
  }
  while (end > start && LEADING_MARKERS.includes(text[end - 1]!)) end -= 1;
  return text.slice(start, end);
}

/** カタカナをひらがなに寄せる。長音符「ー」はそのまま残す。 */
function kataToHira(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    out += code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : ch;
  }
  return out;
}

function trimNoise(text: string): string {
  let s = text.normalize('NFKC').trim();
  s = stripMarkers(s).trim();
  s = s.replace(BRACKETS, '');

  // 「7味唐辛子」のように数字始まりの食材で全部消えたら、分量除去は諦める
  const stripped = s.replace(QUANTITY, '').trim();
  if (stripped) s = stripped;

  return s.replace(TRAILING, '').trim();
}

const normalizeCache = new Map<string, string>();

/** 材料名・食材名を比較用の文字列に揃える。 */
export function normalize(text: string): string {
  if (!text) return '';
  const cached = normalizeCache.get(text);
  if (cached !== undefined) return cached;

  const result = stripMarkers(kataToHira(trimNoise(text)).replace(/[\s　]+/g, ''), 'both');
  normalizeCache.set(text, result);
  return result;
}

const prettyCache = new Map<string, string>();

/**
 * 画面に出すための整形。`normalize` と違いカタカナはカタカナのまま残す。
 *
 * `"☆豚ロース肉（薄切り）2枚"` → `"豚ロース肉"`
 */
export function pretty(text: string): string {
  if (!text) return '';
  const cached = prettyCache.get(text);
  if (cached !== undefined) return cached;

  const result = stripMarkers(trimNoise(text).replace(/[\s　]+/g, ''), 'both') || text.trim();
  prettyCache.set(text, result);
  return result;
}

interface GenericSpec {
  include?: string[];
  exclude?: string[];
  groupLabel?: boolean;
}

interface Generic {
  name: string;
  include: string[];
  exclude: string[];
  groupLabel: boolean;
}

function dropComment<T>(raw: Record<string, T>): Record<string, T> {
  const { _comment: _ignored, ...rest } = raw as Record<string, T> & { _comment?: unknown };
  return rest as Record<string, T>;
}

function contains(generic: Generic, canon: string): boolean {
  if (generic.exclude.some((ng) => canon.includes(ng))) return false;
  return generic.include.some((ok) => canon.includes(ok));
}

/**
 * 同義語辞書と総称テーブルをまとめたもの。
 *
 * 判定の要は「辞書に載っている語同士は部分一致で結ばない」こと。
 * これが無いと『ねぎ』が『玉ねぎ』を満たしてしまう。
 */
export class IngredientIndex {
  private readonly alias = new Map<string, string>();
  private readonly displayName = new Map<string, string>();
  private readonly generics: Generic[];
  /** 部分一致の解決に使う別名一覧（長い順。2文字未満は誤爆するので使わない）。 */
  private readonly resolvable: Array<[string, string]>;
  private readonly resolveCache = new Map<string, string>();

  constructor(synonyms: Record<string, string[]>, generics: Record<string, GenericSpec>) {
    for (const [display, aliases] of Object.entries(synonyms)) {
      const canon = normalize(display);
      this.alias.set(canon, canon);
      this.displayName.set(canon, display);
      for (const a of aliases) this.alias.set(normalize(a), canon);
    }

    this.resolvable = [...this.alias.entries()]
      .filter(([a]) => a.length >= 2)
      .sort((x, y) => y[0].length - x[0].length);

    this.generics = Object.entries(generics).map(([name, spec]) => ({
      name: normalize(name),
      include: (spec.include ?? []).map(normalize),
      exclude: (spec.exclude ?? []).map(normalize),
      groupLabel: Boolean(spec.groupLabel),
    }));
  }

  static load(): IngredientIndex {
    return new IngredientIndex(
      dropComment(ingredientsJson as unknown as Record<string, string[]>),
      dropComment(genericsJson as unknown as Record<string, GenericSpec>),
    );
  }

  /**
   * 表記ゆれを吸収した代表名（正規化済み）を返す。
   *
   * 完全一致で引けないときは、辞書の語が部分文字列として含まれていないかを調べ、
   * **一番長く一致したもの**に寄せる。『濃口しょうゆ』→『醤油』、
   * 『玉ねぎみじん切り』→『玉ねぎ』のように、辞書に無い言い回しでも代表名に落ちる。
   */
  canonical(text: string): string {
    const norm = normalize(text);
    const exact = this.alias.get(norm);
    if (exact !== undefined) return exact;
    if (!norm) return norm;

    const cached = this.resolveCache.get(norm);
    if (cached !== undefined) return cached;

    let resolved = norm;
    for (const [aliasText, canon] of this.resolvable) {
      if (norm.includes(aliasText)) {
        resolved = canon;
        break;
      }
    }
    this.resolveCache.set(norm, resolved);
    return resolved;
  }

  /** 代表名を人が読む表記に戻す。辞書に無ければそのまま。 */
  display(canon: string): string {
    return this.displayName.get(canon) ?? canon;
  }

  isKnown(canon: string): boolean {
    return this.displayName.has(canon);
  }

  knownCanons(): string[] {
    return [...this.displayName.keys()];
  }

  genericsOf(canon: string): Set<string> {
    return new Set(this.generics.filter((g) => contains(g, canon)).map((g) => g.name));
  }

  /**
   * 買い物の見出しにまとめる単位。
   *
   * 『豚こま切れ肉』と『豚ロース肉』は、どちらも「豚肉を買うと」に入れたい。
   * まとめて嬉しい総称にだけ `groupLabel` を立ててある。
   */
  groupKey(canon: string): string {
    for (const generic of this.generics) {
      if (generic.groupLabel && contains(generic, canon)) return generic.name;
    }
    return canon;
  }

  /** 冷蔵庫の食材 `have` がレシピの材料 `need` を満たすか。引数はどちらも生の表記でよい。 */
  covers(have: string, need: string): boolean {
    const h = this.canonical(have);
    const n = this.canonical(need);
    if (!h || !n) return false;
    if (h === n) return true;

    // 総称と個別の関係。片方がその総称そのものであるときだけ結ぶ。
    // （『豚バラ肉』と『豚ひき肉』のような兄弟同士は結ばない）
    const hg = this.genericsOf(h);
    const ng = this.genericsOf(n);
    const shared = [...hg].filter((g) => ng.has(g));
    if (shared.length > 0 && (shared.includes(h) || shared.includes(n))) return true;

    // 辞書に載っている語同士なら、ここまでで結ばれない＝別物と確定させる
    if (this.isKnown(h) && this.isKnown(n)) return false;

    // 辞書に無い語は部分一致で救う（『豆腐』⊃『絹ごし豆腐』）
    if (h.length >= 2 && n.includes(h)) return true;
    if (n.length >= 2 && h.includes(n)) return true;
    return false;
  }
}

export function loadDefaultSeasonings(): string[] {
  return [...(seasoningsJson as { default: string[] }).default];
}
