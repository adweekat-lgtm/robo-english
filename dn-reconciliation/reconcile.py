"""
DN Reconciliation - daily check of signed credit Delivery Notes against the
Credit_Invoices_ICC.xlsx accounting report.

Usage:
    py reconcile.py --report Credit_Invoices_ICC.xlsx --scans scans/
    py reconcile.py --report report.xlsx --scans day.pdf --out output --workers 8

Needs: pandas, openpyxl, anthropic, pillow, pymupdf (only for PDF input).
API key: environment variable ANTHROPIC_API_KEY.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

MODEL = "claude-sonnet-4-6"
CONFIDENCE_THRESHOLD = 0.70          # below this -> UNREADABLE
MAX_IMAGE_SIDE = 2200                # px, long edge sent to the API
PDF_DPI = 200
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"}

# Statuses
MATCHED = "MATCHED"
MATCHED_NO_STAMP = "MATCHED_NO_STAMP"
OUTLET_MISMATCH = "OUTLET_MISMATCH"
NOT_IN_REPORT = "NOT_IN_REPORT"
UNREADABLE = "UNREADABLE"
DUPLICATE = "DUPLICATE"

STATUS_FILL = {
    MATCHED: "C6EFCE",           # green
    MATCHED_NO_STAMP: "FFEB9C",  # yellow
    OUTLET_MISMATCH: "F8CBAD",   # orange
    NOT_IN_REPORT: "FFC7CE",     # red
    UNREADABLE: "D9D9D9",        # grey
    DUPLICATE: "BDD7EE",         # blue
}


class UserError(Exception):
    """An error with a message meant for the user (no traceback)."""


# --------------------------------------------------------------------------
# 1. Report loading
# --------------------------------------------------------------------------
REPORT_COLUMNS = {
    "payment_type": ["payment type"],
    "driver_id": ["driver id"],
    "driver_name": ["driver name"],
    "dc": ["distribution center", "distribution centre"],
    "outlet_id": ["outlet id"],
    "outlet_name_ar": ["outletname (arabic)", "outletname", "outlet name (arabic)"],
    "outlet_name": ["outlet name"],
    "cases": ["total invoiced cases"],
    "invoice": ["invoice number", "invoice no", "invoice"],
    "order": ["order number"],
    "delivery_system": ["delivery system"],
    "invoice_date": ["invoice date"],
}
REQUIRED = ["driver_name", "outlet_id", "invoice"]
FFILL = ["payment_type", "driver_id", "driver_name", "dc", "outlet_id",
         "outlet_name_ar", "outlet_name"]


def _norm_header(s) -> str:
    return re.sub(r"\s+", " ", str(s)).strip().lower()


def clean_id(v) -> str:
    """Normalise an invoice / outlet number to a plain digit string."""
    if v is None:
        return ""
    try:
        import math
        if isinstance(v, float):
            if math.isnan(v):
                return ""
            if v.is_integer():
                return str(int(v))
    except Exception:
        pass
    s = str(v).strip()
    if s.lower() in ("nan", "none"):
        return ""
    s = re.sub(r"\.0+$", "", s)
    s = re.sub(r"^(DN|INV)\s*[-:#]?\s*", "", s, flags=re.I)
    return re.sub(r"[\s\-]", "", s)


def load_report(path: Path):
    import pandas as pd

    if not path.exists():
        raise UserError(f"Report file not found: {path}")
    try:
        raw = pd.read_excel(path, header=None, dtype=object)
    except PermissionError:
        raise UserError(f"Cannot open {path.name} - is it open in Excel? Close it and retry.")
    except Exception as e:
        raise UserError(f"Could not read the report {path.name}: {e}")

    # Find the header row (the one that contains "Invoice Number").
    header_row = None
    for i in range(min(len(raw), 30)):
        cells = [_norm_header(c) for c in raw.iloc[i].tolist()]
        if any(c.startswith("invoice number") for c in cells):
            header_row = i
            break
    if header_row is None:
        raise UserError("Could not find a header row with 'Invoice Number' in the report.")

    headers = [_norm_header(c) for c in raw.iloc[header_row].tolist()]
    df = raw.iloc[header_row + 1:].reset_index(drop=True)
    df.columns = range(len(headers))

    colmap = {}
    for key, names in REPORT_COLUMNS.items():
        for idx, h in enumerate(headers):
            if idx in colmap.values():
                continue
            if h in names:
                colmap[key] = idx
                break
    # "Outlet Name" vs "OutletName" ambiguity: if only one outlet-name column, use it for both.
    if "outlet_name" not in colmap and "outlet_name_ar" in colmap:
        colmap["outlet_name"] = colmap["outlet_name_ar"]
    missing = [k for k in REQUIRED if k not in colmap]
    if missing:
        raise UserError(
            "Report is missing required column(s): "
            + ", ".join(REPORT_COLUMNS[k][0].title() for k in missing)
            + f"\nColumns found: {[h for h in headers if h and h != 'nan']}")

    out = pd.DataFrame({k: df[i] for k, i in colmap.items()})
    for k in REPORT_COLUMNS:
        if k not in out:
            out[k] = None
    # Blank strings -> NaN so forward-fill works on merged/blank continuation rows.
    out = out.replace(r"^\s*$", pd.NA, regex=True)
    out[FFILL] = out[FFILL].ffill()

    out["invoice"] = out["invoice"].map(clean_id)
    out["outlet_id"] = out["outlet_id"].map(clean_id)
    out["driver_id"] = out["driver_id"].map(clean_id)
    out = out[out["invoice"].str.fullmatch(r"\d{5,}")].copy()   # drops total/blank rows
    out["cases"] = pd.to_numeric(out["cases"], errors="coerce").fillna(0)
    for c in ("driver_name", "outlet_name", "outlet_name_ar", "dc", "payment_type"):
        out[c] = out[c].fillna("").astype(str).str.strip()
    out = out.drop_duplicates(subset="invoice", keep="first").reset_index(drop=True)
    if out.empty:
        raise UserError("No invoice rows found in the report.")
    return out


# --------------------------------------------------------------------------
# 2. Scan loading (images or PDF pages)
# --------------------------------------------------------------------------
@dataclass
class Page:
    source: str          # file name
    page_no: int         # 1-based page in the file
    image: object        # PIL.Image
    jpeg: bytes = b""
    sha: str = ""

    @property
    def ref(self) -> str:
        return f"{self.source} p{self.page_no}"


def _prepare(img):
    from PIL import Image, ImageOps
    img = ImageOps.exif_transpose(img)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    w, h = img.size
    scale = MAX_IMAGE_SIDE / max(w, h)
    if scale < 1:
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    return img


def load_scans(path: Path) -> list[Page]:
    from PIL import Image

    if not path.exists():
        raise UserError(f"Scans path not found: {path}")
    files = [path] if path.is_file() else sorted(
        p for p in path.iterdir()
        if p.is_file() and (p.suffix.lower() in IMAGE_EXTS or p.suffix.lower() == ".pdf"))
    if not files:
        raise UserError(f"No PDF or image files found in {path}")

    pages: list[Page] = []
    for f in files:
        ext = f.suffix.lower()
        try:
            if ext == ".pdf":
                try:
                    import pymupdf
                except ImportError:
                    try:
                        import fitz as pymupdf  # older PyMuPDF
                    except ImportError:
                        raise UserError("PDF input needs PyMuPDF. Install it with:\n"
                                        "    py -m pip install --user pymupdf")
                with pymupdf.open(f) as doc:
                    for i, pg in enumerate(doc, 1):
                        pix = pg.get_pixmap(dpi=PDF_DPI)
                        img = Image.open(io.BytesIO(pix.tobytes("png")))
                        pages.append(Page(f.name, i, _prepare(img)))
            elif ext in IMAGE_EXTS:
                with Image.open(f) as im:
                    n = getattr(im, "n_frames", 1)
                    for i in range(n):
                        im.seek(i)
                        pages.append(Page(f.name, i + 1, _prepare(im.copy())))
        except UserError:
            raise
        except Exception as e:
            print(f"  ! Skipping {f.name}: cannot open ({e})")

    for p in pages:
        buf = io.BytesIO()
        p.image.convert("RGB").save(buf, "JPEG", quality=88)
        p.jpeg = buf.getvalue()
        p.sha = hashlib.sha256(p.jpeg).hexdigest()
    return pages


# --------------------------------------------------------------------------
# 3. Extraction with Claude vision
# --------------------------------------------------------------------------
PROMPT = """This image is a scan of one or more small paper Delivery Notes (receipt-size
slips) from Al-Jomaih Bottling Plants (Pepsi). A single scan page may contain several
separate delivery notes side by side or stacked; it may also contain none.

