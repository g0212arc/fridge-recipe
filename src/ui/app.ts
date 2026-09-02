/** 画面まわり。2つのタブ（冷蔵庫 / レシピ）を組み立てる。 */

import { Matcher, groupByMissing, type MatchResult } from '../core/matching';
import { searchLinks } from '../core/links';
import { IngredientIndex, loadDefaultSeasonings } from '../core/normalize';
import { builtinRecipes, parseImportedRecipes } from '../core/recipes';
import { CATEGORIES, daysLeft, type InventoryItem, type Recipe, type Settings } from '../core/types';
import { $, el, toast } from './dom';
import * as store from './storage';

const index = IngredientIndex.load();

/** 「ちょい足し」の見出しを最初から出す数。残りはボタンで開く。 */
const VISIBLE_GROUPS = 12;

interface State {
  items: InventoryItem[];
  settings: Settings;
  imported: Recipe[];
}

const state: State = {
  items: store.loadItems(),
  settings: store.loadSettings(),
  imported: store.loadImportedRecipes(),
};

function allRecipes(): Recipe[] {
  return [...state.imported, ...builtinRecipes()];
}

// ---- タブ ---------------------------------------------------------------

function setupTabs(): void {
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('.tab')];
  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      for (const t of tabs) {
        const active = t === tab;
        t.classList.toggle('is-active', active);
        t.setAttribute('aria-selected', String(active));
      }
      for (const panel of document.querySelectorAll('.panel')) {
        panel.classList.toggle('is-active', panel.id === `panel-${tab.dataset.tab}`);
      }
      if (tab.dataset.tab === 'recipes') renderSuggestions();
      window.scrollTo({ top: 0 });
    });
  }
}

// ---- 冷蔵庫タブ ---------------------------------------------------------

function expiryPill(left: number | null): HTMLElement | null {
  if (left === null) return null;
  if (left < 0) return el('span', { className: 'pill over', textContent: `期限切れ ${-left}日` });
  if (left === 0) return el('span', { className: 'pill over', textContent: '今日まで' });
  if (left <= 3) return el('span', { className: 'pill soon', textContent: `あと${left}日` });
  return el('span', { className: 'pill', textContent: `あと${left}日` });
}

function renderInventory(): void {
  const badge = $('#tab-badge');
  badge.textContent = String(state.items.length);
  badge.hidden = state.items.length === 0;

  const box = $('#inventory');
  box.replaceChildren();

  if (state.items.length === 0) {
    box.append(
      el('p', {
        className: 'empty',
        textContent: '冷蔵庫が空です。上のフォームから食材を追加してください。',
      }),
    );
    return;
  }

  const now = new Date();
  const sorted = [...state.items].sort((a, b) => {
    const la = daysLeft(a, now);
    const lb = daysLeft(b, now);
    if (la === null && lb === null) return 0;
    if (la === null) return 1;
    if (lb === null) return -1;
    return la - lb;
  });

  for (const category of CATEGORIES) {
    const items = sorted.filter((i) => i.category === category);
    if (items.length === 0) continue;

    const group = el('div', { className: 'cat-group' }, [
      el('h2', { className: 'cat-title', textContent: category }),
    ]);

    for (const item of items) {
      const remove = el('button', {
        className: 'icon-btn',
        type: 'button',
        title: `${item.name} を削除`,
        textContent: '✕',
      });
      remove.addEventListener('click', () => {
        state.items = store.removeItem(state.items, item.id);
        renderInventory();
      });

      group.append(
        el('div', { className: 'item' }, [
          el('span', { className: 'item-name', textContent: item.name }),
          expiryPill(daysLeft(item, now)),
          remove,
        ]),
      );
    }
    box.append(group);
  }
}

function setupAddForm(): void {
  const select = $<HTMLSelectElement>('#f-category');
  for (const c of CATEGORIES) select.append(el('option', { value: c, textContent: c }));
  select.value = '野菜';

  $<HTMLDataListElement>('#ingredient-list').replaceChildren(
    ...index
      .knownCanons()
      .map((canon) => index.display(canon))
      .filter((name) => !state.settings.seasonings.includes(name))
      .sort((a, b) => a.localeCompare(b, 'ja'))
      .map((name) => el('option', { value: name })),
  );

  $<HTMLFormElement>('#add-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const nameInput = $<HTMLInputElement>('#f-name');
    const expiresInput = $<HTMLInputElement>('#f-expires');
    const name = nameInput.value.trim();
    if (!name) return;

    state.items = store.addItem(state.items, name, select.value, expiresInput.value || null);
    nameInput.value = '';
    expiresInput.value = '';
    nameInput.focus();
    renderInventory();
  });
}

