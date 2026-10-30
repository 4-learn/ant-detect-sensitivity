"""端對端測試（Python Playwright）。

用法：
    pip install playwright && playwright install chromium
    python test/e2e_pages.py [URL]          # 預設測 GitHub Pages
    python test/e2e_pages.py http://localhost:8000/

流程：載入示範圖組 → 檢查預設參數判定 → 調參數看判定改變 →
      上傳真實檔案 → 單參數掃描 → 雙參數熱圖 → 下載 CSV → 截圖。
"""
import sys, os, re, tempfile
from playwright.sync_api import sync_playwright, expect

URL = sys.argv[1] if len(sys.argv) > 1 else "https://4-learn.github.io/ant-detect-sensitivity/"
OUT = os.environ.get("SHOT_DIR", tempfile.gettempdir())

EXPECTED_DEFAULT = {  # 示範圖組在學生預設參數下的判定
    "demo_01_empty.jpg": "無琉璃蟻",
    "demo_02_empty.jpg": "無琉璃蟻",
    "demo_03_ants_moving.jpg": "活動中",
    "demo_07_ants_still.jpg": "群聚無位移",
    "demo_08_shadow.jpg": "活動中",  # 已知誤判：陰影只佔約 18%，沒超過 25% 上限
}


def statuses(page):
    return page.eval_on_selector_all(
        "#img_table_wrap tbody tr",
        "trs => trs.map(t => [t.children[2].title, t.children[6].innerText.trim(), t.children[4].innerText, t.children[5].innerText])",
    )


def main():
    errors = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_page(viewport={"width": 1280, "height": 900}, accept_downloads=True)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: m.type == "error" and errors.append(m.text))
        page.goto(URL)

        # 1. 示範圖組
        page.click("#btn_demo")
        expect(page.locator("#img_table_wrap tbody tr")).to_have_count(8, timeout=20000)
        rows = statuses(page)
        for r in rows:
            print("  ", " | ".join(r))
        got = {r[0]: r[1] for r in rows}
        for name, want in EXPECTED_DEFAULT.items():
            assert want in got[name], f"{name}: 期望 {want}，實際 {got[name]}"
        assert "第一張" in rows[0][3], "第一張移動量應標示為（第一張）"
        score = page.inner_text("#img_table_wrap .info")
        print("  預設參數：", score)

        # 2. 調參數 → 判定應改變（閾值設 0 → 沒有暗像素 → 全部無螞蟻）
        page.fill("#param_darkThreshold input[data-role=num]", "0")
        page.dispatch_event("#param_darkThreshold input[data-role=num]", "input")
        assert all("無琉璃蟻" in r[1] for r in statuses(page)), "閾值 0 時應全部判為無琉璃蟻"
        assert "changed" in page.get_attribute("#param_darkThreshold", "class")
        page.click("#btn_reset")
        assert {r[0]: r[1] for r in statuses(page)} == got, "恢復預設後判定應與一開始相同"

        # 3. 上傳真實檔案（file input）
        page.screenshot(path=os.path.join(OUT, "ant_lab_demo_png.png"))
        upload = os.path.join(OUT, "zz_upload_test.png")
        page.locator("#preview_canvas").screenshot(path=upload)
        page.set_input_files("#file_input", upload)
        expect(page.locator("#img_table_wrap tbody tr")).to_have_count(9, timeout=10000)
        print("  上傳後共", len(statuses(page)), "張")

        # 4. 人工標註後單參數掃描
        page.click("#btn_sweep1")
        summary = page.inner_text("#sweep1_summary")
        print("  掃描摘要：", summary.splitlines()[0])
        assert "最高準確率" in summary
        with page.expect_download() as d:
            page.click("#btn_csv1")
        csv1 = d.value.path()
        head = open(csv1, encoding="utf-8-sig").read().splitlines()[:3]
        assert head[1].startswith("darkThreshold,count_active"), head
        print("  CSV1 行數：", sum(1 for _ in open(csv1, encoding="utf-8-sig")))
        page.locator("#sec-sweep").screenshot(path=os.path.join(OUT, "ant_lab_sweep1.png"))

        # 5. 熱圖
        page.click(".tab[data-tab=t2d]")
        page.click("#btn_sweep2")
        box = page.locator("#heat_canvas").bounding_box()
        page.mouse.move(box["x"] + box["width"] * 0.4, box["y"] + box["height"] * 0.5)
        tip = page.inner_text("#heat_tip")
        print("  熱圖提示：", tip)
        assert re.search(r"darkThreshold = \d+", tip)
        with page.expect_download() as d:
            page.click("#btn_csv2")
        assert "heatmap_darkThreshold_motionThreshold" in d.value.suggested_filename
        page.locator("#sec-sweep").screenshot(path=os.path.join(OUT, "ant_lab_heatmap.png"))
        page.screenshot(path=os.path.join(OUT, "ant_lab_full.png"), full_page=True)
        b.close()

    assert not errors, errors
    print("PASS", URL)


if __name__ == "__main__":
    main()
