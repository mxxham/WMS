# Governance of inventory adjustments and how corrections flow from a 3PL WMS into the stock owner's SAP

Context: Shell lubricant warehouse, Surabaya (PT Cipta Krida Bahari, 3PL). The 3PL's WMS is the physical source (per bin / batch / expiry, cartons) and the 3PL cannot post in Shell's SAP. Shell's SAP is the book (storage location WHS1). Movement types seen locally: 101/102, Z31, 311, 601/602, 343/344, Z55 (write-off). **Z31 and Z55 are client-specific custom types. Only Shell's SAP configuration (OMJJ) can say what they do. Nothing below defines them.**

Source quality note: SAP's own documentation (help.sap.com, learning.sap.com, community.sap.com blogs) was often not readable (403 errors or partial pages). Many movement-type meanings below therefore come from SAP Community forum archives and training sites. Those sources agree on the core meanings, and I flag where they disagree. Most of the governance sources are practitioner, vendor or consultant pages, not standards bodies. I could not retrieve the PCAOB AS 2510 text (403).

## 1. Adjustment governance: segregation of duties, reason codes, audit trail, correcting entries, approval tiers, SOX-style expectations

### Takeaway
Practitioner and SOX-oriented guidance agrees on four things:
- **Separate duties:** counting, approving and posting are done by different people, and whoever has custody does not also count.
- **Reason codes:** every adjustment carries a mandatory reason code from a fixed list, plus evidence.
- **Tiered approval:** approval escalates by quantity or value, but the thresholds are company-set. SOX prescribes no number.
- **Immutable trail:** the log records user, timestamp and before/after quantities. Errors are fixed with a reversing or correcting entry, never by deleting the record.

