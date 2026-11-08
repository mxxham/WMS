# Corrective and preventive actions after recurring stock differences, and measured results

Scope note: this covers fixes and their measured outcomes. Most before/after numbers in the public domain are vendor case studies (self-reported, no audit, baseline often undefined). Peer-reviewed work mostly measures the *size and drivers* of inaccuracy, not controlled before/after effects of a fix. Each finding is tagged [ACADEMIC], [VENDOR], [TRADE PRESS] or [STUDENT/LOCAL JOURNAL].

## Process fixes (scan-to-confirm, labels, pick-to-light, verification, counting, root cause)

### Takeaway
The best-documented process lever is moving from manual/paper transactions to scan-confirmed transactions (vendor cases report going from ~85% to 98-99.8% accuracy), and the Indonesian DMAIC cases consistently find that the top root cause is wrong data entry of goods in/out plus wrong putaway location - not theft. Counting more is associated with higher measured accuracy, but no study isolates counting with vs. without root-cause fixing.

### Cited Findings
- Baseline size of the problem: of ~370,000 inventory records (369,567) across 37 stores of one retailer, 65% were inaccurate; inventory auditing practices reduced inaccuracy, while environment complexity and distribution structure increased it; 26.4% of the variance lay between product categories vs. only 2.7% between stores (DeHoratius & Raman, Management Science 54(4):627-641, 2008) [ACADEMIC] — [EconPapers record](https://econpapers.repec.org/RePEc:inm:ormnsc:v:54:y:2008:i:4:p:627-641); [abstract summary](https://academicnewsletter.sufe.edu.cn/info/394446)
- Implication of that variance split: inaccuracy is driven more by *what the product is / how it flows* than by which site — suggests targeting fixes per SKU group (e.g., look-alike or high-velocity SKUs) rather than per site — inference drawn from the same paper's variance decomposition (see Inferences).
- Misplacement, not miscount, dominates in some audits: in an audit of 50 products in ten stores of a specialty retailer, 24% of stockouts were due to record inaccuracy and 60% due to misplaced products (physically present, wrong location); at Borders, lost sales from misplaced products reduced profits by 25% (Raman, DeHoratius & Ton 2001, cited in DeHoratius & Raman book chapter) [ACADEMIC, secondhand] — [Springer chapter](https://springerlink.bibliotecabuap.elogim.com/chapter/10.1007/978-1-4899-7562-1_4); [CMR 2001 "Execution: The Missing Link in Retail Operations"](https://cmr.berkeley.edu/2001/05/43-3-execution-the-missing-link-in-retail-operations/)
- Small undetected losses compound: Kang & Gershwin (MIT, 2005) show analytically and by simulation that "even a small level of stock loss accumulated over time can lead to inventory inaccuracy that disrupts the replenishment process and creates severe out-of-stocks"; they also find the problem "can be effectively treated even without automatic identification technology in some situations" (i.e., process compensation methods, not only RFID) [ACADEMIC] — [MIT DSpace](https://dspace.mit.edu/handle/1721.1/36193)
- Scan-confirmed transactions: Fisk Industries went from 85% (earlier WMS with manual updates) to 98% inventory accuracy after RF scanning (RF-SMART) [VENDOR] — [casestudies.com](https://www.casestudies.com/company/rf-smart/case-study/fisks-beauty-secret-for-increasing-inventory-accuracy)
- Industrial Controls Solutions: 99.8% inventory accuracy, 100% accurate outgoing shipments, annual count cut from three weeks to two days after RF-SMART scanning [VENDOR; no stated baseline accuracy] — [casestudies.com](https://www.casestudies.com/company/rf-smart/case-study/industrial-controls-solutions-replaces-quickbooks-with-rf-smart-netsuite)
- Thunderworks: >98% accuracy, eaches picking time down 75% [VENDOR] — [casestudies.com](https://www.casestudies.com/company/rf-smart/case-study/thunderworks-unleashes-growth-thanks-to-netsuite-and-rf-smart)
- Parts Town (Körber WMS): inventory accuracy improved ~30%, picking productivity ~20% [VENDOR; relative figure, baseline not given] — [casestudies.com](https://www.casestudies.com/company/korber-ag/case-study/how-a-flexible-wms-improved-warehouse-accuracy-and-efficiency-during-rapid-business-growth)
- Barcoded location labels: an appliance manufacturer reported inventory *location* accuracy "nearing 100 percent" after its WMS moved storage locations to barcode labels (Camcode, label vendor) [VENDOR] — [Camcode PDF](https://www.camcode.com/wp-content/uploads/2021/09/appliance-giant-case-study.pdf)
- Pick-to-light: no peer-reviewed before/after mispick-per-million study found. Vendor blog attributes to Fraunhofer IML "error costs reduced by up to 50%" and efficiency "+30%" (original study not located; unverified); another vendor claims error rates fall "up to 80%"; one anecdote of "almost 0%" errors in automotive [VENDOR, unverified] — [ekko.io](https://www.ekko.io/en/wissen/pick-to-light-advantages); [Racklify](https://racklify.com/encyclopedia/what-is-pick-to-light-how-it-works-in-warehouses/)
- Typical mispick baselines quoted in industry: 0.5-3% of picks; <0.5% a common target [TRADE/BLOG] — [Racklify mis-pick](https://racklify.com/encyclopedia/mis-pick-the-costly-error-hiding-in-your-warehouse/)
- Indonesian DMAIC case, PT Bintang Lima Imada (Morinaga milk distributor warehouse, Politeknik Negeri Batam, data Jan 2023-Jan 2024, implementation May 2024): Pareto of 131 discrepancy findings — data-entry error on goods in/out 55 (42%), wrong placement/storage 35 (27%; cumulative 69%), delay between physical movement and system posting 23 (18%; cum. 86%), goods on hold (shipment not matching invoice date) 18 (14%). Fishbone added: no warehouse layout map, inexperienced staff, manual work, SOP not detailed. Fixes: revised receiving SOP, layout scheme (seiton/5S), training, system improvement. Result: monthly stock difference fell from 4-7% to 1-2% at the May 2024 stock opname; authors say the receiving-SOP fix had the strongest effect [STUDENT/LOCAL JOURNAL; single period, one product] — [Polibatam repository PDF](https://repository.polibatam.ac.id//bitstreams/8929a65e-8c55-4235-9fd7-273e8a503344/download)
- PT United Tractors (heavy-equipment parts warehouse, Jurnal Logistik Indonesia 7(1), 2023, Ramanta & Hidayat): DMAIC found 4 causes of stock discrepancy and proposed improvements; abstract gives no quantified before/after [STUDENT/LOCAL JOURNAL] — [ojs.stiami.ac.id](https://ojs.stiami.ac.id/index.php/logistik/article/view/3454)
- PT Konimex (pharma engineering warehouse, SHS Conferences 189, 2024): DMAIC led to container redesign, 5S, and added warehouse personnel as fixes (numbers not retrieved; page returned 403) [ACADEMIC/CONFERENCE] — [shs-conferences.org](https://www.shs-conferences.org/10.1051/shsconf/202418901037)
- Cycle-count frequency: a stratified-sampling cycle count study at PT ABC (warehouse X, receiving division) reached 98.83% accuracy over 200 count cycles / 22,583 sampled items and noted higher counting frequency gave higher accuracy [LOCAL JOURNAL, IPB] — [journal.ipb.ac.id](https://journal.ipb.ac.id/index.php/jurnalmpi/article/view/56445/28309)
- PT AlQosbah central warehouse: average discrepancy 4.90%, IRA 90.10% vs. 95% target, prompting a cycle-count + EOQ schedule design (proposal, no after figure) [STUDENT] — [Telkom University](https://openlibrary.telkomuniversity.ac.id/pustaka/files/239307/jurnal_eproc/perancangan-kebijakan-penjadwalan-stock-opname-dengan-penerapan-cycle-counting-dan-metode-economic-order-quantity-eoq-untuk-mengurangi-ketidaksesuaian-persediaan-di-pt-alqosbah-dalam-bentuk-buku-karya-ilmiah.pdf)

### Inferences
- For a site that already scans rack location labels, the remaining gains are likely in what scanning does *not* yet cover: unscanned or late-posted transactions (the Bintang Lima "posting delay" bucket, 18%), wrong-placement at putaway (27%), and receiving entry errors (42%). Scan-to-confirm at putaway and at receipt is the closest analogue to the documented 85%->98% jumps.
- The DeHoratius & Raman variance split (26% between product categories vs. 3% between stores) argues for SKU-level targeting: separate look-alike SKUs/pack sizes and count those more, rather than counting all bins uniformly.
- The retail misplacement evidence (60% of stockouts from misplaced goods) suggests location audits (is the right SKU/batch in this bin?) can matter as much as quantity counts — relevant to FEFO, where a wrong-batch bin breaks expiry order even if the total is right.

### Gaps
- No peer-reviewed controlled study found for check-digit location labels, two-step loading verification, outbound audits, or "locked locations" with measured before/after numbers.
- Pick-to-light per-million error data: the Fraunhofer IML figure could not be traced to an original report.
- Full text of the United Tractors and Konimex papers (causes and numbers) not retrieved.

## People fixes (dedicated inventory control team, zone accountability, KPIs, training)

### Takeaway
Evidence is thin. Local DMAIC cases list training, SOP detail and added staff as fixes, bundled with process changes, so no effect can be isolated. One academic paper finds properly managed audit programs effective against shrinkage, especially employee theft.

### Cited Findings
- Smith, Smith & Baker (Int. J. Electronic Finance, 2011): "properly managed audit programs do provide an effective defense against inventory shrinkage, especially employee theft" [ACADEMIC; abstract only] — [Inderscience](https://www.inderscience.com/offer.php?id=41337)
- A retailer's "Zone Defense" program reportedly cut shrinkage 30% over three years — no methodology or named company [BLOG, anecdotal] — [shipscience.com](https://shipscience.com/?p=17060)
- Bintang Lima Imada: "inexperienced employees" and "lack of understanding of the layout" were root causes; fixes were training on inventory procedures/system use plus a layout map — bundled result 4-7% -> 1-2% [STUDENT] — [Polibatam PDF](https://repository.polibatam.ac.id//bitstreams/8929a65e-8c55-4235-9fd7-273e8a503344/download)
- Konimex: added warehouse personnel as one of the DMAIC fixes — [SHS Conferences 2024](https://www.shs-conferences.org/10.1051/shsconf/202418901037)
- DeHoratius & Raman 2008 identify auditing practices as a mitigating factor for record inaccuracy — [EconPapers](https://econpapers.repec.org/RePEc:inm:ormnsc:v:54:y:2008:i:4:p:627-641)

### Inferences
- People fixes appear to work only when tied to a process change (SOP + training + layout map together); report them as enablers, not standalone fixes.
- Zone accountability is mainly useful as a *diagnostic* (counts by zone/shift localise losses) — no evidence it reduces errors on its own.

### Gaps
- No controlled study found on incentives/KPIs, dedicated IC teams, or per-zone ownership with before/after accuracy numbers.

## System fixes (WMS-ERP integration monitoring, automated reconciliation, real-time sync, event-triggered counts)

### Takeaway
No published case gives before/after numbers for interface monitoring, but SAP's own knowledge base documents a recurring set of WMS-ERP stock-mismatch mechanisms (failed confirmations, duplicate postings, UoM changes, hidden restricted stock), and SAP ships a stock-comparison transaction — i.e., the vendor treats mismatch as an expected failure mode requiring a standing reconciliation check.

### Cited Findings
- SAP EWM `/SCWM/ERP_STOCKCHECK` is the standard EWM-vs-ERP stock comparison tool (KBA 3570504) [VENDOR DOCS] — [SAP KBA 3570504](https://userapps.support.sap.com/sap/support/knowledge/en/3570504)
- Failed interface confirmation: error /SCWM/ERPINTEGRATION105 occurs when the goods-issue/receipt confirmation is not sent to ECC after posting a delivery (KBA 2583325, 3329458) — [SAP KBA 2583325](https://userapps.support.sap.com/sap/support/knowledge/en/2583325); [SAP KBA 3329458](https://userapps.support.sap.com/sap/support/knowledge/en/3329458)
- "Ghost stock": EWM shows a quantity while ERP shows zero; correction report /SCWM/CORRECT_QUANTS; UoM change named as trigger (KBA 3724761) — [SAP KBA 3724761](https://userapps.support.sap.com/sap/support/knowledge/en/3724761)
- Duplicate processing of the posting-change queue in ERP after an inspection lot causes inconsistencies (KBA 3700268) — [SAP KBA 3700268](https://userapps.support.sap.com/sap/support/knowledge/en/3700268)
- Mismatch traced to restricted stock hidden by a default filter in the stock overview app (KBA 3666118) — [SAP KBA 3666118](https://userapps.support.sap.com/sap/support/knowledge/en/3666118)
- A third-party vendor sells a console for grouping/reprocessing failed IDocs, stating standard SAP "makes it difficult to monitor and react to failed IDocs quickly" [VENDOR PITCH] — [SAP partner page](https://www.sap.com/products/erp/partners/the-config-team-ltd-idoc-management-console-processing-failed-idocs.html)
- Bintang Lima Imada: 18% of discrepancy findings were posting delay between physical movement and system entry — the "real-time sync" root cause in a small distributor [STUDENT] — [Polibatam PDF](https://repository.polibatam.ac.id//bitstreams/8929a65e-8c55-4235-9fd7-273e8a503344/download)
- Event-triggered counting rationale: counts that find variances beyond a preset tolerance should trigger root-cause research rather than just an adjustment [PRACTITIONER] — [Plant Services](https://www.plantservices.com/management/supply-chain-management/article/11335568/road-to-reliability-the-road-to-accurate-inventory-cycle-counting-uses-experienced-counters-of-inventory-to-determine-reasons-why-errors-occur-plant-services); [GlobalSpec, "Achieving Inventory Accuracy" ch. 5, control groups and root cause](https://www.globalspec.com/reference/21784/203279/chapter-5-day-5-45-control-groups-and-root-cause-analysis)

### Inferences
- For a WMS that compares itself with SAP files (as this project's Buku stok / SAP compare pages do), the SAP KB list is a ready-made checklist of difference *types* to classify: unconfirmed GI/GR, duplicate posting, UoM, blocked/restricted stock, timing. Classifying each daily difference into one of these is the system analogue of a Pareto.

### Gaps
- No published before/after accuracy figures for interface monitoring, automated reconciliation, or event-triggered counts.

## Technology (RFID, drones, vision counting) — ROI, accuracy, fit for ~3,000 pallet-rack locations

### Takeaway
Drone vendors (Gather AI, Corvus, Verity, Dexory) all claim ~99.9% accuracy and labour savings, but all figures are self-reported. RFID's best independent-ish evidence (Auburn/GS1 2018, 63% -> 95%) is from item-level retail apparel, not cartons in pallet racks. For ~3,000 bins already scanned by rack label, these are hard to justify against process fixes; drones fit large high-bay sites where counting is labour-bound.

### Cited Findings
- Auburn University RFID Lab + GS1 US "Project Zipper" (June 2017-July 2018, >1 million items, 5 retailers, 8 brand owners): average inventory accuracy 63% (barcode) -> 95% (RFID); 99.9% order accuracy; out-of-stocks down up to 50% [ACADEMIC-INDUSTRY, retail item level] — [Retail Dive](https://www.retaildive.com/news/RFID-100-accurate-ROI-Auburn/539468); [Just Style](https://www.just-style.com/news/rfid-can-help-brands-achieve-near-100-order-accuracy/)
- Gather AI — Barrett Distribution (3PL, ~500,000 serialized shoe boxes, narrow aisles): count accuracy 99.95-100%, weekly counts up 15-20% [VENDOR] — [casestudies.com](https://www.casestudies.com/company/gather-ai/case-study/613-revolutionizing-inventory-management-for-a-shoe-retailer)
- Gather AI — Langham Logistics testimonial: accuracy 97% -> >99% after starting in 2022; one person scanning 1,200 locations/day vs. four people counting 800 previously; NFI recovered >15 pallets missing for weeks (in racks, not in system) [VENDOR]; Gather AI's "70% accuracy improvement" claim appears attributed to different clients on different pages — treat as unreliable — [Gather AI](https://gather.ai/news-and-insights/drones-take-flight-in-omnichannel-distribution-centers); [Gather AI misplaced inventory](https://gather.ai/news-and-insights/avoid-misplaced-inventory-and-line-down-situations-with-drone-powered-warehouse-monitoring)
- Drone throughput ~300 pallets/hour per drone; setup typically 4-6 weeks [TRADE PRESS] — [Inside Logistics](https://www.insidelogistics.ca/features/how-drones-are-being-used-to-improve-warehouse-inventory-accuracy-and-efficiency/)
- Corvus Robotics: claims 99.9% accuracy and freeing up to 10% of rack space; customer LAPP uses nightly flights to flag misplaced/mislabelled reels in place of manual cycle counting [VENDOR] — [DroneLife 2024](https://dronelife.com/2024/10/08/corvus-robotics-launches-autonomous-inventory-system-for-lights-out-warehouses/amp); [Manufacturing.net](https://www.manufacturing.net/aerospace/news/22922719/corvus-robotics-brings-autonomous-inventory-management-system-to-lightsout-warehouses)
- Verity: >50M inventory checks, >1M errors found, 13+ countries, clients incl. DSV, Maersk, INGKA; "upwards of 99.9% accuracy", "99.994% reliability" [VENDOR/aggregator] — [Robotics 24/7](https://www.robotics247.com/article/verity_raises_32m_series_b_roll_out_more_autonomous_inventory_drones_worldwide); [CB Insights](https://www.cbinsights.com/company/verity-1)
- Dexory: only an unattributed customer quote of "99.9%" found [unverified] — [CB Insights](https://www.cbinsights.com/compare/botsandus-vs-verity-1)

### Inferences
- Arithmetic from the trade-press rate: ~2,970 locations at ~300 pallets/hour ≈ 10 drone-hours for a full scan — feasible, but the same coverage is achievable by a few people with phones over days; the business case is weaker at this scale than at the 50k+ location sites in the case studies.
- Drone/vision reads the pallet label/location, not cartons inside a broken pallet; at a site with a pick face per SKU and loose cartons, the pick faces (where most counting error sits) are the bins drones count least well. (Inference; no source measured carton-level accuracy on open pallets.)
- RFID's 63%->95% is item-level apparel; for case/pallet lubricants already barcode-scanned, the gap RFID closes is much smaller.

### Gaps
- No independent (non-vendor) audit of drone accuracy, and no published ROI figures with cost data.
- No case found of drones/RFID in an Indonesian or SEA 3PL.

## What did NOT work or backfired

### Takeaway
The recurring lesson in practitioner literature is that counting and adjusting without investigating leaves the cause in place; no controlled study proves it, but the modelling evidence (Kang & Gershwin) shows uncorrected small losses compound.

### Cited Findings
- Most firms "simply update the system to match the count", sometimes after a recount, leaving the underlying cause; a proper programme seeks the root cause of each discrepancy [PRACTITIONER] — [Plant Services](https://www.plantservices.com/management/supply-chain-management/article/11335568/road-to-reliability-the-road-to-accurate-inventory-cycle-counting-uses-experienced-counters-of-inventory-to-determine-reasons-why-errors-occur-plant-services); [EDSI](https://www.edsi.com/blog/improving-your-inventory-records-with-cycle-counting)
- Plants above 95% within tolerance can sometimes skip the annual physical freeze with auditor agreement — i.e., freezing operations is the fallback when cycle counting is not trusted [PRACTITIONER glossary] — [Lightsource glossary](https://gaslamp.lightsource.ai/glossary/cycle-counting)
- Adjusting stock in EWM without a matching ERP posting can create phantom inventory (SAP Community answers) — a blanket adjustment in one system shifts the difference rather than removing it — [SAP Community](https://community.sap.com/t5/supply-chain-management-q-a/adjust-stock-in-ewm-but-not-in-erp/qaq-p/12650517)
- Small undetected losses accumulate into severe stockouts (Kang & Gershwin 2005) — [MIT DSpace](https://dspace.mit.edu/handle/1721.1/36193)
- Vendor claims are inconsistent: Gather AI's "70%" figure attributed to different clients — an example of why vendor numbers should not be used as a planning baseline — [Gather AI](https://gather.ai/news-and-insights/avoid-misplaced-inventory-and-line-down-situations-with-drone-powered-warehouse-monitoring)

### Inferences
- Blanket write-offs after a count are the "adjust without investigating" failure mode at scale; the evidence above suggests requiring a reason code per adjustment and a Pareto of reasons before any write-off.

### Gaps
- No study found that measures accuracy with vs. without root-cause analysis, or the effect of blanket write-offs or operation freezes.