For EACH separate delivery note visible, extract:
- delivery_number: the Delivery Number exactly as printed, e.g. "DN11893710039".
- outlet_code: the Outlet / Customer code (digits).
- sales_rep: the Sales Rep / driver name or code as printed.
- delivery_date: the delivery date as printed.
- delivery_type: the delivery/payment type as printed (e.g. "CREDIT", "CASH").
- stamp_present: true only if a customer stamp / seal (ink stamp, usually round or
  rectangular, often blue/purple/red) is visibly impressed on the note. A signature
  alone is NOT a stamp. Printed logos are NOT a stamp.
- confidence: 0.0-1.0, your confidence that delivery_number AND outlet_code are read
  correctly (lower it for blur, cut-off, handwriting over digits, ambiguous digits).
- bbox: the note's position on the page as [x0, y0, x1, y1] in a 0-1000 scale
  (0,0 = top-left, 1000,1000 = bottom-right).
- notes: short remark about any problem (blurry, torn, partly cut off), else "".

Rules: never guess digits - if a digit is unreadable use "?" in its place and lower the
confidence. Use "" for a field that is not present. Do not invent notes that are not in
the image. Return every delivery note, including partial ones at the edges."""

DN_SCHEMA = {
    "type": "object",
    "properties": {
        "delivery_notes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "delivery_number": {"type": "string"},
                    "outlet_code": {"type": "string"},
                    "sales_rep": {"type": "string"},
                    "delivery_date": {"type": "string"},
                    "delivery_type": {"type": "string"},
                    "stamp_present": {"type": "boolean"},
                    "confidence": {"type": "number"},
                    "bbox": {"type": "array", "items": {"type": "number"}},
                    "notes": {"type": "string"},
                },
                "required": ["delivery_number", "outlet_code", "sales_rep", "delivery_date",
                             "delivery_type", "stamp_present", "confidence", "bbox", "notes"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["delivery_notes"],
    "additionalProperties": False,
}


def _parse_json(text: str) -> dict:
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, re.S)   # tolerate stray text around JSON
        if m:
            return json.loads(m.group(0))
        raise


def make_client():
    try:
        import anthropic
    except ImportError:
        raise UserError("The 'anthropic' package is missing. Install it with:\n"
                        "    py -m pip install --user anthropic")
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise UserError("ANTHROPIC_API_KEY is not set.\n"
                        "Set it once (no admin needed) in a Command Prompt:\n"
                        "    setx ANTHROPIC_API_KEY \"sk-ant-...\"\n"
                        "then close and reopen the window.")
    return anthropic.Anthropic(max_retries=4, timeout=120)


def extract_page(client, page: Page) -> list[dict]:
    """Call Claude on one page; returns the list of delivery-note dicts."""
    import anthropic

    kwargs = dict(
        model=MODEL,
        max_tokens=4000,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                             "data": base64.b64encode(page.jpeg).decode()}},
                {"type": "text", "text": PROMPT},
            ],
        }],
    )
    fmt = {"format": {"type": "json_schema", "schema": DN_SCHEMA}}
    last_err = None
    for attempt in range(3):
        try:
            try:
                resp = client.messages.create(**kwargs, output_config=fmt)
            except TypeError:  # older SDK without output_config keyword
                resp = client.messages.create(**kwargs, extra_body={"output_config": fmt})
            if resp.stop_reason == "refusal":
                raise RuntimeError("model declined the request")
            text = next((b.text for b in resp.content if b.type == "text"), "")
            data = _parse_json(text)
            return list(data.get("delivery_notes", []))
        except (anthropic.AuthenticationError, anthropic.PermissionDeniedError):
            raise UserError("The API key was rejected (check ANTHROPIC_API_KEY).")
        except anthropic.NotFoundError:
            raise UserError(f"Model '{MODEL}' not available for this API key.")
        except anthropic.BadRequestError as e:
            raise RuntimeError(f"API rejected the request: {e.message}")
        except anthropic.APIConnectionError as e:
            last_err = f"network error ({e}) - check internet / proxy"
        except (anthropic.RateLimitError, anthropic.APIStatusError) as e:
            last_err = f"API error {getattr(e, 'status_code', '')}: {getattr(e, 'message', e)}"
        except (json.JSONDecodeError, ValueError, RuntimeError) as e:
            last_err = f"bad response: {e}"
        time.sleep(3 * (attempt + 1))
    raise RuntimeError(last_err or "unknown error")


class Cache:
    """Remembers results per page image so re-runs don't pay twice."""

    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.Lock()
        try:
            self.data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            self.data = {}

    def get(self, key):
        return self.data.get(key)

    def put(self, key, value):
        with self.lock:
            self.data[key] = value
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.data), encoding="utf-8")
            tmp.replace(self.path)