// ---- 常備品の設定 -------------------------------------------------------

function renderSettings(): void {
  const chips = $('#seasoning-chips');
  chips.replaceChildren();

  for (const name of state.settings.seasonings) {
    const remove = el('button', { type: 'button', title: `${name} を外す`, textContent: '✕' });
    remove.addEventListener('click', () => {
      state.settings.seasonings = state.settings.seasonings.filter((s) => s !== name);
      store.saveSettings(state.settings);
      renderSettings();
    });
    chips.append(el('span', { className: 'chip' }, [name, remove]));
  }

  const slider = $<HTMLInputElement>('#max-missing');
  slider.value = String(state.settings.maxMissing);
  $('#max-missing-out').textContent = String(state.settings.maxMissing);
}

function setupSettings(): void {
  $<HTMLFormElement>('#seasoning-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $<HTMLInputElement>('#s-name');
    const name = input.value.trim();
    input.value = '';
    if (!name || state.settings.seasonings.includes(name)) return;

    state.settings.seasonings = [...state.settings.seasonings, name];
    store.saveSettings(state.settings);
    renderSettings();
  });

  const slider = $<HTMLInputElement>('#max-missing');
  slider.addEventListener('input', () => {
    $('#max-missing-out').textContent = slider.value;
  });
  slider.addEventListener('change', () => {
    state.settings.maxMissing = Number(slider.value);
    store.saveSettings(state.settings);
  });

  $('#reset-seasonings').addEventListener('click', () => {
    // 保存済みの値ではなく、辞書が持っている初期値に戻す
    state.settings = { ...state.settings, seasonings: loadDefaultSeasonings() };
    store.saveSettings(state.settings);
    renderSettings();
    toast('常備品を初期状態に戻しました');
  });
}

// ---- レシピタブ ---------------------------------------------------------

function recipeCard(match: MatchResult): HTMLElement {
  const { recipe } = match;
  const query = [...match.used.map((i) => i.name), ...match.missing].slice(0, 3).join(' ');
  const fallbackUrl = `https://cookpad.com/search/${encodeURIComponent(`${recipe.title} ${query}`.trim())}`;

  const title = el('a', {
    href: recipe.url || fallbackUrl,
    target: '_blank',
    rel: 'noopener',
    textContent: recipe.title,
  });

  const tags = el('div', { className: 'tags' });
  for (const name of match.missing) {
    tags.append(el('span', { className: 'tag miss', textContent: `＋${name}` }));
  }
  for (const item of match.used) {
    tags.append(el('span', { className: 'tag', textContent: item.name }));
  }

  const meta = [recipe.indication, recipe.cost, recipe.category].filter(Boolean).join(' ・ ');
  const card = el('div', { className: 'card' });
  if (recipe.image) card.append(el('img', { src: recipe.image, alt: '', loading: 'lazy' }));
  card.append(
    el('div', { className: 'card-body' }, [
      el('h3', {}, [title]),
      meta ? el('p', { className: 'meta', textContent: meta }) : null,
      tags,
    ]),
  );
  return card;
}

