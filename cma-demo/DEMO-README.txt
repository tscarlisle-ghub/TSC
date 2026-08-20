CMA BILLING — DEMO COPY
========================

This is a standalone demo version of the billing dashboard, seeded with
seven fictional clients (Appleseed, Sample Hollow, Doe Farmhouse, Testerman
Pool House, Placeholder Estates, Prototype Cottage, Exampleton). None of the
names, dollar amounts, or contacts are real — they're built to exercise
every part of the app with working math:

  - Fixed, percentage, and tiered-percentage fee types
  - Phased and non-phased contracts
  - A construction-estimate revision that triggers the Contract True-Up
    ledger (see "Sample Hollow" on the New Invoice tab)
  - Paid, sent-but-unpaid, and overdue invoices (Cash Flow / Outstanding A/R)
  - A deposit paid slightly under the contract amount (shortfall rolls
    into SD) — see "Placeholder Estates"
  - A Proof-of-Concept fee credited toward the deposit — see "Exampleton"
  - A completed, closed-out project — see "Testerman Pool House"

DEMO MODE is on (see the top of app.js): this copy never reads or writes
the real GitHub repo, whatever is typed into Settings. All changes save
only to this browser's local storage, under separate keys from the live
app, so it can't collide with real client data even on the same computer.
"Generate Word Document" still works for real — it produces an actual
.docx using the bundled fonts/letterhead, built entirely client-side.

HOW TO RUN IT
-------------
Browsers block a page from fetching its own data.json file when opened
directly (file://), so serve the folder instead of double-clicking
index.html:

    cd cma-demo
    python3 -m http.server 8765

Then open http://localhost:8765 in a browser. To reset the demo data at
any point, clear this site's local storage (or open in a private window).