def extract_all(pages: list[Page], workers: int, cache: Cache, extractor=None) -> dict:
    """Returns {page_index: list_of_dn_dicts | {'error': str}}."""
    results: dict[int, object] = {}
    todo = []
    for i, p in enumerate(pages):
        hit = cache.get(f"{MODEL}:{p.sha}")
        if hit is not None:
            results[i] = hit
        else:
            todo.append(i)
    if len(todo) < len(pages):
        print(f"  {len(pages) - len(todo)} page(s) taken from cache")
    if not todo:
        return results

    if extractor is None:
        client = make_client()
        extractor = lambda p: extract_page(client, p)  # noqa: E731

    t0 = time.time()
    done = 0
    with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        futs = {ex.submit(extractor, pages[i]): i for i in todo}
        for fut in as_completed(futs):
            i = futs[fut]
            try:
                dns = fut.result()
                results[i] = dns
                cache.put(f"{MODEL}:{pages[i].sha}", dns)
            except UserError:
                ex.shutdown(cancel_futures=True)
                raise
            except Exception as e:
                results[i] = {"error": str(e)}
            done += 1
            el = time.time() - t0
            eta = el / done * (len(todo) - done)
            print(f"\r  Reading pages: {done}/{len(todo)}  ({el:.0f}s, ~{eta:.0f}s left)   ",
                  end="", flush=True)
    print()
    return results