function renderSuggestions(): void {
  const recipes = allRecipes();
  $('#catalog-count').textContent = String(recipes.length);
  $('#catalog-detail').textContent =
    state.imported.length > 0
      ? `同梱 ${recipes.length - state.imported.length} 件 / 取り込み ${state.imported.length} 件`
      : '同梱のレシピ集から';
  $('#rakuten-credit').hidden = state.imported.length === 0;

  const box = $('#suggestions');
  box.replaceChildren();

  if (state.items.length === 0) {
    box.append(
      el('p', { className: 'empty', textContent: 'まず「冷蔵庫」タブで食材を登録してください。' }),
    );
    return;
  }

  const matcher = new Matcher(index, state.settings.seasonings);
  const { ready, almost } = matcher.suggest(recipes, state.items, {
    maxMissing: state.settings.maxMissing,
  });

  box.append(
    el('h2', { className: 'section-title' }, [
      '🍳 いま作れる',
      el('span', { className: 'count', textContent: `${ready.length} 品` }),
    ]),
  );
  if (ready.length === 0) {
    box.append(
      el('p', {
        className: 'empty',
        textContent: '足りている献立はまだありません。下の「ちょい足し」を見てみてください。',
      }),
    );
  } else {
    for (const match of ready) box.append(recipeCard(match));
  }

  const groups = groupByMissing(almost, index);
  box.append(
    el('h2', { className: 'section-title' }, [
      '🛒 ちょい足しで作れる',
      el('span', { className: 'count', textContent: `${almost.length} 品` }),
    ]),
  );
  if (groups.length === 0) {
    box.append(el('p', { className: 'empty', textContent: '該当なし。' }));
  } else {
    // 全部を開いて並べると画面が果てしなく長くなるので、見出しだけ並べて畳んでおく。
    // 「まず何をひとつ買うか」を選ぶ画面として、このほうが見渡しやすい。
    const renderGroup = (group: (typeof groups)[number], open: boolean): HTMLElement => {
      const details = el('details', { className: 'miss-group', open }, [
        el('summary', { className: 'miss-head' }, [
          el('span', { className: 'miss-label', textContent: group.label }),
          'を買うと',
          el('span', { className: 'count', textContent: `あと ${group.recipes.length} 品` }),
        ]),
      ]);
      for (const match of group.recipes) details.append(recipeCard(match));
      return details;
    };

    const head = groups.slice(0, VISIBLE_GROUPS);
    const tail = groups.slice(VISIBLE_GROUPS);
    head.forEach((group, i) => box.append(renderGroup(group, i === 0)));

    if (tail.length > 0) {
      // 残りは「あと1品」の見出しが並びがちなので、畳んでおいて必要なときだけ出す
      const rest = el('div', { className: 'rest-groups', hidden: true });
      for (const group of tail) rest.append(renderGroup(group, false));

      const more = el('button', {
        type: 'button',
        className: 'ghost more-btn',
        textContent: `ほかに ${tail.length} 通りの買い足し方を見る`,
      });
      more.addEventListener('click', () => {
        rest.hidden = !rest.hidden;
        more.textContent = rest.hidden
          ? `ほかに ${tail.length} 通りの買い足し方を見る`
          : '閉じる';
      });
      box.append(more, rest);
    }
  }

  const links = searchLinks(state.items.map((i) => i.name));
  box.append(el('h2', { className: 'section-title' }, ['🔎 各サイトで探す']));
  if (links.query) {
    box.append(el('p', { className: 'query', textContent: `検索キーワード：${links.query}` }));
    const grid = el('div', { className: 'links' });
    for (const site of links.sites) {
      grid.append(
        el('a', { className: 'link-card', href: site.url, target: '_blank', rel: 'noopener' }, [
          el('strong', { textContent: site.name }),
          el('span', { textContent: site.note }),
        ]),
      );
    }
    box.append(grid);
  }
}

// ---- レシピの取り込み ---------------------------------------------------

function setupImport(): void {
  const input = $<HTMLInputElement>('#import-file');

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    try {
      const recipes = parseImportedRecipes(await file.text());
      if (!store.saveImportedRecipes(recipes)) {
        toast('レシピが多すぎて保存できませんでした。件数を減らしてください', true);
        return;
      }
      state.imported = recipes;
      renderSuggestions();
      toast(`${recipes.length} 件のレシピを取り込みました`);
    } catch (error) {
      toast(error instanceof Error ? error.message : '読み込みに失敗しました', true);
    }
  });

  $('#clear-import').addEventListener('click', () => {
    store.clearImportedRecipes();
    state.imported = [];
    renderSuggestions();
    toast('取り込んだレシピを消しました');
  });
}

// ---- 起動 ---------------------------------------------------------------

export function start(): void {
  setupTabs();
  setupAddForm();
  setupSettings();
  setupImport();
  renderInventory();
  renderSettings();
  renderSuggestions();
}
