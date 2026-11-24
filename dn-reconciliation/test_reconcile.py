"""
Offline end-to-end test (no API key needed).

Builds a synthetic Credit_Invoices_ICC.xlsx (with merged driver/outlet cells) and
synthetic DN scans (JPG with 2 DNs per page + a multi-page PDF), then runs the whole
pipeline with a fake extractor that returns the known contents of each page.

    py test_reconcile.py            (writes into ./samples/)
"""
import sys
from pathlib import Path

from openpyxl import Workbook, load_workbook
from PIL import Image, ImageDraw

import reconcile as R

HERE = Path(__file__).resolve().parent
SAMPLES = HERE / "samples"

HEADERS = ["Payment Type", "Driver ID", "Driver Name", "Distribution Center", "Outlet ID",
           "OutletName", "Outlet Name", "Total Invoiced Cases", "Invoice Number",
           "Order Number", "Delivery System", "Invoice Date"]

# driver -> outlet -> invoices
DATA = [
    ("D101", "Ahmed Saleh", [("500101", "بقالة النور", "Al Noor Grocery", ["11893710039", "11893710040"]),
                             ("500102", "سوبرماركت الريان", "Al Rayan Market", ["11893710041"])]),
    ("D102", "Khalid Omar", [("500201", "تموينات الفجر", "Al Fajr Store", ["11893710050", "11893710051"]),
                             ("500202", "مطعم البيك", "Albaik Branch 7", ["11893710052"])]),
    ("D103", "Faisal Nasser", [("500301", "بقالة السلام", "Al Salam Grocery", ["11893710060"])]),
]


def make_report(path: Path):
    wb = Workbook()
    ws = wb.active
    ws.append(["Credit Invoices ICC"])          # title row above the header
    ws.append([])
    ws.append(HEADERS)
    r = 4
    for did, dname, outlets in DATA:
        d_start = r
        for oid, oar, oen, invs in outlets:
            o_start = r
            for k, inv in enumerate(invs):
                first = k == 0
                ws.append(["Credit", did if r == d_start else None, dname if r == d_start else None,
                           "Riyadh DC", int(oid) if first else None, oar if first else None,
                           oen if first else None, 12 + k, int(inv), 9000 + r, "Pre-sell",
                           "2026-11-23"])
                r += 1
            if r - o_start > 1:
                for col in (5, 6, 7):
                    ws.merge_cells(start_row=o_start, end_row=r - 1, start_column=col, end_column=col)
        if r - d_start > 1:
            for col in (2, 3):
                ws.merge_cells(start_row=d_start, end_row=r - 1, start_column=col, end_column=col)
    ws.append([None] * 7 + ["=SUM(H4:H11)", None])   # totals row (must be ignored)
    wb.save(path)


def draw_dn(d: ImageDraw.ImageDraw, x, y, dn, outlet, stamp):
    d.rectangle([x, y, x + 380, y + 560], outline="black", width=2)
    lines = ["AL-JOMAIH BOTTLING PLANTS", "DELIVERY NOTE", f"Delivery No: {dn}",
             f"Outlet Code: {outlet}", "Sales Rep: D101", "Delivery Date: 23/11/2026",
             "Delivery Type: CREDIT", "", "Customer signature: ____"]
    for i, t in enumerate(lines):
        d.text((x + 15, y + 15 + i * 28), t, fill="black")
    if stamp:
        d.ellipse([x + 200, y + 380, x + 350, y + 530], outline="blue", width=5)
        d.text((x + 235, y + 450), "STAMP", fill="blue")


# (file, page) -> list of DN dicts as Claude would return them
TRUTH = {}


def dn(num, outlet, stamp=True, conf=0.97, bbox=(0, 0, 500, 1000), notes=""):
    return {"delivery_number": num, "outlet_code": outlet, "sales_rep": "D101",
            "delivery_date": "23/11/2026", "delivery_type": "CREDIT", "stamp_present": stamp,
            "confidence": conf, "bbox": list(bbox), "notes": notes}