# --------------------------------------------------------------------------
# 4. Matching
# --------------------------------------------------------------------------
@dataclass
class ScanRow:
    page: Page
    dn_raw: str = ""
    invoice: str = ""
    outlet_code: str = ""
    sales_rep: str = ""
    delivery_date: str = ""
    delivery_type: str = ""
    stamp: bool | None = None
    confidence: float = 0.0
    bbox: list = field(default_factory=list)
    notes: str = ""
    status: str = ""
    reason: str = ""
    report: dict | None = None
    crop_path: str = ""
    dup_of: int | None = None


def _lev1(a: str, b: str) -> bool:
    """True if a and b differ by exactly one substitution (common OCR misread)."""
    return len(a) == len(b) and sum(x != y for x, y in zip(a, b)) == 1


def build_rows(pages: list[Page], results: dict) -> list[ScanRow]:
    rows = []
    for i, p in enumerate(pages):
        r = results.get(i)
        if isinstance(r, dict) and "error" in r:
            rows.append(ScanRow(page=p, status=UNREADABLE,
                                reason=f"Page could not be read: {r['error']}"))
            continue
        if not r:
            rows.append(ScanRow(page=p, status=UNREADABLE,
                                reason="No delivery note detected on this page"))
            continue
        for d in r:
            try:
                conf = float(d.get("confidence") or 0)
            except (TypeError, ValueError):
                conf = 0.0
            raw = str(d.get("delivery_number") or "").strip()
            rows.append(ScanRow(
                page=p, dn_raw=raw, invoice=clean_id(raw),
                outlet_code=clean_id(d.get("outlet_code")),
                sales_rep=str(d.get("sales_rep") or "").strip(),
                delivery_date=str(d.get("delivery_date") or "").strip(),
                delivery_type=str(d.get("delivery_type") or "").strip(),
                stamp=d.get("stamp_present") if isinstance(d.get("stamp_present"), bool) else None,
                confidence=max(0.0, min(1.0, conf)),
                bbox=list(d.get("bbox") or []),
                notes=str(d.get("notes") or "").strip()))
    return rows