### Cited Findings
- **Segregation of duties.** "Counters should not be the same people who post or approve adjustments." No single person should be able to create an item, receive it and approve a write-off. — [Racklify audit trail](https://racklify.com/encyclopedia/inventory-adjustment-audit-trail-best-practices-for-compliance-and-internal-control/); [Cleverence internal controls](https://www.cleverence.com/articles/for-business/internal-controls-over-inventory-4821/)
- **SOX control list (consultant source).** It separates "Counting vs. Adjusting" (the counter should not approve adjustments) and custody vs counting. It requires supervisor review and sign-off on count sheets, and investigation of post-count variances with documented resolution. Named deficiencies include "Excessive user access to inventory adjustment functions without approval workflows" and "failure to investigate variances above threshold". Typical practice is an annual full count supplemented by cycle counts, counting high-risk categories more often. — [CPCON SOX inventory controls](https://cpcongroup.com/sox-inventory-controls/)
- **Approval thresholds.** Thresholds can vary by adjustment amount, inventory category, business unit or reason code. A small quantity correction follows the standard workflow; a material financial adjustment gets extra review. Record the requester, reviewer, approval date, reason, and original and adjusted quantities. — [Hyperbots glossary](https://www.hyperbots.com/glossary/inventory-adjustments-approval)
- **Escalation.** Define dollar or percentage thresholds that require escalating approvals for larger adjustments. — [Racklify audit trail](https://racklify.com/encyclopedia/inventory-adjustment-audit-trail-best-practices-for-compliance-and-internal-control/)
- **No statutory threshold.** SOX prescribes no numeric threshold, so the cut-off is a company choice. — summary of [CPCON physical inventory SOX](https://cpcongroup.com/insights/physical-inventory-sox-compliance/)
- **What auditors check.** Auditors inspect a period's adjustment entries for reason codes, documentation and authorization, and review segregation of duties across receiving, adjustments and approvals. — [Cleverence internal audit procedures](https://www.cleverence.com/articles/for-business/internal-audit-procedures-for-inventory-4821/)
- **Count observation and cutoff.** Auditors observe counts, perform test counts, evaluate controls over count tags and lists, and test transactions around the count date for correct period. — [Cleverence inventory auditors](https://www.cleverence.com/articles/for-business/inventory-auditors-5283/)
- **WMS adjustment workflow.** Steps: detect (receiving, picking, cycle count, returns, QA) → capture evidence (photos, count sheets, lot/serial, ASN, location history) → quarantine stock whose status is uncertain → decide disposition (reclassify, rework, return to vendor, scrap) → route for approval → post → file documentation and follow up out-of-tolerance variances.
  - Required fields: SKU, lot, unit of measure, location, physical count, recorded count, variance, reason code, supporting documents, approver ID.
  - Write-offs and significant reductions need photos or QA reports.
  - Transaction types are separate: count correction, reclassification (quarantine/release), write-off/scrap, RTV, and inbound recount.
  - The log is immutable: user, timestamp, before/after, attached evidence.
  - Operations and finance hold joint reviews of high-impact adjustments.
  - Source: [Racklify adjustment workflow](https://racklify.com/encyclopedia/how-to-process-inventory-adjustments-in-warehouse-operations-workflow-documentation-and-wms-settings/)
- **Common failures.** "Missing supporting evidence, using vague reason codes, skipping approval thresholds, and posting a journal without reconciling it back to the source discrepancy." — [MangoApps Inventory Adjustment Journal SOP](https://www.mangoapps.com/templates/sop/inventory-adjustment-journal-sop)
- **Reason codes drive accounting.** In EDI 947 (Warehouse Inventory Adjustment Advice), the 3PL's per-line reason code chooses the GL account in the owner's ERP. Example codes: DA damage, SH shrinkage, RT return, CC cycle count. Code values are 3PL-specific. Positive adjustments are rejected by default, because they "can also signal data issues". — [Orderful 947 docs](https://docs.orderful.com/docs/947-inventory-adjustment-advice)
- **Corrections are reversals, not deletions (SAP).** Each SAP movement type has a paired reversal, conventionally the type number + 1 (101→102, 311→312, 601→602). A wrong posting is cancelled by reversing it, not by deleting the document. Pairs are configurable per system. — [SAP archive thread](https://archive.sap.com/discussions/thread/497925); [stechies movement types](https://www.stechies.com/some-imp-movement-types-in-sapmm/)

### Inferences
- The WMS rules this project already has map directly onto these controls:
  - "movements cannot be edited or deleted; a correction is a new movement"
  - the movement author is forced to the session account
  - role checks are in the database
- What the guidance adds on top is:
  - a fixed reason-code list per adjustment type (damage, count variance, expiry, theft/loss, found stock, wrong SKU, wrong batch/expiry)
  - mandatory evidence for write-offs
  - a rule that the person who counted cannot approve or post the same adjustment
  - approval tiers by carton quantity or value
- Positive adjustments (found stock) deserve as much scrutiny as negative ones. The Orderful default of rejecting positive adjustments reflects that found stock often points to an earlier mis-pick, mis-putaway or wrong-SKU receipt rather than a true gain.

### Gaps
- I found no IIA or COSO primary text specific to inventory adjustments. The SOX material is consultant guidance.
- I could not fetch the PCAOB AS 2510 text (403). Its provisions on inventory held by others (confirmation from the custodian, and observation or testing of the custodian's controls) are relevant to a 3PL, but are not quoted here.
- I found no published numeric approval tiers from real logistics companies, only "define thresholds" advice.

## 2. SAP movement types used for corrections, and the MI01 → MI04 → MI07 flow with tolerances

### Takeaway
In SAP Inventory Management (IM), count differences are posted with standard **701** (gain) / **702** (loss). The system chooses between them automatically from the count result in MI07. 703/704 cover quality-inspection stock and 707/708 cover blocked stock.

In classic WM, **711/712** clear differences through interim storage type 999 (LI20 → LI21).

Write-offs use 551 (from unrestricted), 553 (from quality inspection) and 555 (from blocked). Status changes use 343/344, 349/350 and 321/322. 311 transfers between storage locations, 309 transfers material to material, 501 receives without a PO, and 101/102 and 601/602 are the GR and delivery GI types with their reversals.

**Every type numbered 9xx or starting with X, Y or Z is customer-defined** (copied from a standard type in OMJJ). Z31 and Z55 are therefore Shell-specific, and only Shell can say what they do.

### Cited Findings

**Physical inventory (IM)**
- **701/702 are system-selected.** MI07 posts 701 when the counted quantity is greater than book stock and 702 when it is less. The posting does not depend on a movement type the user chooses, so custom types are not triggered from MI07. — [SAP Answers 701/702](https://answers.sap.com/questions/3602905/movements-701-and-702.html); [SAP archive thread](https://archive.sap.com/discussions/thread/1915876)
- **703/704 and 707/708.** 703/704 are GR/GI for quality-inspection stock differences; 707/708 for blocked stock. — [Guru99 physical inventory](https://www.guru99.com/all-about-physical-inventory.html). One forum lists only 707 for blocked stock; check the system. — [SAP Answers 701-704](https://answers.sap.com/questions/7161157/mvt-type---701702703704.html)
- **Valuation.** The difference is valuated, for example at moving average price. MI07 shows the difference amount ("the value of the missing items"). — [SAP Help 4.6C, Posting Differences](https://help.sap.com/saphelp_46c/helpdata/en/fd/45bc379d6411d189b60000e829fbbd/content.htm)
- **Document flow.**
  - **MI01** creates the document (plant, storage location, materials). Options: **Posting Block** (stops goods movements during the count) and **Freeze Book Inventory** (records the book balance on the document).
  - **MI02/MI03** change or display the document.
  - **MI04** enters counts, with a warning when the count differs from book. A suspected count error is recounted with **MI11** (the source also mentions MI05).
  - **MI07** posts the differences on a chosen posting date. It accepts an optional maximum-difference threshold in local currency and creates a material document, which can be checked in **MB03**.
  - **MI08** counts and posts in one step.
  - Sources: [Guru99](https://www.guru99.com/all-about-physical-inventory.html); [SAP Answers](https://answers.sap.com/questions/6492623/inventory.html)
- **Reason codes per movement type.** If configuration makes the reason mandatory for 701/702, MI07 fails with error M7 325 "A reason has to be entered for movement type". A default reason can be set. — [SAP archive, MI07 default reason code](https://archive.sap.com/discussions/thread/1772583)
- **Tolerance groups (OMJ2).**
  - Physical inventory tolerances are defined per tolerance group at company-code level: a maximum value per physical inventory document and per document item. Users are then assigned to a group.
  - A user with no tolerance group gets no tolerance check.
  - If a document exceeds the group's limit, the user cannot post its differences. Errors seen: M7777/M7778/M7779 (SAP KBA 1645461).
  - Sources: [SAP Answers OMJ2](https://answers.sap.com/questions/6765500/omj2.html); [SAP archive 3551424](https://archive.sap.com/discussions/thread/3551424); [SAP KBA 1645461 (preview)](https://userapps.support.sap.com/sap/support/knowledge/en/1645461); [table T043I](https://leanx.eu/en/sap/table/t043i.html)
- **OMJ2 does not cover classic WM.** Community-reported: OMJ2 limits apply only to IM inventory differences; there is no value-tolerance check for WM physical inventory. — [SAP Answers tolerance limits](https://answers.sap.com/questions/13093130/physical-inventory-tolerance-limits-maintained-in.html)
- **EWM has its own groups.** Tolerance groups are assigned to users via /SCWM/PI_USER, with a separate group for the difference analyzer. — [SAP Community EWM blog](https://groups.community.sap.com/t5/supply-chain-management-blogs-by-members/how-to-define-physical-inventory-tolerance-group-in-embedded-ewm-in-s-4/ba-p/13433320)

**Warehouse Management (classic WM)**
- **711/712.**
  - 711: stock is in the books but missing from the bin. It is posted to interim difference storage type 999.
  - 712: stock is in the bin but not in the books. It is cleared out of 999 into the warehouse.
  - 711/712 apply only to unrestricted stock; other stock categories need their own types.
  - Movement types are defined per warehouse in table T322.
  - Sources: [SAP archive 3641169](https://archive.sap.com/discussions/thread/3641169); [SAP archive 2014607](https://archive.sap.com/discussions/thread/2014607)
- **WM count flow.** LI01N create → LI02N activate → LI11N count → LI20 clear in WM (moves the difference to 999 and unblocks the bin) → LI21 clear in IM (creates the IM material document that reduces or increases stock). — [SAP Answers WM physical inventory](https://answers.sap.com/questions/4131885/wm-physical-inventory.html)
- **SAP note 1557004.** Movement type 712 should not be used in MM transactions. — cited in [SAP archive thread](https://archive.sap.com/discussions/thread/2014607)

**Scrapping and stock status**
- **551/553/555.** 551 scraps from unrestricted, 553 from quality inspection, 555 from blocked. Reversals are 552, 554 and 556. One blog describes 555 as project-stock scrapping; that is an outlier. — [mohanranga movement types](https://mohanranga.squarespace.com/blogs/movement-types); [SAP archive 497925](https://archive.sap.com/discussions/thread/497925)
- **343/344.** 343 moves blocked → unrestricted. 344 is listed inconsistently: as the reversal (unrestricted → blocked) or as another direction. Treat the direction as something to verify in the client's OMJJ. 344 is commonly used to block unrestricted stock. — [SAP Answers convert unrestricted to blocked](https://answers.sap.com/questions/7558827/convert-stock-from-unrestricted-use-to-blocked-sto.html); [SAP archive 497925](https://archive.sap.com/discussions/thread/497925)
- **349/350 and 321/322.** 349 moves blocked → quality inspection, and 350 is its reversal. 321 moves quality inspection → unrestricted, and 322 is its reversal. A QM usage decision triggers 321. — [SAP archive 1055066](https://archive.sap.com/discussions/thread/1055066); [SAP Learning, transfer postings](https://learning.sap.com/courses/inventory-management-in-sap-cloud-erp/explaining-transfer-postings-1)
- **No accounting impact.** Stock-type changes within the same plant and material carry no accounting posting; the value stays the same. — [SAP archive 903720](https://archive.sap.com/discussions/thread/903720)
- **Inconsistent status.** A 2025 community thread: a reversal of 350 failed and 343 was used instead, after which QA32 still showed the stock as blocked. The inspection lot and the stock status can disagree. — [SAP Community QA32 350](https://community.sap.com/t5/enterprise-resource-planning-q-a/qa32-350-movement/qaq-p/13991928)

**Other relevant types**
- **309.** Material-to-material transfer posting, from the unrestricted stock of one material to another. It is used when the wrong SKU was booked. — [SAP archive 497925](https://archive.sap.com/discussions/thread/497925)
- **311/312.** One-step transfer between storage locations, and its reversal. Physical stock transfers always involve a physical goods movement, unlike stock-type changes. — [Guru99 inventory management](https://www.guru99.com/overview-of-inventory-management.html); [SAP Learning](https://learning.sap.com/courses/inventory-management-in-sap-cloud-erp/explaining-transfer-postings-1)
- **101/102, 501/502, 601/602.** 101/102: GR against a PO, and its reversal. 501/502: GR without a PO, and its reversal (503 and 505 for quality and blocked stock). 601/602: GI for an outbound delivery, and its reversal. — [stechies](https://www.stechies.com/some-imp-movement-types-in-sapmm/); [SAP archive 497925](https://archive.sap.com/discussions/thread/497925)
- **Custom (Z) types.**
  - Created in OMJJ by copying a standard type ("Copy as", copy dependent entries), with a key starting with 9, X, Y or Z. Standard SAP uses up to about 899.
  - Control indicators are inherited from the reference type. The custom reversal pair is set in "Reversal/follow-on movement types".
  - Some systems restrict the allowed range per work area (error SV033).
  - Sources: [SAP archive 1036798](https://archive.sap.com/discussions/thread/1036798); [SAP archive 533889](https://archive.sap.com/discussions/thread/533889); [saponlinetutorials](https://saponlinetutorials.com/?p=5650)

### Inferences
- **Z55 (write-off).** It is probably a copy of 551 or 555 with its own G/L account or reason. **Z31** could be a copy of a 3xx transfer type (for example 311 or 321) or something else entirely. **Both are unverified.** Ask Shell's SAP team for the OMJJ definition and the reversal pair of each.
- **The 3PL's correction request has to name which SAP correction it implies.**

| Situation | SAP correction | Note |
|---|---|---|
| Count variance | Shell runs MI01/MI04/MI07 (701/702), or a direct 551/Z55 or 501 | Depends on Shell's policy; MI07 keeps the PI document trail and the OMJJ/OMJ2 controls |
| Wrong SKU | 309 | |
| Wrong storage location | 311/312 | |
| Damaged stock | 344 (or a status-change equivalent) to block, then 555 or Z55 to scrap | |
| A GR or GI posted wrong | Reverse it: 102 or 602 | |

- **Batch and expiry corrections.** The WMS's stock identity is bin + SKU + batch + expiry. In SAP, a batch is corrected by a batch-to-batch transfer, not a material change. If SAP manages WHS1 without batches, those corrections never reach SAP and stay WMS-internal.

### Gaps
- I could not confirm 309 batch-to-batch usage, or the exact 344 direction, from an official SAP Help page.
- I found nothing on the authorization objects behind MI07 or movement types (M_MSEG_BWA etc.) in the retrieved sources.
- I found no source on whether Shell Indonesia uses IM-only, classic WM or EWM for WHS1.

## 3. How a 3PL without SAP access requests a correction in the client's SAP

### Takeaway
The documented pattern is:
1. The 3PL sends a daily stock snapshot.
2. The owner compares it with its SAP snapshot.
3. Discrepancies are investigated, and adjustments are sent to the owner either electronically (EDI 947 / stock-adjustment IDocs with reason codes) or as a documented adjustment request.
4. The owner posts them under its own controls.

Who bears the cost depends on the contract: shrinkage inside an allowance (often 0.5–1% of value) is absorbed by the owner, and loss above it is reimbursed by the 3PL. I found no published standard for turnaround times or request forms.

### Cited Findings
- **Snapshot comparison.** The 3PL's stock snapshot is compared with SAP's, and stock-adjustment IDocs are issued from the warehouse system for mismatches. A daily 3PL stock report compared with SAP is the common setup. — search summary of [SAP Community, inventory reconciliation at 3PL](https://community.sap.com/t5/supply-chain-management-q-a/inventory-reconciliation-problem-at-3pl/qaq-p/12781314) (page 403 on fetch); [SAP Answers 3pl inventory reconciliation](https://answers.sap.com/questions/12408851/3pl-inventory-reconciliation.html)
- **Causes of WMS-vs-SAP mismatch.** IDoc failures; WMS transactions with no preceding SAP document; WMS transactions that never trigger an SAP posting; different material naming. A daily rule-based job proposes root causes and emails the stock controller. — [JK Tech case study](https://jktech.com/success-stories/enabling-business-transformation-by-eliminating-stock-mismatch-reconciliation-increasing-stock-accuracy-and-reducing-financial-risk/)
- **Electronic advice.** EDI 947 reports adjustments not tied to a shipment or receipt (damage, shrinkage, cycle count, returns, reclassification). The owner's system maps the reason code to a GL account and rejects lines it cannot map.
  - Recommendation: ask the 3PL to split 947s by reason code, and to include order references.
  - Source: [Orderful 947](https://docs.orderful.com/docs/947-inventory-adjustment-advice)
- **Customer reconciliation report.** Template contents: WMS balance, physical count, variance, and a root-cause review of recurring issues. — [MangoApps 3PL customer inventory reconciliation audit](https://www.mangoapps.com/templates/inspections/3pl-customer-inventory-reconciliation-audit)
- **The 3PL flags early.** The 3PL WMS should flag discrepancies early and send reason codes back for adjustments. — [C3 Solutions 3PL process flow](https://www.c3solutions.com/blog-c3/3pl-process-flow/)
- **Contract terms on adjustments.** The contract should define who may authorize inventory adjustments, which reason codes are acceptable, and the evidence that must be kept (count sheets, CCTV; commonly 12–36 months). It should also set reporting windows for discovered losses, a reconciliation cadence (cycle counts, annual full count), timelines for submitting adjustments, owner audit rights, and an independent third-party count to resolve disputes. — [Racklify liability tips](https://racklify.com/encyclopedia/liability-insurance-and-contract-tips-for-managing-lost-inventory-with-3pls/)
- **Who pays.**
  - Shrinkage allowance is often 0.5–1% of inventory value, inside which the 3PL is not liable. A Canadian guide says 1–2% of value handled annually.
  - Above the allowance, the 3PL reimburses at a negotiated value: manufacturing cost, replacement cost, retail value or margin share. It can refund or offset against billing, and a corrective action plan follows repeated overages.
  - Sources: [Racklify shrinkage allowance](https://racklify.com/encyclopedia/what-is-shrinkage-allowance-definition-and-contract-basics/); [lawyerinfo.ca Ontario 3PL agreement](https://lawyerinfo.ca/guides/ontario/business-law-ontario/business-formation-ontario/how-to-draft-a-third-party-logistics-3pl-warehousing-agreement-in-ontario/); [Racklify, how to set a shrinkage allowance](https://racklify.com/encyclopedia/how-to-set-a-shrinkage-allowance-for-fulfillment-contracts/)
- **Liability follows custody and fault.**
  - A loss while the 3PL had exclusive control and did not follow agreed procedures is usually the 3PL's.
  - A discrepancy caused by the owner's packing, labelling or documentation is the owner's.
  - Some contracts split unidentified shrinkage 50/50.
  - Caps are often tied to monthly storage fees, with gross negligence carved out.
  - Insurance covers catastrophic loss, not routine variance.
  - Sources: [Racklify liability tips](https://racklify.com/encyclopedia/liability-insurance-and-contract-tips-for-managing-lost-inventory-with-3pls/); [Fulfill.com 3PL insurance](https://www.fulfill.com/blog-posts/3pl-insurance)
- **Adjustment request form.** A generic template exists (item, quantity, reason, evidence, approvals); it is not 3PL-specific. — [MangoApps inventory adjustment request form](https://www.mangoapps.com/templates/forms/inventory-adjustment-request-form)

### Inferences
- **Practical flow for CKB → Shell.**
  1. The WMS produces a discrepancy line: SKU, batch, expiry, cartons, WMS qty vs SAP qty, suspected cause, reason code, evidence, and the SAP correction it implies (§2 table).
  2. The 3PL's inventory lead approves it.
  3. It goes to Shell, by form or email or by an EDI/IDoc if one is ever built.
  4. Shell approves and posts in SAP under its own tolerance groups and reason codes.
  5. The 3PL verifies the fix by matching the next SAP stock report against the open request, and closes the request only when the SAP quantity matches.
- **Requests should be split by reason code.** That mirrors the 947 guidance: one GL account per posting.
- **Cost bearing should follow the contract's shrinkage clause.** The WMS can support it by totalling approved negative variances by reason against the allowance base.

### Gaps
- I found no published turnaround SLA (for example, "owner posts within N days") in any source.
- I found nothing specific to Shell, oil and gas, or Indonesia on 3PL adjustment governance.
- I found no real 3PL SOP that describes the request–approve–post–verify loop end to end; the loop above is a synthesis.

## 4. When the WMS is wrong: how the 3PL corrects its own system, and whether the client must approve

### Takeaway
The 3PL corrects its own WMS through the same controlled workflow: evidence, reason code, approval, and a correcting entry that never edits history. Whether the client must also approve WMS adjustments depends on the contract. Guidance recommends the contract state who can authorize adjustments. A common approach is that pure location or data corrections inside the WMS (wrong bin, wrong batch/expiry label, mis-scan) are internal, while anything that changes the owner's quantity or value needs owner approval.

### Cited Findings
- **Who authorizes.** Contracts should define who may authorize inventory adjustments and which reason codes are acceptable. — [Racklify liability tips](https://racklify.com/encyclopedia/liability-insurance-and-contract-tips-for-managing-lost-inventory-with-3pls/)
- **Separate transaction types.** A WMS should distinguish count correction, reclassification, write-off, RTV and inbound recount. Adjustments post with an approver ID and an immutable before/after log. — [Racklify adjustment workflow](https://racklify.com/encyclopedia/how-to-process-inventory-adjustments-in-warehouse-operations-workflow-documentation-and-wms-settings/)
- **Mismatches the 3PL itself caused.** Many WMS–SAP mismatches come from WMS transactions that never triggered an SAP posting. Those are fixed by completing the missing posting, not by adjusting stock. — [JK Tech](https://jktech.com/success-stories/enabling-business-transformation-by-eliminating-stock-mismatch-reconciliation-increasing-stock-accuracy-and-reducing-financial-risk/)
- **Unexplained positive adjustments are suspect.** — [Orderful 947](https://docs.orderful.com/docs/947-inventory-adjustment-advice)

### Inferences
- **Classify each discrepancy before acting.**
  - **(a) Timing / cutoff.** A pick posted in the WMS but not yet GI'd in SAP, or a putaway the morning after; this project already books putaway on arrival date. No adjustment: wait or chase the SAP posting.
  - **(b) WMS-internal location or identity error.** Fix with a WMS movement (bin-to-bin, batch/expiry relabel as a pair of movements). No SAP change unless SAP tracks batches.
  - **(c) Real quantity loss or gain.** WMS adjustment and an SAP request to Shell.
  - **(d) SAP posting error.** A wrong 601 qty, a 101 on the wrong material: request a reversal or correction from Shell. No WMS change.
- **Recount before adjusting.** For (b) and (c), a recount by a second person, the MI04 → MI11 analogue, should come before any adjustment.

### Gaps
- I found no source stating as an industry norm that clients must approve 3PL-internal WMS corrections. It is contract-dependent, and this split is an inference.

## 5. Damaged and quarantine stock between WMS and SAP

### Takeaway
Damaged or uncertain stock is quarantined physically and in the WMS first. In SAP it moves to blocked stock (standard 344, or the client's equivalent; a stock-type change with no value change). After the owner approves disposal, it is scrapped from blocked stock with 555 (or the client's custom write-off type, such as Z55), or released back with 343.

### Cited Findings
- **Quarantine first.** Quarantine affected stock if its status is uncertain, decide disposition (reclassify, rework, RTV, scrap), require photos or QA reports for write-offs, and have QA or vendor teams open claims when damage rates exceed thresholds. — [Racklify adjustment workflow](https://racklify.com/encyclopedia/how-to-process-inventory-adjustments-in-warehouse-operations-workflow-documentation-and-wms-settings/)
- **SAP movement types for each step.**
  - Block: 344, or 343 to release (direction to verify per system). — [SAP Answers](https://answers.sap.com/questions/7558827/convert-stock-from-unrestricted-use-to-blocked-sto.html)
  - Scrap from blocked: 555. — [mohanranga](https://mohanranga.squarespace.com/blogs/movement-types)
  - Move from blocked to quality inspection: 349. — [SAP archive 1055066](https://archive.sap.com/discussions/thread/1055066)
  - Stock-type changes have no accounting impact; scrapping does. — [SAP archive 903720](https://archive.sap.com/discussions/thread/903720)
- **Counting blocked or QI stock.** Differences in blocked or quality-inspection stock are posted with 707/708 or 703/704, not 701/702. — [Guru99](https://www.guru99.com/all-about-physical-inventory.html)
- **Example 3PL damaged-inventory policy.** — [LVK damaged inventory policy](https://fulfillment-help.lvk.com/hc/en-us/articles/4420027670157-Damaged-Inventory-LVK-Policies-and-Warehouse-Handling) (not fetched; listed in search only)

### Inferences
- **WMS flow.**
  1. Move to the WMS `Quarantine` location, which is never picked from (already a rule here), with reason DAMAGE or EXPIRED.
  2. Notify Shell so SAP blocks the same quantity, keeping SAP's unrestricted stock equal to the WMS pickable stock.
  3. When Shell approves disposal, the WMS posts the write-off movement and Shell posts 555 or Z55.
  4. If the stock is released, both sides reverse: Quarantine back to a bin, and 343 in SAP.
- **Expired lubricant is also disposal-governed.** Its disposal may need hazardous-waste paperwork. That was not researched here and is a gap.

### Gaps
- I did not fetch the LVK policy.
- I found no source on Indonesian hazardous-waste (B3) disposal documentation for used or expired lubricants.
- Z55's real source stock type (unrestricted vs blocked) is unknown; ask Shell.
