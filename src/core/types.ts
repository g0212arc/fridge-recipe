/** アプリ内で受け渡すデータ構造。 */

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  /** "YYYY-MM-DD"。未設定なら null。 */
  expiresOn: string | null;
  addedOn: string;
}

export interface Recipe {
  id: string;
  title: string;
  materials: string[];
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