def reconcile(rows: list[ScanRow], report) -> None:
    by_inv = {r["invoice"]: r for r in report.to_dict("records")}
    by_outlet: dict[str, list[str]] = {}
    for inv, r in by_inv.items():
        by_outlet.setdefault(r["outlet_id"], []).append(inv)

    seen: dict[str, int] = {}
    for idx, s in enumerate(rows):
        if s.status:          # already UNREADABLE (page-level)
            continue
        if not re.fullmatch(r"\d{6,}", s.invoice) or s.confidence < CONFIDENCE_THRESHOLD:
            s.status = UNREADABLE
            s.reason = (f"Low confidence ({s.confidence:.0%})" if s.confidence < CONFIDENCE_THRESHOLD
                        else f"Delivery number not readable ('{s.dn_raw}')")
            if s.notes:
                s.reason += f" - {s.notes}"
            continue
        if s.invoice in seen:
            s.status = DUPLICATE
            s.dup_of = seen[s.invoice]
            first = rows[seen[s.invoice]]
            s.reason = f"Same DN already scanned at {first.page.ref}"
            s.report = by_inv.get(s.invoice)
            continue
        seen[s.invoice] = idx

        rep = by_inv.get(s.invoice)
        if rep is None:
            s.status = NOT_IN_REPORT
            cands = [inv for inv in by_outlet.get(s.outlet_code, []) if _lev1(inv, s.invoice)]
            if not cands:
                cands = [inv for inv in by_inv if _lev1(inv, s.invoice)][:3]
            s.reason = "Invoice not in report"
            if cands:
                s.reason += f" - possible misread of {', '.join(cands)}"
            continue
        s.report = rep
        if s.outlet_code != rep["outlet_id"]:
            s.status = OUTLET_MISMATCH
            s.reason = f"DN outlet {s.outlet_code or '(blank)'} vs report outlet {rep['outlet_id']}"
        elif s.stamp is not True:
            s.status = MATCHED_NO_STAMP
            s.reason = "No stamp/seal detected"
        else:
            s.status = MATCHED
        if s.delivery_type and "CREDIT" not in s.delivery_type.upper():
            s.reason = (s.reason + "; " if s.reason else "") + f"Delivery type is '{s.delivery_type}'"


# --------------------------------------------------------------------------
# 5. Review crops
# --------------------------------------------------------------------------
def save_crops(rows: list[ScanRow], folder: Path) -> None:
    need = [s for s in rows if s.status in (UNREADABLE, DUPLICATE, NOT_IN_REPORT, OUTLET_MISMATCH)]
    if not need:
        return
    folder.mkdir(parents=True, exist_ok=True)
    for n, s in enumerate(need, 1):
        img = s.page.image
        w, h = img.size
        crop = img
        if len(s.bbox) == 4:
            try:
                x0, y0, x1, y1 = [float(v) for v in s.bbox]
                if x1 > x0 and y1 > y0:
                    pad = 25
                    box = (max(0, int((x0 - pad) / 1000 * w)), max(0, int((y0 - pad) / 1000 * h)),
                           min(w, int((x1 + pad) / 1000 * w)), min(h, int((y1 + pad) / 1000 * h)))
                    if box[2] - box[0] > 40 and box[3] - box[1] > 40:
                        crop = img.crop(box)
            except (TypeError, ValueError):
                pass
        stem = re.sub(r"[^\w\-]+", "_", Path(s.page.source).stem)
        name = f"{n:03d}_{s.status}_{stem}_p{s.page.page_no}.jpg"
        crop.convert("RGB").save(folder / name, "JPEG", quality=85)
        s.crop_path = f"{folder.name}/{name}"


