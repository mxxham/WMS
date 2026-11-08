# WMS vs client-ERP (SAP) stock reconciliation practice and root-cause taxonomy

Context: Shell lubricant warehouse (Surabaya) run by a 3PL. The WMS holds physical stock per bin + SKU + batch + expiry, in cartons. SAP is Shell's book per SKU in plant / storage location WHS1, plus an inbound storage location. The 3PL cannot post in SAP. Every difference has to be explained to Shell, and Shell posts any correction.

Source quality: SAP-specific material is mostly SAP Community / archived SCN threads, SAP KBA previews and old SAP Help (4.70 / EWM 7.0) pages. Process material is mostly vendor and consultant blogs (Uphance, Cleverence, Houseblend, Fitgap, Racklify). I found no WERC/CSCMP standard that prescribes a reconciliation procedure. Thresholds quoted below are vendor examples, not industry standards.

## 1. Cadence and snapshot / cut-off rules

### Takeaway
Common practice is three layers: a daily operational comparison of exceptions, a weekly review of aged differences, and a month-end full reconciliation with a signed package. Everything depends on one written, agreed cut-off timestamp: both sides' exports are frozen at that moment, and anything posted on one side but not the other falls into a named "in-transit / timing" bucket.

### Cited Findings
- Illustrative policy: "run an operational comparison daily, review aged exceptions weekly, and obtain a signed package at month-end", calibrated to latency, risk and staffing — [Houseblend, NetSuite 3PL inventory reconciliation controls (Oct 2026)](https://www.houseblend.io/articles/netsuite-3pl-inventory-reconciliation-controls)
- Cut-off rules: pick the cut-off in one timezone and record the local equivalent and offset. Store the *effective* time separately from the requested-at, generated-at, received-at and ERP-created-at timestamps. Issue a provisional report first, then a controlled final one after an agreed "event-completeness window". A completed snapshot download is not automatically stock at the requested cut-off — [Houseblend](https://www.houseblend.io/articles/netsuite-3pl-inventory-reconciliation-controls)
- Month-end sequence: (1) agree a hard cut-off with the 3PL **in writing**, e.g. "end of day on the last business day of the month" in the 3PL's local time; (2) pull and archive ERP on-hand, WMS on-hand by SKU/bin and the open order book at cut-off, and "do not re-pull mid-cycle"; (3) build an in-transit ledger of five buckets (inbound POs not yet posted, returns not yet graded, picked-not-shipped, shipped-not-invoiced, transfers); (4) every variance is "explainable by one of these five buckets or it goes into the adjustment log"; (5) prove ERP physical = WMS + in-transit; (6) archive a closing artifact (cut-off timestamp, exports, in-transit totals, flagged variances, adjustment log, one-page trend summary) — [Uphance](https://uphance.com/blog/monthly-3pl-to-erp-reconciliation-sequence/)
- The same source: weekly light exception scan (SKUs over threshold, returns aged >10 business days); inbound PO posting lag "usually 24 to 72 hours", reconciled against the ASN and receiving report; quarterly/annual reconciliations are for audit, not operations — [Uphance](https://uphance.com/blog/monthly-3pl-to-erp-reconciliation-sequence/)
- Daily automated pipeline: ERP and WMS extracts on a schedule with a fixed daily cut-off (example: about 06:00 local), and a daily exceptions table with reason codes (missing in ERP, missing in WMS, quantity variance, date variance, duplicate, unknown SKU), triaged by an operations lead — [Fitgap (search snippet; page now returns HTTP 410)](https://us.fitgap.com/stack-guides/reduce-reconciliation-time-across-erp-wms-and-3pl-reports)
- WMS/ERP reconciliation cadence: "weekly for most operations, daily for high order volumes or strict service levels" — [Cleverence, inventory discrepancies](https://www.cleverence.com/amp/articles/3pl-business/dealing-with-inventory-discrepancies-causes-and-solutions-4837/)
- FMCG case study: rule-based daily analysis of stock differences and their likely causes, emailed to the responsible person — [JK Tech](https://jktech.com/success-stories/enabling-business-transformation-by-eliminating-stock-mismatch-reconciliation-increasing-stock-accuracy-and-reducing-financial-risk/)
- System-of-record split: the ERP owns contracts and financials; the WMS owns inventory states and locations — [Cleverence, 3PL how to manage inventory](https://www.cleverence.com/amp/articles/business-blogs/3pl-how-to-manage-inventory-4827/)

### Inferences
- For this site, the natural cut-off is "end of the operating day, Asia/Jakarta". Compare WMS stock at that moment with SAP **stock on posting date = that day** (MB5B, see section 2), not with whatever MB52 shows when someone happens to run it the next morning. MB52 is "now", and it includes postings Shell made after the cut-off.
- Since the 3PL cannot post in SAP, the "adjustment log" here is a *request list* to Shell. The closing package should separate items that are explained and self-clearing (timing) from items for which a Shell posting is requested.
- Late posting is built into this operation: putaway is booked the morning after arrival (see AGENTS.md), so the WMS itself has a one-day arrival/booking lag. The cut-off rule must say which date each side uses.

### Gaps
- No published 3PL-specific SOP (WERC, CSCMP, Logistics Management, DC Velocity) laying out a reconciliation cut-off procedure was found; the procedures above come from vendor blogs.

## 2. SAP reports and how to use them for a 3PL-run storage location

### Takeaway
For a 3PL comparing against SAP IM book stock, the useful set is: **MB52** (current stock per material / storage location / batch, split by stock type), **MB5B** (stock as of a posting date, i.e. the snapshot that matches a cut-off), **MB51** (the material document list that explains the movement between two dates), **MMBE** (single-material overview by stock type) and **VL06G** (outbound deliveries still waiting for goods issue). LX23 (classic WM) and /SCWM/ERP_STOCKCHECK + /SCWM/DIFF_ANALYZER (EWM) only apply when SAP itself runs WM/EWM for the location. In this setup the WMS is external, so they are references, not tools.

### Cited Findings
**MB52 / MB5B / MMBE / MB51**
- MB5B starts from the current stock balance and uses material documents to calculate back to the requested posting date. Posting date can differ from entry date and document date — [SCN thread on MB5B](https://scn.sap.com/thread/1254192); [SAP blog "MB5B – Stocks for Posting date"](https://blogs.sap.com/?p=409)
- Stock and values are held at **period** level, not per day, which is one reason MB5B can show odd or negative results when run per posting date — [SAP blog: MB5B offers negative results when executed per posting date](https://blogs.sap.com/2008/06/08/mb5b-offers-negative-results-when-executed-per-posting-date/)
- MB52 shows current overall stock "irrelevant of the period" — [SAP Answers: discrepancy between MC.5 and MB52](https://answers.sap.com/questions/7288140/discrepancy-between-mc5-and-mb52.html)
- SAP KBA 1917752: MB5B closing stock (stock on current date) can differ from MMBE — [SAP KBA 1917752](https://userapps.support.sap.com/sap/support/knowledge/en/1917752)
- MMBE gives a one-material overview split into unrestricted, quality inspection, blocked, reserved and in-transit; MB52 lists warehouse stock for many materials at plant / storage location level — [Guru99 MMBE](https://www.guru99.com/how-to-get-overview-of-material-stock.html)
- WM has no MB5B equivalent for warehouse (bin) stock positions on a past date — [SAP Answers: stock on posting date MB5B](https://answers.sap.com/questions/1175404/stock-on-posting-date-mb5b.html) (reported in the thread; not verified in SAP docs)

**In-transit / inbound storage location**
- A two-step plant-to-plant transfer uses 303/305; a two-step storage-location transfer uses 313/315 — [Consultoria-SAP: one-step and two-step transfer](https://www.consultoria-sap.com/2015/05/procedures-of-stock-transfer-posting.html)
- Stock moved with 303/305 (or 603/605) is "stock in transfer" (MARC-UMLMC) and shows in MB52's stock-in-transfer column. MB5T reads transit stock from PO history (stock transport orders) and does not always match MARC-TRAME. KBA 1800451 covers the missing link between 303/313 and 305/315 documents — [SAP Answers: stock in transit with 303 and 305](https://answers.sap.com/questions/6976254/stock-in-transit-while-using-303-and-305.html); sources disagree on MB5T coverage, see [SAP Community thread 1902977](https://archive.sap.com/discussions/thread/1902977)

**Outbound not yet goods-issued**
- VL06G lists outbound deliveries waiting for goods issue (VL06P for picking). Lines with a rejection reason are skipped — [se80 VL06G](https://www.se80.co.uk/sap-tcodes/?name=vl06g)
- SAP KBA 2914404: on HANA, deliveries can be missing from VL06G / the "Outbound Deliveries for Goods Issue" monitor (index SHP_IDX_GDSI, VBUK-WBSTK) — [SAP KBA 2914404](https://userapps.support.sap.com/sap/support/knowledge/en/2914404)
- In background goods-issue jobs, the actual-GI-date selection criterion is ignored — [SAP KBA 3066990 (preview)](https://userapps.support.sap.com/sap/support/knowledge/en/3066990)

**Stock types**
- Movement types between stock types (community sources): 321 QI → unrestricted; 343 blocked → unrestricted; 349 blocked → QI; 322/344/350 are their reversals. One deck conflicts on 344 — [Cleverence SAP stock types](https://cleverence.com/articles/sap-documentation/general-information-on-stock-types-8152); [MMBE stock status vs batch status (SAP blog)](https://blogs.sap.com/2014/01/17/mmbe-understanding-stock-status-versus-batch-status/)

**Classic WM: LX23**
- LX23 compares IM and WM stock per plant / storage location and can clear differences. SAP counts interim storage types (e.g. 902 goods receipt) as part of WM stock, so open transfer requirements / transfer orders leave stock "in interim" and show as a difference — [SAP archive thread 1327011](https://archive.sap.com/discussions/thread/1327011)
- LX02 includes interim storage bin stock; MC.9 shows only confirmed putaway stock — [SAP archive thread 817305](https://archive.sap.com/discussions/thread/817305)
- Clearing from LX23 creates a batch input session that clears IM. Negative WM stock and differences in returns are not cleared, and SAP recommends blocking the materials during clearing. LI20 clears WM (storage type 999); LI21 clears IM — [SAP archive thread 1439899](https://archive.sap.com/discussions/thread/1439899); [ERPLingo LX23](https://erplingo.com/sap-transaction-code/en/LX23)
- SAP Help (4.70): analyse the causes of differences from the output list **before** clearing them — [SAP Help 4.70 stock comparison](https://help.sap.com/saphelp_470/helpdata/en/c6/f83c484afa11d182b90000e829fbfe/content.htm)

**EWM / S/4HANA**
- /SCWM/ERP_STOCKCHECK is a check report for finding and correcting EWM-vs-ERP inconsistencies — [SAP Help EWM 7.0](https://help.sap.com/saphelp_ewm70/helpdata/en/4c/b611e2d5971384e10000000a42189c/content.htm)
- The Difference Analyzer (/SCWM/DIFF_ANALYZER) reviews differences at cumulative and detail level before posting to ERP. A difference can be locked with a reason while it is investigated — [SAP Help EWM 7.0 Difference Analyzer](https://help.sap.com/saphelp_ewm70/helpdata/en/4c/b4e7d24c1f1921e10000000a15822b/content.htm)
- In S/4HANA, a difference in ERP_STOCKCHECK is often an unposted difference. Check the Difference Analyzer and /SCWM/CORRECT_QUANTS (view P) — [SAP Community 12777106](https://groups.community.sap.com/t5/supply-chain-management-q-a/scwm-erp-stockcheck-stock-comparison-erp-mismatch-in-s-4-hana/qaq-p/12777106)
- Stuck qRFC queues (SMQ1/SMQ2) are a frequent cause of ERP-EWM differences — [SAP Community 723488](https://community.sap.com/t5/supply-chain-management-q-a/sap-ewm-ecc-stock-discrepency/qaq-p/723488)
- KBA 3666118: differences for some materials linked to restricted stock status in S/4HANA Cloud — [SAP KBA 3666118](https://userapps.support.sap.com/sap/support/knowledge/en/3666118)
- ECC vs S/4HANA: in S/4HANA, MATDOC replaces MKPF/MSEG, aggregate stock is computed on the fly through CDS views, and hybrid tables like MARD still return figures — [SAP Community: S/4HANA IM new simplified data model](https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-sap/sap-s-4hana-inventory-management-tables-new-simplified-data-model-nsdm/ba-p/13497469)

### Inferences
- Practical request to Shell (since the 3PL has no SAP posting rights): a daily export of **MB52 for plant / WHS1 + inbound sloc, by batch, with the unrestricted / QI / blocked / in-transfer columns**. At month-end add **MB5B at the cut-off date** for the same scope and **MB51 for the period**, filtered to the storage locations, with movement type, posting date and entry date. MB51 is what lets the 3PL prove a timing difference: a 601 GI posted for day D+1 against a delivery the WMS shipped on day D.
- Compare WMS **WHS1 + inbound location** together against SAP, then separately. A pallet received physically but still on SAP's inbound location (or vice versa) is a location/timing item, not a loss.
- Compare by **stock type**: WMS quarantine / damaged / blocked bins against SAP QI + blocked, and WMS pickable stock against SAP unrestricted.
- Open VL06G deliveries at cut-off are the SAP-side picture of "picked/shipped by WMS, GI not yet posted".
- Whether SAP holds batches for these SKUs determines whether the comparison can go down to batch level, or must stop at SKU level with WMS batch detail as supporting evidence.

### Gaps
- No SAP Help page was found that describes a 3PL (external WMS) reconciliation against IM; the procedure above is inferred.
- Fiori equivalents ("Stock – Multiple Materials", "Material Documents Overview") and how MB52/MB5B read MATDOC in S/4HANA were not confirmed from sources.
- It is not known whether Shell's WHS1 runs on ECC or S/4HANA, or whether batches are managed in SAP for these SKUs — this needs asking.

## 3. Root-cause taxonomy and which causes dominate

### Takeaway
Sources converge on two layers. **Book/system causes** (timing/cut-off, missing or duplicate transaction, mapping/UoM/master data, stock status) are explained and cleared without touching stock. **Physical causes** (receiving error, mispick / over- or under-ship, misplacement, count error, damage, shrink) need a count and a correction. No source gives a measured frequency distribution. The recommended way to find which causes dominate is to use reason codes on every difference and track them, with "unknown" kept small.

### Cited Findings
- Reconciliation reason codes with owners: TIME (timing, integration owner), MAP (mapping, master-data owner), MISS (missing event), DUP (duplicate), PHYS (physical, warehouse inventory owner), STATE (holds/reservations), COST (valuation, controller) — [Houseblend](https://www.houseblend.io/articles/netsuite-3pl-inventory-reconciliation-controls)
- Adjustment reason codes "a fixed list, not free text": pick error, receiving error, damage, shrink, system latency, returns lag, count error, unknown. If "more than 10 percent of your monthly adjustments by unit count go to unknown", the reconciliation is not diagnostic — [Uphance](https://uphance.com/blog/monthly-3pl-to-erp-reconciliation-sequence/)
- Where discrepancies appear: receiving variances, putaway mismatches, picking shorts, shipping overages, unreconciled returns, unexplained cycle-count adjustments. Underlying causes: process gaps, people (training, speed incentives), technology (scanner connectivity, unreadable labels), data (bad SKUs, wrong UoM, mismatched item masters). UoM errors that recur across SKUs point to data configuration; errors clustered in one zone, shift or task point to people or process — [Cleverence, discrepancies causes and solutions](https://www.cleverence.com/amp/articles/3pl-business/dealing-with-inventory-discrepancies-causes-and-solutions-4837/)
- Cause categories: receiving / putaway (wrong PO, case-vs-each scanning, untracked temporary locations), picking / shipping (unrecorded short-picks, unapproved substitutions, lot rules not enforced), returns (credited before inspection), master data and timing (UoM, timing differences) — [Cleverence, how to reconcile inventory variances](https://www.cleverence.com/articles/for-business/how-to-reconcile-inventory-variances-4827/)
- SAP-side system causes: interim storage / open TOs (WM), stuck queues, stock-type mapping errors, restricted status, report-vs-monitor mismatch — [SAP archive 1327011](https://archive.sap.com/discussions/thread/1327011); [SAP Community 723488](https://community.sap.com/t5/supply-chain-management-q-a/sap-ewm-ecc-stock-discrepency/qaq-p/723488); [SAP KBA 3026221](https://userapps.support.sap.com/sap/support/knowledge/en/3026221)
- Worked example: raw shortage 14 units, of which 12 are explained by shipment timing and 2 are an unexplained residual — [Houseblend](https://www.houseblend.io/articles/netsuite-3pl-inventory-reconciliation-controls) (illustrative, not measured)
- Benchmark for physical accuracy (location count accuracy, WERC DC Measures 2018 via Honeywell): median 98.40%, best-in-class ≥ 99.88%; the 2020 report gives best-in-class 99.9% — [Honeywell](https://sps.honeywell.com/us/en/support/blog/productivity/how-to-improve-accuracy-in-the-inventory-control-workflow-with-a-dc-walkthrough); [Yale/Logistics Management Top 12 DC metrics PDF](https://s3.amazonaws.com/scg-lm/pdfs/yale_wp_Top_12_distribution_center_metrics_021021.pdf)

### Inferences — taxonomy proposed for this site (WMS vs Shell SAP, cartons)
Grouped by how the difference clears:
1. **Timing / cut-off** (clears on its own within N days): GI posted by Shell the day after shipment; GR posted before or after physical putaway (WMS books putaway the morning after arrival); stock on the inbound sloc vs WHS1 transfer posted later; a backdated SAP posting date crossing the cut-off.
2. **Unposted / missing / duplicate document** (needs a Shell posting): delivery never goods-issued (sits in VL06G); GR never posted; a reversal on one side only; a double posting.
3. **Location / status mapping** (no stock moves; it is a reclassification): WMS quarantine / damaged / expired bins vs SAP unrestricted; SAP QI / blocked vs WMS pickable; inbound location vs WHS1.
4. **Master data / UoM**: carton vs pallet vs litre conversion, wrong UPP, SKU code mapping, a material that exists on one side only.
5. **Batch / expiry identity**: right quantity under the wrong batch; Excel-mangled batch codes (the repo's `docs/DATA_ISSUES.md` already records batches read as dates). These are zero-sum across batches of one SKU.
6. **Physical — operational error**: mispick (wrong SKU or batch shipped, so one SKU is over and another short, often offsetting), over- or under-shipment, receiving miscount, putaway to the wrong bin (WMS shows the bin empty; total SKU stock is still right).
7. **Physical — loss**: damage not reported, leakage (lubricants), theft or shrink, count error.
- A useful heuristic: differences that **offset** across two SKUs or two batches on the same day point to a mispick or batch swap. A difference equal to a whole delivery or GR quantity points to a timing or unposted document. Multiples of UPP, or ratios like 1:12, point to UoM.

### Gaps
- No source gave an empirical frequency ranking of root causes for 3PL-vs-ERP differences; "timing is most common" is widely asserted in practice writing but I found no measured data. Treat it as a hypothesis to test with this site's own reason-code history.

## 4. Order of investigation

### Takeaway
Sources agree on "book first, physical last": rule out cut-off and unposted or duplicate transactions, then mapping, status and UoM, then trace the transaction history of the item and bin. Recount and adjust only when the difference is still unexplained or above a threshold, and never adjust before investigating. One source places a quick recount earlier, before assigning a root cause.

### Cited Findings
- "Start with scope, mapping, timing, completeness, and physical evidence"; "Do not classify an unexplained delta as a [ERP] defect" — [Houseblend](https://www.houseblend.io/articles/netsuite-3pl-inventory-reconciliation-controls)
- "Reconcile physical first, then commitments", but only after the in-transit buckets are built: ERP physical = WMS + in-transit — [Uphance](https://uphance.com/blog/monthly-3pl-to-erp-reconciliation-sequence/)
- Investigation order: (1) transaction history (receipts, moves, picks, adjustments) and device logs; (2) labels, UoM, lot/serial; (3) interview whoever last handled the item or location; (4) timing gaps between the floor and system postings; (5) systematic patterns (one workstation repeatedly posting to the wrong location points to configuration). "Evidence beats memory" — [Cleverence, how to reconcile inventory variances](https://www.cleverence.com/articles/for-business/how-to-reconcile-inventory-variances-4827/)
- Trace the last movements (picks, replenishments, adjustments) before adjusting; adjust only after investigating; record the cause and a countermeasure — [Cleverence, keeping accurate counts](https://www.cleverence.com/amp/articles/3pl-business/how-to-keep-accurate-inventory-counts-3pl-warehouse-4729/); check location history and inbound records and assign an owner to each corrective action — [Denholm Good Logistics](https://denholmgoodlogistics.com/how-to-correct-inventory-errors-and-delays-with-your-3pl-provider/)
- "Fix data first" (item masters, UoM mapping, barcodes) "so people have a fair shot at accuracy" — [Cleverence, discrepancies](https://www.cleverence.com/amp/articles/3pl-business/dealing-with-inventory-discrepancies-causes-and-solutions-4837/)
- SAP: analyse the output list before clearing; lock a difference while investigating — [SAP Help 4.70](https://help.sap.com/saphelp_470/helpdata/en/c6/f83c484afa11d182b90000e829fbfe/content.htm); [SAP Help EWM 7.0](https://help.sap.com/saphelp_ewm70/helpdata/en/4c/b4e7d24c1f1921e10000000a15822b/content.htm)
- On-device trigger example: "±2 units or ±1%" prompts a second count before posting; big swings go to supervisor review — [Cleverence, reconcile variances](https://www.cleverence.com/articles/for-business/how-to-reconcile-inventory-variances-4827/)

### Inferences — procedure for this site, per SKU with a difference
1. **Same moment?** Confirm the SAP figure is stock at the cut-off (MB5B / dated MB52 export), not a later run.
2. **Same scope?** Add WHS1 + inbound sloc and compare all stock types. Then compare per stock type (WMS quarantine / damaged vs SAP QI / blocked).
3. **Timing:** list MB51 documents for the SKU from D-3 to D+2 against WMS shipments and receipts for the same days. Match by delivery / DO number and quantity. A matched pair posted on different days = TIME, and it clears itself.
4. **Unposted / duplicate:** WMS shipments with no SAP 601 (check VL06G), WMS receipts with no SAP 101, one-sided reversals. These become a posting request to Shell.
5. **UoM / master data:** is the difference a multiple of UPP, or a pack-size ratio? Is the SKU mapped?
6. **Offsetting SKU / batch:** search for an equal and opposite difference on a similar SKU or another batch on the same day (mispick or batch swap).
7. **Physical:** count the SKU's bins (all expiries), staging and quarantine; check pick/putaway history in the WMS ledger (`movements`).
8. Only then classify as PHYS (receiving error, mispick, misplacement, damage, shrink) or UNKNOWN, with evidence attached.

### Gaps
- No authoritative standard fixes the exact order; the sequence above is a synthesis.

## 5. Tracking open differences: aging, carry-forward, escalation, sign-off

### Takeaway
Good practice keeps a difference register: each difference has an ID, an owner, a reason code, an "explained / unexplained" state and an age. Open items carry forward to the next reconciliation so they cannot vanish. Escalation runs on age and on size, while unknown identifiers and incomplete extracts escalate whatever their value. Month-end closes with a maker/checker sign-off plus warehouse acknowledgement, and adjustments always need an approver.

### Cited Findings
- Aging buckets (illustrative): under 24 h, 24–72 h, over 72 h. Unknown identifiers, serial mismatches and incomplete extracts escalate regardless of value — [Houseblend](https://www.houseblend.io/articles/netsuite-3pl-inventory-reconciliation-controls)
- "Record any carryforward exception against the next reconciliation" so a restart cannot silently erase it — [Houseblend](https://www.houseblend.io/articles/netsuite-3pl-inventory-reconciliation-controls)
- Thresholds (illustrative): review at an absolute residual of 5 units or $100 exposure. Differences under the threshold still need an approved disposition and "do not authorize automatic write-offs" — [Houseblend](https://www.houseblend.io/articles/netsuite-3pl-inventory-reconciliation-controls)
- SKU threshold example: "1 percent of on-hand or 5 units, whichever is greater". Above it, count before closing; below it, adjust and log. Tighter for high-value SKUs. Monthly adjustments should trend below 0.5% of total units — [Uphance](https://uphance.com/blog/monthly-3pl-to-erp-reconciliation-sequence/)
- Explained variance sits in a named in-transit bucket. Unexplained variance goes to the adjustment log with SKU, signed delta, reason code and approver. The unknown share is tracked month over month — [Uphance](https://uphance.com/blog/monthly-3pl-to-erp-reconciliation-sequence/)
- Maker/checker: the maker prepares the reconciliation and the proposal; the checker reviews the evidence and authorizes posting or continued monitoring. Close checklist: scope, cut-off, completeness, bridge review, accepted exceptions (owner, due date, close decision), verified corrections, retained approvals (maker, checker, warehouse acknowledgement, separate valuation decision). After a posting, rerun the comparison — [Houseblend](https://www.houseblend.io/articles/netsuite-3pl-inventory-reconciliation-controls)
- Segregation of duties: whoever handles receiving should not approve the adjustment that corrects receiving variances. Keep evidence (timestamps, user IDs, photos) for client disputes — [Racklify, reconciling inventory variance](https://racklify.com/encyclopedia/reconciling-inventory-variance-procedures-kpis-and-automation/)
- Audit trail: who counted, who approved, which device posted, which ERP object was created — [Cleverence, reconcile variances](https://www.cleverence.com/articles/for-business/how-to-reconcile-inventory-variances-4827/)
- EWM lets a difference be locked with a reason while under investigation, which in effect is an "open, being investigated" state — [SAP Help EWM 7.0](https://help.sap.com/saphelp_ewm70/helpdata/en/4c/b4e7d24c1f1921e10000000a15822b/content.htm)

### Inferences — register design for this site
- One row per SKU (optionally batch) per difference. Fields: first-seen date, cut-off, WMS qty, SAP qty, delta in cartons, reason code (TIME / UNPOSTED / STATUS / LOCATION / UOM / BATCH / PHYS-* / UNKNOWN), evidence (DO no., SAP doc no., count id), owner (3PL or Shell), state (open → explained → cleared by self-reversal | cleared by Shell posting | accepted loss), last-seen date.
- A TIME item that is still open after its expected clearing day (e.g. D+2) is promoted to UNPOSTED and escalated to Shell. An UNKNOWN item older than one week triggers a count. Anything still open at month-end goes into the signed package as an explicit carry-forward.
- Fits the repo's audit rules: register rows should be append-only (state changes as new rows), like `movements`.
- Month-end sign-off with Shell: the 3PL (maker) presents the bridge "SAP book = WMS physical ± timing ± unposted ± status ± accepted differences". Shell (checker) agrees, then posts the corrections, and the next reconciliation verifies them.

### Gaps
- No source on contractual shrinkage allowances or liability splits between a 3PL and its client (typical 3PL contracts cover this, but nothing citable was found).
- No Indonesia-specific or Shell-specific reconciliation practice was found.
