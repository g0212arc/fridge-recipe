/** アプリ内で受け渡すデータ構造。 */

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  /** "YYYY-MM-DD"。未設定なら null。 */
  expiresOn: string | null;
  addedOn: string;
}

/**
 * レシピの材料ひとつ。
 *
 * 同梱レシピは分量つきのオブジェクト、取り込んだレシピは
 * `"玉ねぎ 1/2個"` のような1本の文字列で来る。どちらも受け取れるようにしてある。
 */
export type Material = string | { name: string; amount?: string };

/** 在庫との突き合わせに使う名前。 */
export function materialName(material: Material): string {
  return typeof material === 'string' ? material : material.name;
}

/** 表示にだけ使う分量。文字列で来た材料には分量が無い。 */
export function materialAmount(material: Material): string {
  return typeof material === 'string' ? '' : (material.amount ?? '');
}

export interface Recipe {
  id: string;
  title: string;
  materials: Material[];
  /** 何人分か。同梱レシピにだけある。 */
  servings?: string;
  /** 作り方。同梱レシピにだけある。取り込んだレシピは元のサイトへ。 */
  steps?: string[];
  /** 調理時間の目安。 */
  indication?: string;
  /** 費用の目安。 */
  cost?: string;
  category?: string;
  /** どこから来たレシピか。builtin=同梱、rakuten=各自が取り込んだもの。 */
  source?: 'builtin' | 'rakuten';
  url?: string | null;
  image?: string | null;
}

export interface Settings {
  seasonings: string[];
  maxMissing: number;
}

export const CATEGORIES = ['野菜', '肉・魚', '卵・乳製品', '主食', 'その他'] as const;
export type Category = (typeof CATEGORIES)[number];

/** 賞味期限まであと何日か。期限未設定なら null。 */
export function daysLeft(item: InventoryItem, today: Date): number | null {
  if (!item.expiresOn) return null;
  const target = new Date(`${item.expiresOn}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target.getTime() - base.getTime()) / 86_400_000);
}