# --------------------------------------------------------------------------
# 6. Excel output
# --------------------------------------------------------------------------
def write_excel(path: Path, rows: list[ScanRow], report, meta: dict) -> dict:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    thin = Side(style="thin", color="BFBFBF")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    hdr_fill = PatternFill("solid", fgColor="1F4E78")
    hdr_font = Font(bold=True, color="FFFFFF")
    fill = lambda c: PatternFill("solid", fgColor=c)  # noqa: E731

    def table(ws, start_row, headers, data, status_col=None, widths=None):
        for j, h in enumerate(headers, 1):
            c = ws.cell(start_row, j, h)
            c.fill, c.font, c.border = hdr_fill, hdr_font, border
            c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        for i, row in enumerate(data, start_row + 1):
            st = row[status_col] if status_col is not None else None
            for j, v in enumerate(row, 1):
                c = ws.cell(i, j, v)
                c.border = border
                if st in STATUS_FILL:
                    c.fill = fill(STATUS_FILL[st])
        if widths:
            for j, wd in enumerate(widths, 1):
                ws.column_dimensions[get_column_letter(j)].width = wd
        if data:
            ws.auto_filter.ref = f"A{start_row}:{get_column_letter(len(headers))}{start_row + len(data)}"
        ws.freeze_panes = ws.cell(start_row + 1, 1)

    received = {s.invoice for s in rows if s.report is not None and s.status != DUPLICATE}
    rep = report.copy()
    rep["received"] = rep["invoice"].isin(received)
    status_of = {s.invoice: s.status for s in rows if s.report is not None and s.status != DUPLICATE}
    rep["status"] = rep["invoice"].map(status_of).fillna("MISSING")

    counts = {k: sum(1 for s in rows if s.status == k) for k in STATUS_FILL}
    total_inv = len(rep)
    n_recv = int(rep["received"].sum())
    n_missing = total_inv - n_recv
    stamped_ok = int((rep["status"] == MATCHED).sum())

    wb = Workbook()
    # ---- Summary
    ws = wb.active
    ws.title = "Summary"
    ws["A1"] = "DN Reconciliation - Credit Delivery Notes"
    ws["A1"].font = Font(bold=True, size=15, color="1F4E78")
    info = [
        ("Run time", meta["run_time"]),
        ("Report file", meta["report"]),
        ("Scans", meta["scans"]),
        ("Scan pages processed", meta["pages"]),
        ("Delivery notes detected", sum(1 for s in rows if s.dn_raw)),
        ("", ""),
        ("Invoices in report", total_inv),
        ("DNs received (matched to report)", n_recv),
        ("% received", n_recv / total_inv if total_inv else 0),
        ("Received & stamped & outlet OK", stamped_ok),
        ("% fully OK", stamped_ok / total_inv if total_inv else 0),
        ("MISSING (no DN scanned)", n_missing),
        ("", ""),
    ] + [(f"Scan rows: {k}", v) for k, v in counts.items()]
    for i, (k, v) in enumerate(info, 3):
        ws.cell(i, 1, k).font = Font(bold=bool(k))
        c = ws.cell(i, 2, v)
        if k.startswith("%"):
            c.number_format = "0.0%"
        if k.startswith("Scan rows: "):
            st = k.split(": ", 1)[1]
            ws.cell(i, 1).fill = fill(STATUS_FILL[st])
            c.fill = fill(STATUS_FILL[st])
        if k.startswith("MISSING") and v:
            c.font = Font(bold=True, color="C00000")
    r0 = 3 + len(info) + 1
    ws.cell(r0, 1, "By driver").font = Font(bold=True, size=13, color="1F4E78")
    drv = []
    for (did, dname), g in rep.groupby(["driver_id", "driver_name"], sort=False, dropna=False):
        tot = len(g)
        rec = int(g["received"].sum())
        drv.append([did, dname, tot, rec, tot - rec,
                    int((g["status"] == MATCHED_NO_STAMP).sum()),
                    int((g["status"] == OUTLET_MISMATCH).sum()),
                    rec / tot if tot else 0, float(g.loc[~g["received"], "cases"].sum())])
    drv.sort(key=lambda r: (-r[4], r[1]))
    table(ws, r0 + 1, ["Driver ID", "Driver Name", "Invoices", "Received", "Missing",
                       "No Stamp", "Outlet Mismatch", "% Received", "Missing Cases"], drv,
          widths=[34, 30, 11, 11, 11, 11, 15, 12, 14])
    for i, d in enumerate(drv, r0 + 2):
        ws.cell(i, 8).number_format = "0.0%"
        if d[4]:
            ws.cell(i, 5).fill = fill("FFC7CE")
            ws.cell(i, 5).font = Font(bold=True, color="9C0006")
        elif d[7] == 1:
            ws.cell(i, 8).fill = fill("C6EFCE")
    ws.freeze_panes = None

    # ---- Scan Results
    ws = wb.create_sheet("Scan Results")
    data = []
    for s in rows:
        rp = s.report or {}
        data.append([s.page.source, s.page.page_no, s.status, s.dn_raw, s.invoice,
                     s.outlet_code, rp.get("outlet_id", ""), rp.get("outlet_name", ""),
                     rp.get("driver_name", ""), s.sales_rep, s.delivery_date, s.delivery_type,
                     "YES" if s.stamp else ("NO" if s.stamp is False else "?"),
                     round(s.confidence, 2), rp.get("cases", ""), s.reason, s.crop_path])
    table(ws, 1, ["Source File", "Page", "Status", "DN (as read)", "Invoice No", "DN Outlet",
                  "Report Outlet", "Outlet Name", "Report Driver", "DN Sales Rep",
                  "Delivery Date", "Type", "Stamp", "Confidence", "Cases", "Reason / Note",
                  "Image"], data, status_col=2,
          widths=[24, 6, 19, 17, 15, 11, 12, 30, 24, 18, 13, 9, 7, 11, 7, 45, 40])
    _link_images(ws, 17, len(data), path.parent)

    # ---- MISSING
    ws = wb.create_sheet("MISSING")
    miss = rep[~rep["received"]].sort_values(["driver_name", "outlet_name", "invoice"])
    ws["A1"] = f"Report invoices with NO scanned DN: {len(miss)}"
    ws["A1"].font = Font(bold=True, size=13, color="C00000")
    hdr = ["Driver Name", "Outlet ID", "Outlet Name", "Outlet Name (Arabic)",
           "Invoice Number", "Cases", "Invoice Date"]
    for j, h in enumerate(hdr, 1):
        c = ws.cell(3, j, h)
        c.fill, c.font, c.border = hdr_fill, hdr_font, border
    r = 4
    for dname, g in miss.groupby("driver_name", sort=True):
        c = ws.cell(r, 1, f"{dname}  ({len(g)} missing, {g['cases'].sum():g} cases)")
        c.font = Font(bold=True, color="FFFFFF")
        for j in range(1, len(hdr) + 1):
            ws.cell(r, j).fill = fill("C00000")
        r += 1
        for _, m in g.iterrows():
            vals = [m["driver_name"], m["outlet_id"], m["outlet_name"], m["outlet_name_ar"],
                    m["invoice"], m["cases"], _fmt_date(m["invoice_date"])]
            for j, v in enumerate(vals, 1):
                ws.cell(r, j, v).border = border
            ws.cell(r, 4).alignment = Alignment(horizontal="right")
            r += 1
    for j, wd in enumerate([28, 11, 34, 34, 16, 8, 13], 1):
        ws.column_dimensions[get_column_letter(j)].width = wd
    ws.freeze_panes = "A4"

    # ---- Review
    ws = wb.create_sheet("Review")
    review = [s for s in rows if s.status in (UNREADABLE, DUPLICATE, NOT_IN_REPORT, OUTLET_MISMATCH)]
    data = [[s.status, s.page.source, s.page.page_no, s.dn_raw, s.outlet_code, s.sales_rep,
             round(s.confidence, 2), s.reason, s.crop_path, ""] for s in review]
    table(ws, 1, ["Status", "Source File", "Page", "DN (as read)", "DN Outlet", "Sales Rep",
                  "Confidence", "Reason", "Image (click)", "Checked by / Comment"],
          data, status_col=0, widths=[19, 24, 6, 18, 11, 18, 11, 50, 42, 26])
    _link_images(ws, 9, len(data), path.parent)

    try:
        wb.save(path)
    except PermissionError:
        raise UserError(f"Cannot write {path} - is it open in Excel? Close it and retry.")
    return {"invoices": total_inv, "received": n_recv, "missing": n_missing,
            "ok": stamped_ok, **counts}


