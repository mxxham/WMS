# Cycle counting, recounts and variance investigation

Scope: how warehouses count to find a stock difference, confirm it, decide whether the book or the physical figure is wrong, and approve the correction. Context: Shell lubricant 3PL warehouse (cartons / pallets, pick face per SKU, FEFO, identity bin + SKU + batch + expiry, app already requires approval above 20 cartons and can create count tasks for every bin of a SKU).

Source quality: the strongest sources are vendor documentation (SAP EWM help / SAP Learning, Oracle Inventory and Oracle WMS Cloud, Infor WMS) and one public-sector procedure (US Navy supply manual on tpub.com). Many "best practice" numbers online come from vendor blogs (Cleverence, Racklify, MangoApps templates) and are illustrative, not standards. I could not fetch Piasecki's original text (inventoryops.com page 404) or APICS/ASCM primary material; the ABC tolerance numbers below trace to CPIM study guides.

## 1. Cycle counting methods and when each is used

### Takeaway
Mature WMSs combine a scheduled base (ABC frequency, or a fixed interval per product) with event-driven counts that fire during normal work: low/zero stock after a pick, first putaway into a bin, and short picks. Control-group counting is a diagnostic tool for finding process errors, not a coverage method.

### Cited Findings
- SAP EWM physical-inventory procedures: periodic/annual (bin- or product-specific, can block stock movements during the count), ad hoc (any time, e.g. after damage), low stock (bin-specific, triggered at task confirmation when stock left in the source bin falls below a threshold; PI document created automatically in the background), zero stock (low stock with threshold 0), low/zero stock check (same threshold, during picking, no PI document), putaway PI (at first putaway into a bin in the fiscal year the worker confirms the bin stock equals the task quantity), storage-bin check (verifies the product is in its bin, no quantity, "not a true PI"), cycle counting (ABC-classified; Cycle Counting Indicator with an interval in work days held on the warehouse product master; SAP's example counts fast movers every 2 months and very slow movers every 12 months) — [SAP Learning: Setting Up the Procedures for Physical Inventory](https://learning.sap.com/courses/basic-customizing-in-sap-s-4hana-ewm/setting-up-the-procedures-for-physical-inventory)
- Low-stock PI needs a quantity threshold per PI area; zero stock = threshold 0. First time stock drops below the limit a PI document is created; later occurrences only run the check without a document. A tolerance setting can cancel the low-stock check — [search summary of SAP Help / SAP Learning, "Performing a Physical Inventory"](https://learning.sap.com/courses/processes-in-sap-s-4hana-ewm/performing-a-physical-inventory)
- Short picks as count triggers: Oracle WMS Cloud has configurable cycle count triggers, with separate triggers for full-LPN, partial-LPN and active-location short picks — [Oracle WMS Cloud: Cycle Count Triggers](https://docs.oracle.com/en/cloud/saas/warehouse-management/24c/owmim/cycle-count-triggers.html) (search snippet; the fetched page was a landing page)
- Oracle WMS 25D added an item-driven option: on a short pick, a count task is created only for the short-picked SKU rather than the whole location; a location-driven task takes precedence over an item-driven one for the same location — [Oracle WMS 25D readiness](https://docs.oracle.com/en/cloud/saas/readiness/logistics/25d/wms25d/25D-wms-wn-f41381.htm) (search snippet)
- Infor WMS: a shorted RF pick adds the item/location to a "Request to Count" table; repeat short picks on the same owner/item/location/lot do not create a duplicate request — [Infor WMS: Creating a request to count](https://docs.infor.com/wms/2025.x/en-us/wmsolh/yxe1612894137851.html)
- ShipHawk treats a recorded short pick as effectively a count of zero for that location — [ShipHawk Cycle Count Types](https://shiphawk.atlassian.net/wiki/spaces/HELP/pages/396525746/Cycle+Count+Types) (search snippet)
- Common ABC frequency example: A monthly, B quarterly, C semiannually (example, not a rule) — [vskills CPIM tutorial](https://www.vskills.in/certification/tutorial/inventory-accuracy-and-cycle-counting/) (search snippet)
- Control-group counting: a small stable set of SKUs counted repeatedly over several weeks to learn whether a process change works; used during changes like new labelling or putaway rules; "for learning, not coverage". Weakness of ABC alone: errors in C items persist longer; random-sample counts cover that blind spot. Advice: recalculate ABC classes quarterly or half-yearly — [Cleverence: Cycle Counting methods](https://www.cleverence.com/articles/3pl-business/how-to-use-cycle-counting-to-improve-inventory-accuracy-5832) (vendor blog)
- Opportunity counts listed in practice: after receiving, before/after putaway, during picking/packing, after returns — same Cleverence source (vendor blog)

### Inferences
- For this warehouse the closest analogues already exist in the data: SAP's "low/zero stock check at pick" maps to "when a pick leaves a bin at or near 0, ask the picker to confirm it is empty"; "putaway PI" maps to confirming bin contents at putaway; "short pick trigger" maps to auto-creating a count task for the bin + SKU (item-driven, per Oracle 25D) rather than the whole location when a picker reports a short.
- The pick face is the highest-touch bin per SKU, so it fits the high-frequency (A-like) tier regardless of SKU class.
- The current "count every bin of a SKU" feature is a product-specific count in SAP terms; the low-stock / short-pick triggers are bin-specific. Both exist in SAP for different purposes.

### Gaps
- No primary Manhattan or Blue Yonder documentation on count triggers was retrieved.
- Piasecki's original recommendations (inventoryops.com) could not be fetched.

## 2. "Suspect location" counting: which bins to count first when a SKU total is off

### Takeaway
Published procedures agree on the search order in substance: recent transactions and unposted/rejected documents first, then adjacent and temporary locations (staging, dock), then master-data checks (unit of measure, item number). No vendor publishes a ranked bin-priority heuristic; it is practitioner procedure.

### Cited Findings
- US Navy "preliminary research" before adjusting (required for potential adjustments over $500 per line): review recent transactions, unposted or rejected documents, a "location survey" of adjacent or temporary locations, and catalog data (unit of issue, stock number changes) — [tpub.com: Navy supply inventory adjustments](https://www.tpub.com/ask/70.htm)
- Navy "causative research" = "complete review of all transactions" including receipts, issues, location changes and unposted/erroneous documents; if the cause is a prior adjustment, reverse it (look-back at least 12 months or to the last major inventory) — [tpub.com](https://www.tpub.com/ask/70.htm)
- Vendor guidance: when the system shows stock but it is physically missing, consider mis-slotting and search adjacent bins before treating it as shrinkage; place holds on affected SKUs and locations so the ledger does not change mid-investigation — [Cleverence: how to reconcile inventory variances](https://www.cleverence.com/articles/for-business/how-to-reconcile-inventory-variances-3816/); [Racklify: investigate and resolve a stock discrepancy](https://racklify.com/encyclopedia/how-to-investigate-and-resolve-a-stock-discrepancy-a-step-by-step-guide/) (search snippets, vendor/encyclopedia blogs)
- Sources also list receiving errors, unit-of-measure mistakes and catalog data as causes, not just adjacent bins — same search results
- Infor variance report defines a variance partly as "location On Hand is not the same as On Hand when the Cycle Count record was generated" — i.e., movements after the count was created are a known false-variance source — [Infor Cycle Count Variance Report](https://docs.infor.com/ism/5.x/en-us/ism_onlinehelp/mergedprojects/sm_main/forms/invtopic/variance_report.htm) (search snippet)

### Inferences
- A practical priority list for this warehouse, built from the cited categories: (1) bins with a movement of that SKU since the last good count (picks, putaways, Bin To Bin, replenishment destination and source); (2) the pick face and the reserve bin that last replenished it; (3) bins physically adjacent (same aisle, neighbouring bay/level, the opposite face of a back-to-back block); (4) STAGING / STAGING_INB / dock / Quarantine; (5) bins holding a similar-looking SKU (same brand, different viscosity or pack) — a swap shows as +x on one SKU and -x on another; (6) open or unposted tasks for the SKU. Category 5 is my inference; I found no published source naming look-alike SKUs.
- The Navy rule order (transactions and unposted documents before physical search) matters here: an unposted pick task explains a "missing" quantity without walking to any bin.

### Gaps
- No vendor documentation found that ranks candidate bins automatically for a SKU-level discrepancy.

## 3. Blind vs informed counts, recount rules, freezes and in-flight tasks

### Takeaway
Best practice is a blind first count, an automatic recount when the result is outside tolerance, done by a different person, with a limit on the number of automatic recounts after which the result goes to an approver. Movements during a count are handled either by freezing the location or by recording whether it had open work.

### Cited Findings
- SAP EWM: a recount tolerance group sets quantity (%) and value limits; exceeding them automatically creates a recount document. The check runs against the counter's tolerance group (mobile or desktop). Settings can route recounts to a separate queue and require a different user to do the recount. If the recount also exceeds tolerance, no second recount is triggered — [SAP Learning: Setting Up the Procedures for Physical Inventory](https://learning.sap.com/courses/basic-customizing-in-sap-s-4hana-ewm/setting-up-the-procedures-for-physical-inventory)
- Oracle Inventory: with Automatic Recount on, items outside approval tolerances get recount requests, repeated up to a configured "maximum automatic recounts"; once reached, the count is held for approval. Approvers can approve, request a recount, reject, or take no action pending investigation — [Oracle Inventory: Count Adjustments and Approvals](https://docs.oracle.com/cd/A60725_05/html/comnls/us/inv/ccadj.htm)
- Blind count = counter does not see the expected quantity; informed count = counter receives the count details first — [Extensiv: Blind count vs technical count](https://extensiv.helpjuice.com/wm-cycle-counting-classic/1619071-blind-count-vs-technical-count-classic); [Acctivate: Blind count](https://hub.acctivate.com/articles/blind-count) (search snippets)
- Recounts should be done by staff other than the original counter; some systems require two employees counting separately ("double blind") before posting — [Racklify: tagging, scanning and double blind counts](https://racklify.com/encyclopedia/methodology-tagging-scanning-and-double-blind-counts/) (search snippet)
- Illustrative recount triggers: variance over 2 units or 5% of expected; or 2% by quantity for C items / $50 by value for A items; if the recount still does not reconcile, escalate for root-cause review — [MangoApps cycle count SOP template](https://www.mangoapps.com/templates/sop/inventory-cycle-count-sop/run); [Manifest.ly cycle counting checklist](https://app.manifest.ly/public/checklists/16be3df01bc1fc4fee9a8bc8a510110b?modal=true) (templates, not standards)
- SAP periodic PI can block stock movements for the duration of the count — [SAP Learning](https://learning.sap.com/courses/basic-customizing-in-sap-s-4hana-ewm/setting-up-the-procedures-for-physical-inventory)
- Infor: a daily cutoff time for entering orders/receipts, with later transactions held until the count finishes — [Infor SXe cycle counting](https://docs.infor.com/sxe/2021.x/en-us/sxolh/jyy1503926132934.html) (search snippet)
- Guidance to define whether a location is frozen during counts and how open picks/putaways are handled, and to log with each count whether the location had open work, plus device, timestamp, user — [Cleverence: WMS cycle count](https://www.cleverence.com/articles/business-blogs/wms-cycle-count-4072/) (vendor blog)
- Oracle WMS Cloud shows a "To be Counted flg" on locations with a pending count task — [Oracle WMS Cloud: Cycle Count](https://docs.oracle.com/en/cloud/saas/warehouse-management/20d/owmol/user/topics/cycle_count.html) (search snippet)

### Inferences
- In this app's ledger model a picked-but-not-posted task means the physical bin is already lower than the book. The count should be compared against book minus quantities of tasks that are physically done but not posted (or the bin should be counted only when it has no open task); otherwise every in-flight pick shows as a false loss. Recording "open work at count time" on the count row is a cheap safeguard.
- A blind first count suits cartons on a rack; the SAP and Oracle pattern (one automatic recount by a different user, then stop and route to approval) avoids endless recount loops.

### Gaps
- No primary source with a mandated number of recounts beyond vendor configurability (SAP: one; Oracle: configurable maximum).

## 4. Misplaced item (relocate) vs real gain/loss (adjust); netting across bins

### Takeaway
Systems net differences for the same stock key before posting to the financial book (SAP EWM Difference Analyzer), and flag stock found in the wrong location as a location mismatch rather than a gain. A +x in one bin and -x in another of the same identity is a transfer, not two adjustments.

### Cited Findings
- SAP EWM Difference Analyzer aggregates differences sharing the same stock key at cumulative level, regardless of document or process, to show "the balance of the differences" so postings to ERP can be reduced, ideally to zero; differences can be posted cumulatively or individually; a tolerance excess is flagged when the absolute cumulative difference value exceeds the user's tolerance group — [SAP Help EWM 7.0: Difference Analyzer](https://help.sap.com/saphelp_ewm70/helpdata/en/4c/b4e7d24c1f1921e10000000a15822b/content.htm)
- Traffic lights: green = can post, yellow = post with warning, red = cannot post; at cumulative level green also needs no lock and customs-blocked stock balancing to zero — same SAP Help page
- SAP difference analyzer tolerance group (value-based) plus a wait time in days controls automatic posting to ERP (/SCWM/WM_ADJUST) — [SAP Learning](https://learning.sap.com/courses/basic-customizing-in-sap-s-4hana-ewm/setting-up-the-procedures-for-physical-inventory)
- Infor WMS: when a count finds an LPN the system records in another location, the count is set to "Location Mismatch" status and held — [Infor WMS: assisted cycle count by lot, location and LPN](https://docs.infor.com/wms/2024.x/en-us/useradminlib_op/sceinmgtug/pms1612893864154.html) (search snippet)
- HotWax/NetSuite books variances as inventory transfers to a "variance location" rather than direct adjustments — [HotWax Cycle Count](https://docs.hotwax.co/documents/learn-netsuite/integration-flows/cycle-count) (search snippet)
- Practitioners report that posting counts after parts moved post-creation puts "the right quantity in the wrong location" and creates transfer work — [EPI-USERS forum](https://www.epiusers.help/t/cycle-counting-moving-parts-since-period-created/105171.md) (forum, anecdotal)

### Inferences
- For this app: count all bins of the SKU (feature exists), then net per SKU + batch + expiry. Matched +x / -x pairs become a Bin To Bin movement (no net change, no SAP impact); only the residual becomes a gain/loss adjustment and goes to approval. Netting must not cross batch or expiry, since identity is bin + SKU + batch + expiry and FEFO depends on expiry.
- A residual of +x on SKU A and -x on look-alike SKU B in the same bin suggests a mis-putaway or mislabel, which needs a different correction from shrinkage.
- SAP's "wait time in days" before automatic ERP posting fits a practice of holding a difference open for a few days, because a late posting or a found pallet often clears it.

### Gaps
- No published numeric rule for how long to wait before declaring a residual a real loss.

## 5. Variance tolerances and tiered approval

### Takeaway
Tolerances are set as positive and negative percentages of system on-hand plus absolute value limits, often per ABC class. Above tolerance the result triggers a recount and then approval. Public procedures escalate approval by value bands. 3PL contracts add a shrinkage allowance, typically 0.5–1% of inventory value, and some require written client approval above an agreed threshold.

### Cited Findings
- Oracle Inventory: quantity variance tolerance = positive and negative % of system on-hand (looked up item → class → header, none = no limit); adjustment value tolerance = positive and negative value limits (class → header); hit/miss tolerance (class → header) measures counting accuracy, not inventory accuracy; measurement-error limits on the item suppress adjustment entirely for tiny differences on hard-to-count items — [Oracle Inventory: Approval Options and Tolerances](https://docs.oracle.com/cd/A60725_05/html/comnls/us/inv/ccapprov.htm)
- Oracle worked example (cost $10, +5% / -10% qty, +$200 / -$250 value): on-hand 100, count 106 → +6% exceeds positive qty tolerance; 88 → -12% exceeds negative qty; 122 → +$220 exceeds both; 73 → -$270 exceeds both. Note the asymmetry: tighter on gains than losses in this example — [Oracle](https://docs.oracle.com/cd/A60725_05/html/comnls/us/inv/ccapprov.htm)
- SAP EWM: posting tolerance group (quantity % and value) decides which differences a user may post; within limits, "Simultaneous Posting After Count Entry" posts immediately; larger differences go through /SCWM/PI_PROCESS. Users are assigned to tolerance groups (/SCWM/PI_USER_DIFF for difference analyzer, /SCWM/PI_USER for recount) — [SAP Learning](https://learning.sap.com/courses/basic-customizing-in-sap-s-4hana-ewm/setting-up-the-procedures-for-physical-inventory); [SAP Community: define PI tolerance group in embedded EWM](https://groups.community.sap.com/t5/supply-chain-management-blogs-by-members/how-to-define-physical-inventory-tolerance-group-in-embedded-ewm-in-s-4/ba-p/13433320)
- SAP KBA 3620391: a BAdI on /SCWM/PI_PROCESS can send an approval email when a PI document exceeds tolerance; no standard workflow approval step was found — [SAP KBA 3620391](https://userapps.support.sap.com/sap/support/knowledge/en/3620391) (search snippet)
- ABC accuracy tolerances commonly cited: ±0.2% A, ±1% B, ±5% C; record counts as accurate if variance is inside the band — [vskills CPIM tutorial](https://www.vskills.in/certification/tutorial/inventory-accuracy-and-cycle-counting/); [Trusted Institute CPIM](https://trustedinstitute.com/concept/cpim/inventory-management/inventory-accuracy-cycle-counting/) (study guides, not a primary APICS document)
- Accuracy targets cited: 95%+ common, 98% top performers; 98–99% at location level; always state tolerance, denominator, items and period when reporting accuracy — search summary of [Cleverence: inventory accuracy rate](https://www.cleverence.com/amp/articles/for-business/how-to-calculate-inventory-accuracy-rate-6381/) (vendor blog)
- US Navy approval bands: preliminary research for potential adjustments over $500/line; causative research for pilferable items at $500+, any adjustment $2,500+, any sign of fraud/negligence/theft; supply officer or CO approves; CO must sign gains/losses over $10,000 and any sign of fraud/theft; causative research within 30 days; documents kept 3 years — [tpub.com](https://www.tpub.com/ask/70.htm)
- 3PL shrinkage allowance typically 0.5–1% of inventory value, within which the provider is not liable; another source says 1–2% of value handled annually; sample clause: client absorbs up to 0.5% of monthly average inventory value — [Red Stag Fulfillment](https://redstagfulfillment.com/what-is-average-shrinkage-rate-for-3pl/); [Racklify: shrinkage allowance](https://racklify.com/encyclopedia/what-is-shrinkage-allowance-definition-and-contract-basics/); [ShipHero 3PL contract template](https://www.shiphero.com/blog/3pl-contract-template) (vendor sources; figures conflict)
- 3PL contract checklist: require written approval above an agreed threshold — [3PL Center: contract red flags](https://3plcenter.com/3pl-contract-red-flags/) (search snippet)

### Inferences
- A tiered scheme consistent with these sources, in cartons for this warehouse: (a) within a measurement-error band (e.g. 0 cartons for sealed pallets) → no adjustment; (b) inside tolerance → counter's result posts after one recount agrees; (c) above tolerance (the current 20-carton rule, ideally also a % of on-hand and a value limit, since 20 cartons of a premium SKU and 20 of a cheap one differ in value) → supervisor approval after a different-person recount; (d) above a higher band or with signs of theft → manager plus client (Shell) notification. The numbers for bands (c)/(d) are a policy decision; no published number fits lubricant cartons directly.
- Netting first (section 4) means the approval threshold applies to the residual per SKU + batch + expiry, not to each bin's raw difference.
- Oracle's asymmetric example (tighter on gains) is worth considering: unexplained gains often mean an unposted receipt or a mis-putaway from another SKU.

### Gaps
- No primary APICS/ASCM text retrieved for the ±0.2/1/5% figures.
- No Indonesian or Shell-specific 3PL approval thresholds found.

## 6. How count results feed back into reconciliation and close the case

### Takeaway
The count document moves through statuses (counted → recount → approved/rejected → posted); posted differences leave the open-difference list. Causative research and reversal of earlier wrong adjustments close the loop, and the results feed hit/miss and accuracy metrics.

### Cited Findings
- SAP EWM: once differences are posted to ERP (material document created), they no longer appear in the Difference Analyzer; posting can be scheduled as a background job — [SAP Help EWM 7.0 Difference Analyzer](https://help.sap.com/saphelp_ewm70/helpdata/en/4c/b4e7d24c1f1921e10000000a15822b/content.htm)
- Oracle: approval actions are approve, recount, reject, or leave pending investigation; recounts appear on the next cycle count listing — [Oracle Count Adjustments and Approvals](https://docs.oracle.com/cd/A60725_05/html/comnls/us/inv/ccadj.htm)
- Oracle hit/miss tolerance feeds a Hit/Miss Analysis report measuring counting-procedure accuracy — [Oracle Approval Options and Tolerances](https://docs.oracle.com/cd/A60725_05/html/comnls/us/inv/ccapprov.htm)
- Navy: causative research is done after the adjustment posts, within 30 days, prioritised by controlled items then by value; if the cause is a prior adjustment it is reversed; the supply officer reviews results to prevent recurrence — [tpub.com](https://www.tpub.com/ask/70.htm)
- Post adjustments with reason codes, investigation reference and timestamped evidence for the audit trail — [Cleverence: reconcile inventory variances](https://www.cleverence.com/articles/for-business/how-to-reconcile-inventory-variances-3816/) (vendor blog)

### Inferences
- In this app's model (corrections are new movements, never edits) a case closes with: the count rows, any Bin To Bin from netting, at most one adjustment movement per SKU + batch + expiry with a reason code, the approval record, and a link to the SAP-side reconciliation (Buku stok) showing the WMS vs SAP gap explained or carried forward.
- Root-cause tags (unposted task, mis-putaway, look-alike SKU, UoM, receiving error, true loss) recorded at close are what make later control-group or ABC re-weighting possible.

### Gaps
- No vendor source retrieved that describes reconciling a WMS count against a separate ERP (SAP) book kept by the client, beyond SAP EWM → ERP posting.