def make_scans(folder: Path):
    folder.mkdir(parents=True, exist_ok=True)
    pages = {
        ("page1.jpg", 1): [dn("DN11893710039", "500101", bbox=(0, 0, 500, 1000)),
                           dn("DN11893710040", "500101", stamp=False, bbox=(500, 0, 1000, 1000))],
        ("page2.png", 1): [dn("DN11893710041", "500109"),                         # outlet mismatch
                           dn("DN11893710?52", "500202", conf=0.4, bbox=(500, 0, 1000, 1000),
                              notes="digits smudged")],                              # unreadable
        ("batch.pdf", 1): [dn("DN11893710050", "500201"),
                           dn("DN11893710099", "500201", bbox=(500, 0, 1000, 1000))],  # not in report
        ("batch.pdf", 2): [dn("DN11893710039", "500101")],                          # duplicate
        ("batch.pdf", 3): [],                                                       # blank page
    }
    TRUTH.update(pages)
    imgs = {}
    for (f, p), dns in pages.items():
        img = Image.new("RGB", (820, 600), "white")
        d = ImageDraw.Draw(img)
        for i, x in enumerate(dns):
            draw_dn(d, 20 + i * 400, 20, x["delivery_number"], x["outlet_code"], x["stamp_present"])
        imgs.setdefault(f, []).append(img)
    for f, lst in imgs.items():
        if f.endswith(".pdf"):
            lst[0].save(folder / f, save_all=True, append_images=lst[1:], resolution=100)
        else:
            lst[0].save(folder / f)


def fake_extractor(page):
    return TRUTH[(page.source, page.page_no)]


def main():
    SAMPLES.mkdir(exist_ok=True)
    rep = SAMPLES / "Credit_Invoices_ICC.xlsx"
    scans = SAMPLES / "scans"
    out = SAMPLES / "output"
    cache = out / ".extraction_cache.json"
    if cache.exists():
        cache.unlink()
    make_report(rep)
    make_scans(scans)

    df = R.load_report(rep)
    assert len(df) == 7, len(df)
    row = df[df.invoice == "11893710040"].iloc[0]
    assert row.driver_name == "Ahmed Saleh" and row.outlet_id == "500101", row.to_dict()
    assert df[df.invoice == "11893710052"].iloc[0].outlet_name == "Albaik Branch 7"

    xlsx = R.run(rep, scans, out, workers=4, extractor=fake_extractor)
    wb = load_workbook(xlsx)
    assert wb.sheetnames == ["Summary", "Scan Results", "MISSING", "Review"]

    res = {r[4].value: r[2].value for r in wb["Scan Results"].iter_rows(min_row=2)}
    statuses = [r[2].value for r in wb["Scan Results"].iter_rows(min_row=2)]
    assert res["11893710039"] in ("MATCHED", "DUPLICATE")
    assert statuses.count("DUPLICATE") == 1
    assert statuses.count("MATCHED") == 2           # ...039 and ...050
    assert res["11893710040"] == "MATCHED_NO_STAMP"
    assert res["11893710041"] == "OUTLET_MISMATCH"
    assert res["11893710099"] == "NOT_IN_REPORT"
    assert statuses.count("UNREADABLE") == 2        # smudged DN + blank page

    missing = [r[4].value for r in wb["MISSING"].iter_rows(min_row=4) if r[4].value]
    assert sorted(missing) == ["11893710051", "11893710052", "11893710060"], missing

    review = list(wb["Review"].iter_rows(min_row=2, values_only=True))
    assert len(review) == 5, review
    for r in review:
        assert (out / r[8]).exists(), r[8]

    # Re-run must hit the cache (extractor would raise if called).
    R.run(rep, scans, out, workers=4, extractor=lambda p: (_ for _ in ()).throw(AssertionError))
    print("\nALL TESTS PASSED")


if __name__ == "__main__":
    sys.exit(main())
