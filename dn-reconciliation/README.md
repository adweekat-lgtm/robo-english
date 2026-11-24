# DN Reconciliation (Credit Delivery Notes)

Checks the scanned, signed credit Delivery Notes (DN) against `Credit_Invoices_ICC.xlsx`
and writes a colour-coded Excel file: **Summary**, **Scan Results**, **MISSING**, **Review**.

## Daily use (5 lines)
1. Save the day's report as `Credit_Invoices_ICC.xlsx` in this folder.
2. Scan the returned DNs into the `scans` folder (one multi-page PDF or JPG/PNG files; several DNs per page is fine).
3. Double-click `run_daily.bat` and press Enter twice (or drag in other file/folder paths).
4. The result opens automatically from `output\DN_Reconciliation_<date>.xlsx`.
5. Chase drivers from the **MISSING** sheet; check the **Review** sheet rows by clicking the image link.

## One-time setup (no admin rights needed)
```
py -m pip install --user pymupdf
setx ANTHROPIC_API_KEY "sk-ant-..."
```
Close and reopen the Command Prompt after `setx`. pandas, openpyxl, anthropic and pillow
are assumed installed (`py -m pip install --user pandas openpyxl anthropic pillow` otherwise).
If you get an error about `output_config`, update the SDK: `py -m pip install --user -U anthropic`.

Command line: `py reconcile.py --report Credit_Invoices_ICC.xlsx --scans scans\ [--out output] [--workers 8]`

## Statuses
| Status | Meaning |
|---|---|
| MATCHED (green) | DN found in report, outlet code matches, stamp present |
| MATCHED_NO_STAMP (yellow) | Found and outlet matches, but no stamp/seal seen |
| OUTLET_MISMATCH (orange) | Invoice found, but DN outlet code differs from report Outlet ID |
| NOT_IN_REPORT (red) | DN number not in the report (note suggests a likely 1-digit misread) |
| UNREADABLE (grey) | Confidence < 70 %, number unreadable, or page failed |
| DUPLICATE (blue) | The same DN was already scanned earlier in this run (not double-counted) |
| MISSING | (MISSING sheet) report invoice with no scanned DN |

Rows needing a human look (UNREADABLE, DUPLICATE, NOT_IN_REPORT, OUTLET_MISMATCH) get a cropped
image saved in `output\review_images_<date>\`, linked from the Review sheet.

## How it works
- Report: finds the header row, forward-fills merged Driver/Outlet cells, keeps rows with an Invoice Number.
- Scans: PDF pages rendered with PyMuPDF (200 dpi); each page is sent to Claude (`claude-sonnet-4-6`)
  which returns strict JSON for **every** DN on the page, including a bounding box used for crops.
- 8 pages are read in parallel (`--workers`); 150 DNs typically take a few minutes.
- Results are cached in `output\.extraction_cache.json`: re-running after a crash or Ctrl+C
  only reads the pages not done yet, and costs nothing for pages already read.
- Nothing except the scan images is sent out; all files stay on the laptop.

## Testing without an API key
`py test_reconcile.py` builds a synthetic report (merged cells) and synthetic scans, runs the
full pipeline with a fake extractor, and checks every status.