def _fmt_date(v):
    try:
        import pandas as pd
        if v is None or pd.isna(v):
            return ""
        return pd.to_datetime(v).strftime("%Y-%m-%d")
    except Exception:
        return str(v)


def _link_images(ws, col, n, base: Path):
    from openpyxl.styles import Font
    for i in range(2, n + 2):
        c = ws.cell(i, col)
        if c.value:
            c.hyperlink = str(c.value).replace("/", os.sep)
            c.font = Font(color="0563C1", underline="single")


# --------------------------------------------------------------------------
# 7. Main
# --------------------------------------------------------------------------
def run(report_path: Path, scans_path: Path, out_dir: Path, workers: int,
        extractor=None) -> Path:
    t0 = time.time()
    print(f"[1/5] Reading report: {report_path.name}")
    report = load_report(report_path)
    print(f"      {len(report)} invoices, {report['driver_name'].nunique()} drivers")

    print(f"[2/5] Loading scans: {scans_path}")
    pages = load_scans(scans_path)
    print(f"      {len(pages)} page(s)")

    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M")
    cache = Cache(out_dir / ".extraction_cache.json")

    print(f"[3/5] Extracting delivery notes with {MODEL} ({workers} parallel)")
    results = extract_all(pages, workers, cache, extractor)

    print("[4/5] Matching against report")
    rows = build_rows(pages, results)
    reconcile(rows, report)
    save_crops(rows, out_dir / f"review_images_{stamp}")

    print("[5/5] Writing Excel")
    xlsx = out_dir / f"DN_Reconciliation_{stamp}.xlsx"
    summary = write_excel(xlsx, rows, report, {
        "run_time": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "report": str(report_path), "scans": str(scans_path), "pages": len(pages)})

    pct = summary["received"] / summary["invoices"] * 100 if summary["invoices"] else 0
    print("\n" + "=" * 52)
    print(f"  Invoices in report : {summary['invoices']}")
    print(f"  DNs received       : {summary['received']}  ({pct:.1f}%)")
    print(f"  MISSING            : {summary['missing']}")
    for k in STATUS_FILL:
        if summary[k]:
            print(f"  {k:<19}: {summary[k]}")
    print("=" * 52)
    print(f"  Output: {xlsx}")
    print(f"  Done in {time.time() - t0:.0f}s")
    return xlsx


def main(argv=None):
    ap = argparse.ArgumentParser(description="Reconcile scanned credit DNs against the ICC report.")
    ap.add_argument("--report", required=True, help="Credit_Invoices_ICC.xlsx")
    ap.add_argument("--scans", required=True, help="folder of JPG/PNG/PDF, or one PDF file")
    ap.add_argument("--out", default="output", help="output folder (default: output)")
    ap.add_argument("--workers", type=int, default=8, help="parallel API calls (default 8)")
    a = ap.parse_args(argv)
    try:
        run(Path(a.report.strip('"')), Path(a.scans.strip('"')), Path(a.out), a.workers)
    except UserError as e:
        print(f"\nERROR: {e}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("\nStopped. Pages already read are cached - re-run to continue.", file=sys.stderr)
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
