/**
 * ブラウザの localStorage への保存。
 *
 * サーバーを持たないので、冷蔵庫の中身も設定も取り込んだレシピも、
 * すべて利用者の端末の中だけに残る。
 */

import { loadDefaultSeasonings } from '../core/normalize';
import type { InventoryItem, Recipe, Settings } from '../core/types';

const PREFIX = 'fridge-recipe:v1:';
const KEY_ITEMS = `${PREFIX}items`;
const KEY_SETTINGS = `${PREFIX}settings`;
const KEY_IMPORTED = `${PREFIX}imported`;

/** localStorage は無効化されていることがある（プライベートモード等）ので必ず包む。 */
function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function loadItems(): InventoryItem[] {
  return read<InventoryItem[]>(KEY_ITEMS, []).filter(
    (i) => i && typeof i.name === 'string' && i.name.trim() !== '',
  );
}

export function saveItems(items: readonly InventoryItem[]): void {
  write(KEY_ITEMS, items);
}

export function addItem(
  items: readonly InventoryItem[],
  name: string,
  category: string,
  expiresOn: string | null,
): InventoryItem[] {
  const next = [
    ...items,
    { id: newId(), name: name.trim(), category: category || 'その他', expiresOn: expiresOn || null, addedOn: today() },
  ];
  saveItems(next);
  return next;
}

export function removeItem(items: readonly InventoryItem[], id: string): InventoryItem[] {
  const next = items.filter((i) => i.id !== id);
  saveItems(next);
  return next;
}

export function loadSettings(): Settings {
  const raw = read<Partial<Settings>>(KEY_SETTINGS, {});
  const seasonings = Array.isArray(raw.seasonings) && raw.seasonings.length > 0
    ? raw.seasonings
    : loadDefaultSeasonings();
  const maxMissing = Number.isFinite(raw.maxMissing) ? Number(raw.maxMissing) : 2;
  return { seasonings, maxMissing: Math.max(1, Math.min(4, maxMissing)) };
}

export function saveSettings(settings: Settings): void {
  write(KEY_SETTINGS, settings);
}

export function loadImportedRecipes(): Recipe[] {
  return read<Recipe[]>(KEY_IMPORTED, []);
}

/**
 * 取り込んだレシピを保存する。localStorage の容量（おおむね5MB）を超えると
 * 書き込みが失敗するので、成否を返して呼び出し側で知らせる。
 */
export function saveImportedRecipes(recipes: readonly Recipe[]): boolean {
  return write(KEY_IMPORTED, recipes);
}

export function clearImportedRecipes(): void {
  try {
    localStorage.removeItem(KEY_IMPORTED);
  } catch {
    /* 消せなくても致命的ではない */
  }
}
