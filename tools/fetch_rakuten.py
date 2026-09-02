#!/usr/bin/env python3
"""楽天レシピAPIからレシピを集めて、アプリに読み込ませる JSON を書き出す。

つくった JSON は「レシピを増やす」から読み込む。取り込んだデータは
あなたのブラウザの中だけに残る。

    # アプリIDを取得して環境変数に入れる（https://webservice.rakuten.co.jp/）
    export RAKUTEN_APPLICATION_ID=xxxxxxxx
    export RAKUTEN_ACCESS_KEY=yyyyyyyy

    python3 tools/fetch_rakuten.py 豚肉 玉ねぎ キャベツ   # 食材を起点に
    python3 tools/fetch_rakuten.py --all                  # 全カテゴリ（40分以上）

--------------------------------------------------------------------------
【重要】書き出した JSON を配布・公開してはいけません。

楽天ウェブサービス利用規約 第10条(9) は、APIで取得した情報を
「不特定多数と共有できる場所に保存すること」を禁じています。
GitHub に push する、友達に送る、といった使い方はできません。
また同 第5条(2) により、アプリIDを他人に渡すこともできません。

出力先 tools/out/ は .gitignore に入れてあります。
--------------------------------------------------------------------------

依存は標準ライブラリだけ。追加インストールは要りません。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "https://openapi.rakuten.co.jp/recipems/api/Recipe"
CATEGORY_LIST_URL = f"{BASE}/CategoryList/20170426"
CATEGORY_RANKING_URL = f"{BASE}/CategoryRanking/20170426"

# 「短い時間の間に大量にアクセスすると一定時間利用できなくなる」と
# 公式に注意書きがあるため、必ず1秒以上あける
MIN_INTERVAL_SEC = 1.1

OUT_DIR = Path(__file__).resolve().parent / "out"
CACHE_PATH = OUT_DIR / "categories.json"


class RakutenError(RuntimeError):
    """楽天レシピAPIから正常な応答が得られなかった。"""


class Client:
    def __init__(self, application_id: str, access_key: str | None) -> None:
        self.application_id = application_id
        self.access_key = access_key
        self._last_call = 0.0

    def _get(self, url: str, params: dict[str, str]) -> dict:
        query = {"applicationId": self.application_id, "format": "json", **params}
        if self.access_key:
            query["accessKey"] = self.access_key

        wait = MIN_INTERVAL_SEC - (time.monotonic() - self._last_call)
        if wait > 0:
            time.sleep(wait)
        self._last_call = time.monotonic()

        request = urllib.request.Request(
            f"{url}?{urllib.parse.urlencode(query)}",
            headers={"User-Agent": "fridge-recipe/1.0"},
        )
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403):
                raise RakutenError(
                    "認証に失敗しました。RAKUTEN_APPLICATION_ID と RAKUTEN_ACCESS_KEY を確認してください"
                ) from exc
            if exc.code == 429:
                raise RakutenError("アクセス制限に達しました。しばらく待ってください") from exc
            raise RakutenError(f"APIがエラーを返しました（HTTP {exc.code}）") from exc
        except urllib.error.URLError as exc:
            raise RakutenError(f"接続に失敗しました: {exc.reason}") from exc
        except json.JSONDecodeError as exc:
            raise RakutenError("応答を解釈できませんでした") from exc

    def category_list(self) -> list[dict]:
        """全カテゴリを、ランキングAPIに渡せる ``fullId`` 付きで返す。

        中カテゴリの ``categoryId`` は大カテゴリからの相対値なので、
        親をたどって ``大-中-小`` の形に組み立て直す必要がある。
        """
        result = self._get(CATEGORY_LIST_URL, {"categoryType": "all"}).get("result") or {}

        categories: list[dict] = []
        medium_parent: dict[str, str] = {}

        for row in result.get("large", []):
            cid = str(row.get("categoryId", ""))
            if cid:
                categories.append({"fullId": cid, "name": str(row.get("categoryName", "")), "level": "large"})

        for row in result.get("medium", []):
            cid, parent = str(row.get("categoryId", "")), str(row.get("parentCategoryId", ""))
            if not cid or not parent:
                continue
            medium_parent[cid] = parent
            categories.append({"fullId": f"{parent}-{cid}", "name": str(row.get("categoryName", "")), "level": "medium"})

        for row in result.get("small", []):
            cid, parent = str(row.get("categoryId", "")), str(row.get("parentCategoryId", ""))
            grand = medium_parent.get(parent)
            if not cid or not parent or not grand:
                continue
            categories.append(
                {"fullId": f"{grand}-{parent}-{cid}", "name": str(row.get("categoryName", "")), "level": "small"}
            )

        return categories

    def ranking(self, category: dict | None) -> list[dict]:
        """カテゴリ別ランキング（最大4件）。``category`` 省略時は総合ランキング。"""
        params = {"categoryId": category["fullId"]} if category else {}
        rows = self._get(CATEGORY_RANKING_URL, params).get("result") or []
        name = category["name"] if category else "総合ランキング"

        recipes = []
        for row in rows:
            recipe_id = str(row.get("recipeId") or "").strip()
            title = str(row.get("recipeTitle") or "").strip()
            materials = [str(m) for m in (row.get("recipeMaterial") or []) if str(m).strip()]
            if not recipe_id or not title or not materials:
                continue
            recipes.append({
                "id": f"rakuten:{recipe_id}",
                "title": title,
                "materials": materials,
                "url": row.get("recipeUrl") or None,
                "image": row.get("foodImageUrl") or row.get("mediumImageUrl") or None,
                "indication": str(row.get("recipeIndication") or ""),
                "cost": str(row.get("recipeCost") or ""),
                "category": name,
                "source": "rakuten",
            })
        return recipes


def pick_categories(categories: list[dict], names: list[str], limit: int) -> list[dict]:
    """食材名に対応するカテゴリを選ぶ。

    楽天レシピのカテゴリには「玉ねぎ」「鶏むね肉」のような食材名のものが多く、
    そこを起点にすると在庫に噛み合ったレシピが取れる。
    素朴な部分一致で選ぶ（アプリ側の厳密な判定はブラウザで行う）。
    """
    picked: dict[str, dict] = {}
    order = {"medium": 0, "small": 1, "large": 2}

    for name in names:
        name = name.strip()
        if not name:
            continue
        for category in sorted(categories, key=lambda c: order.get(c["level"], 3)):
            cname = category["name"]
            if not cname:
                continue
            if name in cname or cname in name:
                picked.setdefault(category["fullId"], category)

    return list(picked.values())[:limit]


def main() -> int:
    parser = argparse.ArgumentParser(description="楽天レシピからレシピ集を作る")
    parser.add_argument("ingredients", nargs="*", help="取得の起点にする食材名")
    parser.add_argument("--all", action="store_true", help="全カテゴリを対象にする（かなり時間がかかる）")
    parser.add_argument("--limit", type=int, default=60, help="まわすカテゴリ数の上限（既定: 60）")
    parser.add_argument("--out", default=str(OUT_DIR / "recipes.rakuten.json"), help="書き出し先")
    args = parser.parse_args()

    app_id = os.environ.get("RAKUTEN_APPLICATION_ID")
    if not app_id:
        print(
            "RAKUTEN_APPLICATION_ID が設定されていません。\n"
            "  https://webservice.rakuten.co.jp/ でアプリIDを取得し、環境変数に入れてください。",
            file=sys.stderr,
        )
        return 1
    if not args.all and not args.ingredients:
        print("食材名を渡すか、--all を指定してください。", file=sys.stderr)
        return 1

    client = Client(app_id, os.environ.get("RAKUTEN_ACCESS_KEY"))
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    try:
        if CACHE_PATH.exists():
            categories = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
            print(f"カテゴリ一覧をキャッシュから読みました（{len(categories)} 件）")
        else:
            print("カテゴリ一覧を取得しています…")
            categories = client.category_list()
            CACHE_PATH.write_text(json.dumps(categories, ensure_ascii=False), encoding="utf-8")
            print(f"カテゴリ: {len(categories)} 件")

        targets = categories if args.all else pick_categories(categories, args.ingredients, args.limit)
        if not targets:
            print("該当するカテゴリがありませんでした。")
            return 0

        estimate = int(len(targets) * MIN_INTERVAL_SEC)
        print(f"{len(targets)} カテゴリを取得します（目安 {estimate // 60}分{estimate % 60}秒）")

        # 途中で止めても、そこまでの結果は書き出す
        collected: dict[str, dict] = {}
        try:
            for i, category in enumerate(targets, start=1):
                try:
                    for recipe in client.ranking(category):
                        collected[recipe["id"]] = recipe
                except RakutenError as exc:
                    print(f"  [{i}/{len(targets)}] {category['name']}: {exc}", file=sys.stderr)
                    continue
                print(f"  [{i}/{len(targets)}] {category['name']}（累計 {len(collected)} 件）")
        except KeyboardInterrupt:
            print("\n中断しました。ここまでの結果を書き出します。")

        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(
            json.dumps({"recipes": list(collected.values())}, ensure_ascii=False, indent=1),
            encoding="utf-8",
        )
        size_kb = out_path.stat().st_size // 1024
        print(f"\n{len(collected)} 件を {out_path} に書き出しました（{size_kb} KB）")
        print("アプリの「レシピを増やす」からこのファイルを読み込んでください。")
        print("※ このファイルは配布・公開できません（楽天ウェブサービス利用規約 第10条9項）")
        return 0
    except RakutenError as exc:
        print(f"エラー: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
