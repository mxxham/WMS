# What named global 3PLs do when WMS, client book and physical stock disagree

Scope note: about 20 search and fetch calls. The public record on this topic is thin and lopsided. Plenty of **technology / counting** case studies exist, but almost all are written by vendors. The **step-by-step discrepancy workflow** (who decides, client sign-off, liability settlement) appears only in fragments, mainly in job postings. No named 3PL publishes its client write-off or shrink-settlement procedure. Every claim below says whose claim it is.

## 1. The routine after a difference is found: who does what, how fast, how the client is told

### Takeaway
Job postings from DHL Supply Chain and Kuehne+Nagel describe a dedicated inventory-control role. It researches variances, finds root causes, "dispositions" each discrepancy, and reconciles the operator's WMS against the **customer's host system / system of record**, often keying entries into the customer's system itself. The client's system is treated as a separate book that must be reconciled; it is not overwritten. No company publishes who approves an adjustment or how fast.

### Cited Findings
- **DHL Supply Chain** "Inventory Control Analyst / Coordinator" postings (US/EU) list these duties: researching, analysing and resolving inventory variances, root causes and discrepancies; keeping records accurate in the WMS/ERP; **"identifying and resolving variance between WM and customer host system"**; "reconciliation and data entry into customer's system of record and the WM System"; root-cause analysis of transactions in Excel; keying in-transit buckets in SAP for finance reporting; and supporting customer audits and internal audits. These are search-result summaries of postings; the full DHL page returned HTTP 410 when fetched. — [DHL careers: Inventory Control Analyst](https://careers.dhl.com/amer/en/job/DPDHGLOBAL10488863ENAMEREXTERNALTALENTREEF/Inventory-Control-Analyst); [DHL careers: Inventory Control Coordinator](https://careers.dhl.com/eu/pl/job/DPDHGLOBAL10524610PLEUEXTERNALTALENTREEF/Inventory-Control-Coordinator)
- **DHL Supply Chain** "Inventory Control Manager I" posting: design reporting that tracks **inventory accuracy, shrink compliance and variance root-cause trends**. This implies shrink is measured against a contractual allowance ("compliance") and that root causes are trended, not only fixed one by one. — [DHL careers: Inventory Control Manager I](https://careers.dhl.com/eu/pl/job/DPDHGLOBAL10538793PLEUEXTERNALTALENTREEF/Inventory-Control-Manager-I)
- **Kuehne+Nagel** "Contract Logistics Inventory Specialist": the stated core objective is **"100% accuracy in stock reconciliation for each customer account"**, with investigation of discrepancies and reduction of stock damage. Stock counts follow "customer requirements and internal guidelines". — [K+N careers: Contract Logistics Inventory Specialist](https://careers.kuehne-nagel.com/job/Contract-Logistics-Inventory-Specialist/8251-en_US); [variant](https://careers.kuehne-nagel.com/job/Contract-Logistics-Inventory-Specialist/16755-en_US/)
- **Kuehne+Nagel** Des Plaines, IL "Inventory Control Analyst/Coordinator": help find root causes **so discrepancies can be properly dispositioned**; reconcile serial-number changes, adjustments, batch issues, blocked stock and PO/MRA reversals; coordinate with Finance, Logistics and Customer Service. Pay is $22–25/h, so this is a clerk-level desk, not management. — [K+N careers: Inventory Control Analyst Des Plaines](https://careers.kuehne-nagel.com/job/Des-Plaines-Inventory-Control-Analyst-Des-Plaines,-IL-IL-60018/6421-en_US); [K+N Inventory Control Coordinator](https://careers.kuehne-nagel.com/job/Inventory-Control-Coordinator/12453-en_US/); [CareerBuilder mirror](https://www.careerbuilder.com/job-details/inventory-control-coordinator-des-plaines-il--dec30302-13f7-4d97-ab0f-e370a278ee8b). The K+N pages were expired when fetched; the duties come from search snippets.
- **DSV** (Melbourne) inventory controller listing includes "handling stock discrepancies, adjustments". Another Melbourne listing (employer not confirmed) describes "reconciling stock variances and actioning disputes daily". — [Indeed AU stock controller listings](https://au.indeed.com/q-stock-controller-l-melbourne-vic-jobs.html)

### Inferences
- Across DHL and K+N, the pattern is: (1) a variance is detected by a count or by the host-vs-WMS compare; (2) the inventory-control desk researches the transaction history; (3) the desk assigns a root cause and a **disposition**; (4) both the WMS and the customer's system are brought into line, by the 3PL keying into the customer system where the contract allows it, otherwise by the customer; (5) trends are reported against accuracy and shrink KPIs. CKB's situation (it cannot post in SAP) matches the case where step 4 belongs to the client. DHL's "customer host system" wording supports CKB keeping its WMS as the physical truth and producing a reconciliation for Shell to post.
- "Batch issues", "blocked stock" and "PO/MRA reversals" appear as named reconciliation categories at K+N. CKB could adopt them as reason codes (batch mismatch, blocked/quarantine status mismatch, reversed document).

### Gaps
- No published SOP from any named 3PL gives the approval chain (for example, who signs a write-off above X units), turnaround times (for example, variance resolved within 24/48 h), or the format of the client variance report. Full DHL and K+N postings had expired (HTTP 410 / "not available").
- Nothing found for **CEVA, DB Schenker, Maersk Contract Logistics, Nippon Express, Yusen, Linfox or Toll** describing their discrepancy routine; searches for Toll, Linfox and CEVA job postings returned only generic listings.
- No published client testimonials about how a 3PL handled a variance dispute.

## 2. Named examples of investigation and resolution, with reported outcomes

### Takeaway
The only named, quantified cases are technology-led cycle-count programmes. Their outcomes are reported as **time saved and locations scanned**, rarely as accuracy, and almost never as money recovered or variance closed. No named RCA/8D/CAPA programme or "found/lost" reconciliation case study by a major 3PL turned up.

### Cited Findings
- **GEODIS** (vendor story, Gather AI): before drones, four manual counters scanned up to 800 locations a day with overtime. Barcodes, lot codes, expiry dates and box counts were checked by hand, and unreconciled licence plates (pallets) were found only by manual search, which could take **1–2 days**. After drones, one operator scans 1,200 locations a day, the software reconciles against the WMS and flags discrepancies "in real time", and operators are sent to the last known location, so searches take **minutes**. Overtime was eliminated, count time fell 50%, and productivity rose 5x. Quotes: Andy Johnston, GEODIS Sr Director of Innovation, "The Gather AI user interface allowed our staff to see inventory variances clearly"; David Ruiz de Arbulo, GEODIS Inventory Specialist. **Marketing claim.** The page's meta description claims a 75% cut (4,400 → 800 hours a year), which contradicts the 50% in the body and matches the NFI figure below, so it is probably a copy error. — [Gather AI: GEODIS](https://gather.ai/customer-stories/geodis)
- Another Gather AI page attributes to GEODIS "improvements in inventory accuracy upwards of 70%". This is not interpretable without a baseline. **Marketing claim.** — [Gather AI case studies](https://gather.ai/case-studies)
- **NFI**: counting time cut 75%, from **4,400 to 800 hours a year**, across 51,000 locations. **Vendor-published.** — [casestudies.com: NFI / Gather AI](https://www.casestudies.com/company/gather-ai/case-study/476c-how-nfi-cut-manual-hours-at-scale-with-gather-ais-autonomous-drones)
- Smaller 3PLs (vendor-published): **Langham Logistics** went from ~97% to >99% accuracy after adopting Gather AI in 2022; **Taylor Logistics** reports 99% accuracy, an 87% reduction in cycle counting and an 8-month ROI. — [Gather AI case studies](https://gather.ai/case-studies); [Gather AI: Taylor Logistics](https://gather.ai/customer-stories/taylor-logistics)
- **GXO** (vendor page, Vimaan StorTRACK): an unnamed GXO testimonial says "Our clients impose some serious SLAs on us and we have been able to support them while keeping our costs low with StorTRACK." The case study is titled "GXO achieves 5x speed gains"; no accuracy number is given. In the vendor's workflow, discrepancies appear with photo evidence for reconciliation, and unresolved locations are flagged for manual follow-up. **Marketing claim.** — [Vimaan StorTRACK](https://vimaan.ai/inventory-tracking-products/stortrack-automated-cycle-counting/)

### Inferences
- Where the cases do describe a workflow, it is the same everywhere: an automated scan is compared with the WMS, an exception list is produced, a person is sent to the exact location, and the record is corrected. **Photo evidence** attached to each discrepancy (Vimaan, Gather AI) is what makes the result defensible to the client. CKB's equivalent is a scan-and-photo record per recount, so Shell can accept the WMS figure without sending its own counter.
- These programmes are justified to clients mainly through **SLA compliance and labour cost**, not shrink recovery (GXO quote).

### Gaps
- No named case of a 3PL running a formal RCA/8D/CAPA programme on stock variances, with before/after numbers.
- No published "variance meeting" or "daily stock control desk" description from a named company beyond job duties.
- No case gives a client sign-off step.

## 3. Technology deployed after accuracy problems, with measured results

### Takeaway
Drones are the technology that named 3PLs announce publicly: DHL Supply Chain (Malaysia, Infinium), DSV (Verity, 75 drones), Maersk (Verity, Miami), GEODIS and NFI (Gather AI), GXO (Vimaan robot). Each reports faster counts and a WMS-vs-physical exception report, but accuracy numbers are self-reported or absent.

### Cited Findings
- **DHL Supply Chain Malaysia** (Infinium Scan drones): cycle-count time cut **92% (84 h → 6 h)** at one operation; a 56% productivity gain at another; "100% inventory count accuracy"; **2,000 locations in 8 hours**. The drones generate discrepancy reports by comparing drone data with the WMS. The source is a LinkedIn post by DHL SC Malaysia MD Mario Lorenz, relayed by the vendor's CEO and reported in July 2026. DHL selected Infinium in 2023 after a demo at its Shah Alam Integrated Logistics Centre. **Self-reported via vendor**; "100%" most likely means the locations counted, not the site's book. — [Business Today Malaysia, 16 Jul 2026](https://www.businesstoday.com.my/2026/07/16/ai-drone-cuts-92-cycle-count-time-for-dhl-in-malaysia/) (snippet only; the page returned 403 when fetched)
- **DSV** (Verity drones): in a 2020 pilot at **Moerdijk (NL)**, "manual counts can be avoided to a large extent and inventory data becomes virtually error-free", which led to a wider rollout. DSV now reports **75 drones worldwide, >500,000 flight hours, >5 million locations checked, 100–300 locations/hour**, flights at night and at weekends, and integration with DSV's multi-client WMS **CargoWrite**. Nightly "moved location" scans find and correct discrepancies right away; full-facility scans catch the rest; automated checks make theft more visible. No accuracy % is given. **Company claim.** — [DSV press release 2020](https://dsv.com/about-dsv/press/news/com/2020/11/dsv-improves-warehouse-operations-with-drone-system); [DSV automated drones page](https://www.dsv.com/en/our-solutions/logistics-solutions/contract-logistics/warehousing/warehouse-automation/automated-drones); [Logistics Manager](https://logistics-manager.com/dsv-improves-warehouse-operations-with-drone-system/)
- **Maersk** (Verity; Maersk made a strategic investment): proof of concept from **15 Nov 2021** at a fulfilled-by-merchant facility in **Miami** for an e-commerce brand, with an API to the WMS and the e-commerce platform. Reported results: **90% fewer staff manually scanning/searching, 50% less management time correcting errors**, and "significant financial savings" (no figure). The system "quickly highlights differences between the WMS data and physical stock". — [Maersk Innovation: Verity](https://innovation.maersk.com/innovations/verity-autonomous-drones)
- **RFID drones** (Verity pilot, forwarder not named): 80 million RFID tags read across 1.25 million items in a 3-month pilot, at a claimed 99.9% read accuracy. **Vendor claim.** — [Cisper case study](https://www.cisper.com/en/case-studies/rfid-case-study-rfid-enabled-drones-transform-warehouse-inventory-tracking)
- **Kuehne+Nagel** (Costo Intralogistics): RFID in a K+N warehouse's zone-picking system brought **order** accuracy to 100%, replacing a manual check. That is pick accuracy, not stock accuracy. **Vendor claim.** — [Costo: Case Kuehne+Nagel](https://www.costo-intralogistics.com/en/case-en/case-kuehne-nagel/)

### Inferences
- The pattern in the named deployments: a **nightly scan of moved locations** plus **periodic full scans** (DSV), with exceptions pushed to a person. This is a cheaper rule CKB could copy without drones: recount every bin touched that day, with the WMS's movement list as the trigger.
- Drone programmes report labour and time, not variance value. A 2,970-bin carton warehouse like CKB's is at the small end of where these were deployed (DHL Malaysia: 2,000 locations in 8 h).

### Gaps
- Nothing found for drones, RFID or vision at **Nippon Express, Yusen, Linfox, Toll, CEVA or DB Schenker** (one Loadstar result titled with Schenker was actually about DSV/Maersk).
- No control-tower or automated host-vs-WMS reconciliation tool from a named 3PL with measured results.
- No independent (non-vendor, non-company) audit of any accuracy figure above.

## 4. Loss liability with the client in practice

### Takeaway
No named global 3PL publishes its shrink-allowance mechanics, write-off approval flow or claim-settlement figures. The only company-level signal is DHL's "shrink compliance" KPI. Everything else on the topic is generic (0.5–1% allowance, already covered by the earlier report).

### Cited Findings
- **DHL Supply Chain** Inventory Control Manager I is to report "**shrink compliance**". This implies contracts with a shrink threshold that DHL tracks site by site. — [DHL careers: Inventory Control Manager I](https://careers.dhl.com/eu/pl/job/DPDHGLOBAL10538793PLEUEXTERNALTALENTREEF/Inventory-Control-Manager-I)
- Generic sources (not company-specific) say allowances are measured on different bases (average, month-end or annual inventory) and that liability above the allowance usually requires a contract clause or proven negligence. — [Wheetrade: who pays for lost inventory](https://wheetrade.com/articles/who-pays-for-lost-inventory/); [Racklify](https://racklify.com/news/what-happens-if-3pl-loses-your/)

### Inferences
- In practice, liability is set by the contract, and the 3PL's operational job is to report a shrink figure against it. The **choice of base** (monthly vs annual, value vs units) is the item CKB should pin down with Shell, because it changes whether a month's loss counts against the allowance.

### Gaps
- No named-company example of a client approving a write-off, a liability settlement amount, or a dispute outcome. These are contractually confidential and do not appear in annual reports, sustainability reports or trade press found here.
- No found evidence from Indonesian 3PLs or Shell-lubricant-specific logistics.
