# 3PL vs stock-owner responsibilities, contractual KPIs, shrinkage allowances and inventory record accuracy benchmarks

Context: Shell lubricant warehouse (cartons, drums/pails), Surabaya, run by a 3PL (PT CKB); FEFO; daily SAP MB52 vs WMS per-SKU comparison.
Research date: 4 Nov 2026. Most contract figures come from vendor and practitioner sources, not legal texts or audited surveys. Treat them as market conventions, not standards.

## 1. Typical contract clauses: accuracy SLA, shrinkage allowance, liability caps, who pays, counting regime, joint counts and sign-off

### Takeaway
3PL contracts usually combine three things. (1) An inventory accuracy SLA, commonly 99.5% or higher. (2) A shrinkage allowance, commonly 0.5-1% of inventory value; the client absorbs losses up to it and the 3PL reimburses beyond it, usually at replacement cost rather than selling price. (3) A per-unit or per-weight liability cap under warehouse-receipt law, which does not apply when the warehouse converts goods to its own use. Cycle counts plus joint audits are the usual dispute mechanism. Published sources rarely specify sign-off procedures.

### Cited Findings
**Shrinkage allowance level**
- Vendor blog (2026): the "typical allowance" is 0.5-1% of inventory and is the most common target. Its tiers: 0.1-0.5% for premium providers, 0.5-1% for standard 3PLs, 1-3% for basic operations, above 3% high-risk. It also says "most 3PLs assume liability for losses above about 0.5%". — [Red Stag Fulfillment, "What is the average shrinkage rate for a 3PL? 2026 data"](https://redstagfulfillment.com/what-is-average-shrinkage-rate-for-3pl/)
- Same source, sample clause: the client absorbs shrinkage up to 0.5% of monthly average inventory value and the provider covers the excess, "subject to proper procedures". Sustained accuracy below 99% is treated as a material breach in the sample language. — [Red Stag Fulfillment](https://redstagfulfillment.com/what-is-average-shrinkage-rate-for-3pl/)
- Same source, surveys it cites: average 3PL shrinkage was 1.44% (Warehousing & Fulfillment 2024 survey, 150 US 3PLs) and the median was 0.65% (2025 survey, 500 e-commerce brands). It treats shrinkage above 2% as a sign of weak controls. These are secondary citations of survey data I could not verify. — [Red Stag Fulfillment](https://redstagfulfillment.com/what-is-average-shrinkage-rate-for-3pl/)
- One 3PL's published policy sets an allowance of up to 1% of total on-hand inventory at any time, measured on a rolling basis through cycle counts and physical inventories. — [Founders 3PL shrinkage policy](https://founders3pl-com.pages.dev/pricing/shrinkage-policy)
- A Canadian (Ontario) drafting guide calls 1-2% "of the total inventory value handled annually" industry standard. That basis is throughput, not on-hand. — [LawyerInfo.ca, drafting a 3PL warehousing agreement in Ontario](https://lawyerinfo.ca/guides/ontario/business-law-ontario/business-formation-ontario/how-to-draft-a-third-party-logistics-3pl-warehousing-agreement-in-ontario/)
- Another blog cites a much wider 2-10% range. That is an outlier and probably refers to retail or e-commerce shrink, not warehouse custody. — search-result summary of the [ShipHero 3PL contract template article](https://www.shiphero.com/blog/3pl-contract-template) (not opened directly; low confidence)
- Bases used: a percentage of inventory value, a per-line-item (per-SKU) tolerance, or a fixed unit count. Contracts should name the period (monthly, annual or rolling). — [Racklify, "What Is Shrinkage Allowance?"](https://racklify.com/encyclopedia/query/shrinkage-allowance/); [Racklify, "How To Set A Shrinkage Allowance For Fulfillment Contracts"](https://racklify.com/encyclopedia/how-to-set-a-shrinkage-allowance-for-fulfillment-contracts/)

**How to set the allowance (Racklify guide)**
- Base it on at least 12 months of cycle-count and adjustment data, segmented by SKU, location, operation and root cause. Review quarterly in year 1, then annually; reopen when SKU mix, volume or handling changes.
- Tier it: moderate allowance for standard SKUs, wider for bulk or commodity, minimal or zero for high-value items. The guide's worked example is 0.5% overall, 0.1% for the high-value tier, against 0.6% historical shrink.
- Measure against a WMS snapshot or a physical count cut-off time; monthly measurement tied to billing for high-volume operations.
- Audit rights for the merchant, with third-party verification when thresholds are exceeded. Specify notice, sampling method, and who pays for the audit depending on its outcome.
- Exclusions: acts of God, returned goods, and carrier damage beyond the warehouse's control.
- Claims need time limits, required documentation and escalation steps. Remedies include reimbursement, invoice credits, a corrective action plan with deadlines, and termination rights after repeated overages.
- Source: [Racklify, "How To Set A Shrinkage Allowance For Fulfillment Contracts"](https://racklify.com/encyclopedia/how-to-set-a-shrinkage-allowance-for-fulfillment-contracts/)
- Scope: most 3PLs only account for shrinkage that happens inside their warehouses. — search-result summary of Racklify / ShipHero material (see [Racklify, "Shrinkage Allowance Versus Inventory Shrinkage"](https://racklify.com/encyclopedia/shrinkage-allowance-versus-inventory-shrinkage-liability-accounting-and-operational-differences/))

**Reimbursement basis**
- Three models: replacement (wholesale) cost; full retail value, which is less common; or a split of the gross-margin loss. — [Red Stag Fulfillment](https://redstagfulfillment.com/what-is-average-shrinkage-rate-for-3pl/)

**Liability caps (warehouse-receipt law, US UCC Article 7)**
- A warehouse may limit liability through a term in the receipt or storage agreement "setting forth a specific liability per article or item, or value per unit of weight". The bailor may request a higher limit when signing or within a reasonable time after receiving the receipt. The limitation is not effective for the warehouse's "conversion to its own use". — [Iowa Code 554.7204](https://www.legis.iowa.gov/docs/code/554.7204.pdf); [Wisconsin 407.207 (1997)](https://docs.legis.wisconsin.gov/document/statutes/1997/407.207)
- IWLA standard contract: an insurance-industry commentary says the liability section (Section 11, in capitals) limits the warehouse to losses caused by its own negligence, and that "often the limitation of damages is not filled in", which leaves the warehouse open to greater liability than expected. Pre-2003 versions required a per-article or per-weight limit. — [IOA (Jeff McConnell)](https://www.ioausa.com/?p=701); [Avalon Risk, "Claims corner: warehouse contracts"](https://www.avalonrisk.com/news/claims-corner-warehouse-contracts)
- Example caps in circulation: "$0.50 per pound per package" (a drafting suggestion) and "60 cents per pound per article" (sample clauses), each with a declared-value option to buy higher cover. — [Racklify, warehouse T&C drafting checklist](https://racklify.com/encyclopedia/how-to-draft-warehouse-terms-and-conditions-for-merchants-and-3pls-checklist-and-common-clauses/); [Law Insider, declared value clause](https://www.lawinsider.com/clause/declared-value/_2)
- IWLA published updated "2026 IWLA Standard Contract Terms and Conditions for Merchandise Warehouses". The current wording was not retrievable. — [IWLA course listing](https://www.pathlms.com/iwla/courses/206382)
- California Supreme Court case: the warehouse bears the burden of proving the customer knew the terms of a special liability-limiting contract. — [Justia, Cal. 2d 46 318](https://law.justia.com/cases/california/supreme-court/2d/46/318.html) (old case; flag)

**Counting regime and dispute mechanism**
- Common pattern: quarterly cycle counts with annual reconciliation, plus an annual physical inventory. Suggested frequency: monthly for high-value items, quarterly for medium, annually for low; weekly for fast movers. Disputes are resolved through joint audits. — [Red Stag Fulfillment](https://redstagfulfillment.com/what-is-average-shrinkage-rate-for-3pl/)
- Plants that sustain inventory record accuracy above 95% within counting tolerance can often drop the annual wall-to-wall "freeze" with their auditors' agreement. This is a vendor claim. — [LightSource glossary, cycle counting](https://lightsource.ai/glossary/cycle-counting)

### Inferences
- For the Shell/CKB context, the clause most likely to matter is the period and basis of the allowance: percentage of average on-hand value per month, versus percentage of annual throughput. Throughput-based allowances are much larger in absolute terms for a fast-turning lubricant warehouse.
- A daily per-SKU MB52 vs WMS comparison is a book-to-book reconciliation, not a physical count. It detects posting or timing differences, not shrinkage. A contract would normally measure shrinkage only from counts (cycle or joint stocktake) signed by both parties.
- Unexplained loss is normally the 3PL's account above the allowance and the owner's below it. Inbound shortages, concealed damage and carrier damage are normally excluded or handled as separate claims, so the WMS should keep their reason codes apart from count variances.

### Gaps
- No primary Shell (or other oil major) 3PL warehouse contract or SLA was publicly available. Actual CKB-Shell terms must come from the contract itself.
- Current IWLA (2026) and FIATA model-warehousing-rules wording and cap amounts were not retrieved. FIATA was not searched within the tool budget.
- No public source specifies joint stocktake sign-off procedures (who signs, variance acceptance forms). Practitioner material only says "joint audits".
- Indonesian civil-code (KUHPerdata) treatment of warehousing bailment liability was not researched.

## 2. How inventory record accuracy (IRA) is measured

### Takeaway
There is no single standard. Location-level accuracy (a match of SKU + quantity + location, each error weighted equally) is the strictest measure and the preferred operational one. Quantity- or value-based measures (absolute or net variance divided by counted value) suit finance but inflate the result. The older APICS approach uses ABC-tiered SKU tolerances (A ±1%, B ±3%, C ±5%). Experts recommend tracking several measures, and using one method consistently across sites.

### Cited Findings
- CSCMP glossary: inventory accuracy is "when the on-hand quantity is equivalent to the perpetual balance (plus or minus the designated count tolerances)", often expressed as the percentage variance between book and actual count. — quoted in [SCDigest, "Measuring Inventory Accuracy – No Clear Answer, Experts Say", 3 Nov 2009](https://www.scdigest.com/assets/newsviews/09-11-03-1.pdf) (over 10 years old)
- Older APICS-derived method: stratify SKUs by annual usage × standard cost (A = top 80% of value, B = next 15%, C = bottom 5%). Cycle-count A 4×/year, B 2×/year, C 1×/year. An item counts as accurate if within A ±1%, B ±3%, C ±5% of the perpetual quantity. SCDigest calls this "dated thinking", since most companies now count by location. — [SCDigest 2009](https://www.scdigest.com/assets/newsviews/09-11-03-1.pdf)
- Tompkins Associates benchmarking definition: correct cycle counts (match of product, quantity and location), as a percentage of total annual cycle counts, measured by number of storage slots counted. — [SCDigest 2009](https://www.scdigest.com/assets/newsviews/09-11-03-1.pdf)
- Tompkins' other formulas, quoted in the same article:
  - Financial: (counted value − system value) / expected value.
  - Operational: total UOM variation / total expected inventory.
  - SKU level: variation by SKU / expected by SKU.
  - Location: locations with variances / total locations, split by location type (pick, reserve), often with tolerances.
  - Source: [SCDigest 2009](https://www.scdigest.com/assets/newsviews/09-11-03-1.pdf)
- Ken Miesemer (St. Onge, former WERC president) on why value measures look better: "Have a hundred locations each with a hundred cases, and you are off one case at each location, from a financial perspective you have an accuracy of 99%... from an operational perspective at a location level, you would have an inventory accuracy of 0%." He also says "aggregate case count or dollar value-based measures will inflate the numbers". — [SCDigest 2009](https://www.scdigest.com/assets/newsviews/09-11-03-1.pdf)
- For date-coded products (food and similar), "having the date code in the system right as well as the location and quantity" may be part of the accuracy test. — [SCDigest 2009](https://www.scdigest.com/assets/newsviews/09-11-03-1.pdf)
- Common practice: absolute errors (plus and minus) divided by the value of inventory counted over a period. Totes Isotoner audits twice a year on absolute dollar variance / total dollar of sample, and watches absolute and net dollar variance plus unit variance daily from cycle counts. — [SCDigest 2009](https://www.scdigest.com/assets/newsviews/09-11-03-1.pdf)
- Dave Piasecki: "Every accuracy measurement is flawed"; review several, and use a weighted composite only for executive tracking. — [SCDigest 2009](https://www.scdigest.com/assets/newsviews/09-11-03-1.pdf)
- WERC metric definition: "Inventory count accuracy by location" is the accuracy, by location, of the physical inventory compared with the reported inventory. — [Yale/WERC 2025 Top 12 DC metrics infographic](https://www.yale.com/globalassets/coms/yale/north-america/documents/white-papers/snack-drawer/YALE-1520_WERC-DC-Metrics-infographic.pdf)
- Typical modern tolerance practice: Class A zero tolerance (any mismatch triggers a recount), B small, C ±2-5%. Tolerances like "±2% or ±1 unit" exist, for example for weigh-counted items where 2% could be scale error. — [Cleverence cycle counting guide](https://www.cleverence.com/articles/business-blogs/what-is-cycle-counting-4381/); [Oracle Inventory Cycle Count Hit/Miss Analysis help](https://ap1.mclaneco.com/OA_HTML/HelpServlet/US/INV/@r_invarhma)
- Academic measures include the share of SKUs with any discrepancy (binary), absolute deviation and relative deviation. Kang & Gershwin and later papers cite inaccuracy rates of 20-67% of SKUs on the binary measure. — [Cardiff ORCA, IRI paper](https://orca.cardiff.ac.uk/120277/1/DS%20IRI_final.pdf); [Best et al. 2022, IJPDLM](https://orca.cardiff.ac.uk/id/eprint/150865/1/Best%20et%20al%20%282022%20-%20IJPDLM%29.pdf) (from search summaries)

### Inferences
- For this warehouse, the stock identity is bin + SKU + batch + expiry. Under the strict location definition, a bin is accurate only if SKU, batch, expiry and quantity all match. That is stricter than MB52 vs WMS per SKU, which is the "SKU total" view.
- A useful KPI set: (a) location accuracy (% of counted bin records exact), (b) SKU-total accuracy within tolerance (% of SKUs where WMS total = SAP total), (c) absolute carton variance / cartons counted, (d) net variance (shrink) in IDR value. Net variance lets overs and shorts cancel. It is the contractual shrink number; absolute variance is the process-quality number.
- Cartons are discrete, so percentage tolerances on small quantities (A ±1%) round to zero. A unit tolerance (for example 0 cartons for A, ±1 carton for C) is more meaningful.

### Gaps
- The full Cardiff paper "On the measurement of inventory record inaccuracies" returned HTTP 403 ([link](https://orca.cardiff.ac.uk/id/eprint/183464/7/On%20the%20measurement%20of%20inventory%20record%20inaccuracies.pdf)), so its taxonomy of measures could not be extracted.
- No current ASCM/APICS (CPIM) text confirming a "95% IRA" target or the ABC tolerance figures was found. The ±1/3/5% scheme is reported second-hand, via SCDigest 2009.

## 3. Industry benchmarks

### Takeaway
WERC's 2025 DC Measures puts best-in-class inventory count accuracy by location at ≥99.5% (best-in-class = top 20% of respondents). Older WERC figures cited by vendors are ≥99.9% best-in-class with medians around 98.4-99.3%; the cited values conflict. Retail store records are far worse: about 65% of records were wrong in DeHoratius & Raman (2008), and Auburn found about 63% item-level accuracy without RFID versus about 95% with it.

### Cited Findings
**WERC DC Measures**
- 2025 report, best-in-class measures from the Yale infographic. These are useful companion metrics for a 3PL scorecard:

  | Metric | Best-in-class (2025) |
  |---|---|
  | Inventory count accuracy by location | ≥99.5% |
  | Order-picking accuracy | ≥99.68% |
  | On-time shipments | ≥99.5% |
  | On-time ready to ship | ≥99.5% |
  | Dock-to-stock cycle time | <3.5 hours |
  | Supplier orders received damage free | ≥99.07% |
  | Lines picked and shipped per hour | ≥70 |
  | Internal order cycle time | <3.36 h |
  | Total order cycle time | <6 h |
  | Average capacity used | ≥90% |
  | Overtime hours to total hours | <1.88% |

  Source: [Yale/WERC 2025 Top 12 DC metrics infographic](https://www.yale.com/globalassets/coms/yale/north-america/documents/white-papers/snack-drawer/YALE-1520_WERC-DC-Metrics-infographic.pdf)
- WERC "best-in-class" = top 20% of respondents (a quintile scheme: major opportunity, disadvantage, typical/median, advantage, best-in-class). — [RF-SMART, warehouse metrics that matter](https://www.rfsmart.com/blog/warehouse-metrics-that-matter-for-netsuite-customers)
- Older WERC figures (2018 study, cited in a 2020 Honeywell article). **Conflicting and unverified:** two search summaries of the same Honeywell page gave different values, and direct fetches failed (redirect or empty page).
  - Version A: best-in-class ≥99.88%, median 98.40%, with a location-error formula (locations with an error / total locations counted).
  - Version B: best-in-class ≥99.9%, median 99.30%, "typical" band ≥99% and <99.5%.
  - Use only as "approximately 99.9% best-in-class, median roughly 98.4-99.3%", pending the WERC report itself.
  - Source: [Honeywell, "How to improve accuracy in the inventory control workflow" (2020)](https://www.honeywell.com/us/en/news/featured-stories/2020/05/how-to-improve-accuracy-in-the-inventory-control-workflow-with-a-dc-walkthrough)
- The 2024 DC Measures report (ESG focus) and an online benchmarking tool holding data since 2013 exist behind WERC's paywall. — [MHI Solutions, 17 Sep 2024](https://www.mhisolutionsmag.com/index.php/2024/09/17/werc-announces-2024-dc-measures-annual-survey-report-and-interactive-benchmarking-tool/)
- Note: the 2025 best-in-class threshold (≥99.5%) is lower than older vendor-quoted ones (≥99.9%). This may reflect the respondent mix or a changed definition. It is not explained in the sources.

**Academic and retail studies (all over 10 years old)**
- DeHoratius & Raman (2008), *Management Science* 54(4):627-641: of about 370,000 inventory records across 37 stores of one retailer, 65% were inaccurate. Auditing practices reduce errors; store complexity and distribution structure increase them. 26.4% of the variance lies between product categories and 2.7% between stores. — [EconPapers record](https://econpapers.repec.org/RePEc:inm:ormnsc:v:54:y:2008:i:4:p:627-641)
- Raman, DeHoratius & Ton (2001), *California Management Review* 43(3): at one leading retailer (hundreds of stores) 65% of records were inaccurate. The profit lost to record inaccuracy was about 10% of current profit. — [CMR, "Execution: The Missing Link in Retail Operations"](https://cmr.berkeley.edu/2001/05/43-3-execution-the-missing-link-in-retail-operations/)
- Kang & Gershwin (2005), *IIE Transactions*: a small rate of stock loss that the system does not detect accumulates into record inaccuracy, disrupts replenishment and causes severe stockouts. — [Taylor & Francis abstract](https://informahealthcare.com/doi/abs/10.1080/07408170590969861); [MIT thesis record](https://libmast.utm.my/Record/mit-1721.1%2F36193/Details)
- Auburn University RFID Lab / GS1 US "Project Zipper": RFID raised inventory accuracy from an average of 63% to 95% and cut cycle-count time by 96%. The figure is widely restated as "65% to >95%" (Bill Hardgrave, quoted again in RetailWire, June 2025). A 2010 Auburn working paper on JCPenney uses a 65% industry baseline. Auburn's own pages were not readable, so these come from search summaries. — [Auburn ITRI WP151 (Apr 2010)](https://rfid.auburn.edu/files/2021/02/ITRI-WP151-0410.pdf); [DC Velocity, "The quiet case for RFID"](https://www.dcvelocity.com/articles/30136-the-quiet-case-for-rfid); [RetailWire, Jun 2025](https://retailwire.com/discussion/is-rfid-reinventing-retail-selling-floors/)
- Practitioner anecdote: a DC running "only about 95-96% accurate" saw a real impact on line fill rates (Miesemer, prior to Hershey). — [SCDigest 2009](https://www.scdigest.com/assets/newsviews/09-11-03-1.pdf)

### Inferences
- The retail 60-65% figures are store-level SKU records with shoppers, theft and receiving at store level. They are not comparable to a closed B2B lubricant DC. Cite them only to show that record inaccuracy builds up silently without counting (Kang & Gershwin).
- A realistic contract target for location accuracy in a 3PL DC is ≥99.5% (WERC 2025 best-in-class), with 99.0% as a floor or breach line (Red Stag sample language).

### Gaps
- WERC medians for 2024-2025 were not obtainable (paywalled).
- No ECR Retail Loss study figures were retrieved within the tool budget.
- No ASCM/APICS published IRA target was found. The commonly quoted "95%+" is practitioner lore.

## 4. Governance cadence: daily exceptions, weekly review, monthly KPI reporting, root-cause and corrective action, aging of open differences

### Takeaway
Practice is a daily cycle-count and exception stream, regular joint KPI reviews, and periodic (quarterly or annual) reconciliation with audit rights. Count volume scales with accuracy (finance raises it when accuracy drops). Errors are treated as process failures that need root cause and a corrective-action plan with deadlines. No public source specifies aging thresholds for open differences.

### Cited Findings
- A joint KPI dashboard tracking daily inventory accuracy, cycle-count results, damage rates, security incidents and dock-to-stock, followed by regular review meetings. — [Red Stag Fulfillment](https://redstagfulfillment.com/what-is-average-shrinkage-rate-for-3pl/)
- A food-industry DC cycle-counts 0.75-1% of locations daily (about 1,000 of 150,000 pallet positions, with about 10 full-time counters). Finance sets the daily number, which rises and falls with accuracy. — [SCDigest 2009](https://www.scdigest.com/assets/newsviews/09-11-03-1.pdf)
- Miesemer recommends counting by location, an aisle or two at a time. Each error is "the symptom of a process flaw", which forces root-cause identification. — [SCDigest 2009](https://www.scdigest.com/assets/newsviews/09-11-03-1.pdf)
- Allowance review quarterly in year 1, then annually. Repeated overages escalate to a corrective action plan with deadlines, then remedies (credits, termination). — [Racklify](https://racklify.com/encyclopedia/how-to-set-a-shrinkage-allowance-for-fulfillment-contracts/)
- Shrinkage and damage rate = lost or damaged units / total units handled, tracked by area to target training or packaging fixes. — [Cleverence, 3PL KPIs](https://cleverence.com/articles/3pl-business/kpis-every-3pl-business-should-track-and-why-4827)
- Event-triggered counts (on discrepancy, on empty bin, on negative balance) in addition to ABC-scheduled counts. — [Cleverence cycle counting guide](https://www.cleverence.com/articles/business-blogs/what-is-cycle-counting-4381/)
- Indonesian studies of stock-opname differences give the main causes as: goods leaving without being entered in the system, goods arriving unrecorded, and counting errors. Other causes are tolerance limits, postings after cut-off, and quality-control-locked stock. — search summaries of Indonesian theses, e.g. [ULBI ePrint](https://eprints.ulbi.ac.id/334/1/BAB%20I%20ok.pdf) (exact attribution per thesis not verified)

### Inferences
- A cadence that fits a daily MB52 vs WMS comparison:
  - **Daily:** list of SKU differences, each classified as timing (GR/GI not yet posted in SAP or WMS), master-data/UoM, or unexplained. Unexplained differences trigger a bin count the same day.
  - **Weekly:** review of open differences by age bucket (for example 0-2, 3-7, >7 days).
  - **Monthly:** client KPI pack with location accuracy, SKU-total accuracy, net and absolute variance in IDR, shrink against allowance, and a root-cause Pareto with corrective actions.
  - **Annual (or semi-annual):** joint stocktake with signed variance sheet.
- "Timing" and "cut-off" differences should be closed automatically once both systems post. Only differences that persist after cut-off should feed shrink. The Indonesian studies above list cut-off and QC-locked stock as typical non-material causes.

### Gaps
- No public source specifies standard aging limits (for example "close within 48 hours") or a CAPA template for 3PL inventory variances. Those are customer-specific SOPs.
- No published standard for MB52 vs WMS daily reconciliation practice was found.

## 5. Indonesia / Southeast Asia, lubricant and chemical specifics, oil-company requirements

### Takeaway
Little is public. Indonesian academic material confirms stock opname and tolerance-based reconciliation as normal practice. Lubricant guidance stresses damaged containers, moisture and contamination. Shell's Indonesian distributor and 3PL warehouse standards (HSSE, FEFO, audit) are not published; only job adverts hint at them.

### Cited Findings
- Shell Indonesia sells lubricants directly and through appointed distributors. Almost 70% of its Indonesian lubricants are produced locally, with stock points at major ports. — [The Corporate Treasurer, Q&A PT Shell Indonesia](https://thecorporatetreasurer.com/article/qa-pt-shell-indonesia/343067); [Hydrocarbon Processing, Nov 2016](https://www.hydrocarbonprocessing.com/news/2016/11/shell-indonesia-producing-marine-lubricants-increasing-production/) (2016; flag)
- Shell warehouse supervisor job descriptions list HSSE KPIs and implementing HSSE standards in local warehouses as duties. These are job ads, not audit criteria. — [Youthall, Shell Warehouse Supervisor](https://www.youthall.com/en/Shell/warehouse-supervisor_392)
- A non-Shell lubricant company job advert asks for FIFO/FEFO controls and audit-ready traceability. — [MyJobMag, Matrix Energy Group](https://www.myjobmag.com/jobs/latest-jobs-at-matrix-energy-group-13)
- Sefas Group is described as an official Shell lubricants distributor in Indonesia. — [Sefas Group](https://sefasgroup.com/companies)
- Mobil's handling guidance names damaged containers, moisture condensation and dirty dispensing equipment as common causes of contamination and waste in storage. The 55-gallon (208 L) drum is the most common industrial lubricant container. — [Mobil, "Handling and storing lubricants" tech topic](https://www.global.mobil.com/-/media/files/global/us/industrial/tech-topics/tt-handling-and-storing-lubricants.pdf)
- Store drums horizontally so the bungs stay wetted, which limits moisture ingress through "breathing". — search summary of lubricant-supplier guidance ([Machinery Lubrication / Noria](https://www.e-digitaleditions.com/i/1449093/45); [RELIA, lubricant storage best practices](https://reliamag.com/topics/cartoons/lubricant-storage-best-practices))
- Liquid-product 3PL KPIs: damaged-unit percentage, returns due to leaks, and the time to locate and quarantine suspect stock. — [Racklify, leak-proof packaging](https://racklify.com/encyclopedia/when-should-warehouses-use-leak-proof-packaging/)
- A case study: a global lubricants manufacturer lacked standard warehouse processes and KPIs and built a KPI tree and warehouse scorecard shared with its 3PL. — [Evolve Partners case study (2018)](https://evolvepartners.squarespace.com/case-studies/2018/9/24/unlocking-warehouse-operations-productivity)
- Warehouse-based 3PL in Indonesia is described as providing storage and managing stock and goods movements. — [Mekari Jurnal](https://www.jurnal.id/id/blog/apa-itu-integrated-3pl-third-party-logistics-dalam-pengiriman/); [Astra Selog](https://www.selog.astra.co.id/en/blog/news/3-pl-in-logistics-industry)

### Inferences
- For lubricants, "damaged / leaking" stock should be its own disposition: moved to quarantine with a reason code, not netted into count variance. Who bears it depends on cause: inbound or concealed damage goes to the supplier or carrier, handling damage to the 3PL. A typical contract excludes carrier damage from the shrink allowance (Racklify).
- Batch and expiry are part of stock identity here (FEFO). A count that finds the right quantity under the wrong batch or expiry is a record error. SCDigest notes date-coded industries include the date code in the accuracy test.

### Gaps
- No public Shell Lubricants 3PL warehouse standard, distributor operations manual, or HSSE warehouse checklist was found.
- No Indonesian logistics association (ALI) guidance on 3PL inventory SLAs or shrink allowances was found.
- One Diponegoro University thesis reportedly describes a stock difference exceeding a "batas toleransi 1%" (tolerance limit of 1%) in Sept 2025. The exact thesis URL among several undip.ac.id results was not verified, so it is not cited as fact.
- Indonesian regulation on storing lubricants was not researched within the tool budget. Lubricants are generally not classed as hazardous goods (B3), but used oil is.
