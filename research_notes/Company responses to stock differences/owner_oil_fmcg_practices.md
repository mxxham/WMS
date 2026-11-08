# Owner-side practices of oil/lubricant and FMCG/chemical companies when 3PL stock differs from SAP

Scope note: about 15 searches and fetches. Several primary pages (the ACCA-hosted Shell job ads, hr.asia) returned HTTP 403, so some Shell wording comes from search-engine extracts of those pages. Each such item is marked "(search extract, page not fetched)". Overall, oil majors publish very little about how they handle 3PL stock. The best public evidence is Shell's own job advertisements for stock-accounting roles.

## 1. Published supplier/3PL requirements, warehouse standards, distributor manuals (oil/lubricant companies)

### Takeaway
I found no public Shell, ExxonMobil, Castrol/BP, TotalEnergies, Chevron or Pertamina Lubricants document that sets 3PL stock-reconciliation obligations, such as joint stocktakes or monthly reconciliation statements. These terms appear to live in private contracts. The only published Shell distributor standard I found, the DPQA brochure, covers product quality, not stock reconciliation.

### Cited Findings
- Shell Lubricants has a "Distributor Product Quality Assurance" (DPQA) programme. It sets contractual quality-system obligations for distributors handling bulk lubricants and does not cover stock reconciliation. — [DPQA Form No 10 brochure (Keller-Heartt)](https://www.kellerheartt.com/cdn/shop/files/DPQA_FORM_No_10_QUALIFICATION_TRI-FOLD_BROCHURE.pdf?3989)
- TotalEnergies advertises a dedicated "Assistant Lubricants Stores Supervisor – Reconciliation" role, which shows that lubricant store reconciliation is a named job at TotalEnergies. — [jobs.totalenergies.com](https://jobs.totalenergies.com/es_ES/careers/JobDetail/ASSISTANT-LUBRICANTS-STORES-SUPERVISOR-RECONCILIATION/71962) (search result only, not fetched)
- Pertamina Lubricants outsourced distribution to Eastern Indonesia to Elnusa Petrofin (2022). The press release gives no stock-reconciliation terms. — [Pertamina](https://www.pertamina.com/en/news-room/news-release/pertamina-lubricants-collaborates-with-elnusa-petrofin-to-strengthen-lubricant-distribution)

### Inferences
- The reconciliation frequency, tolerance and loss-liability clauses that bind PT CKB are almost certainly in the Shell–CKB warehousing contract or its SOP or service-level schedule. That contract is the authoritative source, and nothing public will substitute for it.

### Gaps
- No public Shell HSSE warehouse standard or 3PL stock-reporting manual was found.
- Nothing public was found for Chevron, ExxonMobil/Mobil or Castrol on 3PL stock reconciliation.

## 2. How owners' finance/supply chain teams process a 3PL discrepancy in SAP

### Takeaway
Shell's own job ads describe the process. A stock-accounting analyst in a Shell Business Operations centre (Kuala Lumpur, Manila, Krakow, Cyberjaya) compares Shell's book stock with the third-party depot's figures daily and at month-end, and investigates every difference. Differences within an allowed tolerance are posted to gain/loss accounts under Shell's Manual of Authorities (MoA), in line with GSAP and SOX. Differences outside tolerance are escalated and resolved with the third party. In standard SAP MM the count and posting run through physical-inventory documents (MI01/MI04/MI07) with reason codes.

### Cited Findings
- A Shell Business Operations Kuala Lumpur posting ("Analyst – Manage Hydrocarbon Inventory") asks the analyst to "Investigate and resolve any discrepancies with figures from 3rd party operated depots, including stock differences outside of tolerance." It also refers to period-end reconciliation against physical stock figures. — [ACCA Careers / Shell](https://jobs.accaglobal.com/job/3551742/analyst-manage-hydrocarbon-inventory/) (search extract, page not fetched: 403)
- A related Shell energy-accounting posting says: "Post any final stock differences within allowed tolerance to the appropriate gain/loss accounts in accordance to the Manual of Authorities (MoA), in compliance with GSAP and SOX guidelines." GSAP is Shell's global SAP instance. — [ACCA Careers / Shell "Analyst – Manage HC Inventory"](https://jobs.accaglobal.com/job/7480537/analyst-manage-hc-inventory/); see also [Shell "Analyst – DS Energy Acct SRR"](https://builtin.com/job/analyst-ds-energy-acct-srr/4551436) (search extracts, pages not fetched)
- Other Shell postings describe daily comparison of Shell book balances with third-party inventory reports and validation of throughput and physical stock at third-party sites. A Philippines "Terminal Stock Reconciliation Analyst" role (posted Dec 2025) handles daily and monthly reconciliation for Shell-owned and third-party terminals. — [energyjobsearch](https://energyjobsearch.com/jobs/other-jobs/1254696); [foundit.com.ph](https://www.foundit.com.ph/job/stock-accounting-analyst-shell-philippines-40595456) (search extracts)
- A Shell Business Operations Krakow posting ("Outbound Finished Goods Officer", fetched) lists these duties:
  - "Ensure stocks reconciliation program daily/weekly/endmonth/bi-annually physical stocks count exercise (cyclecounting and wall-to-wall stocks take)"
  - "Verifying all stocks movement in the warehouses and reconciliation is to be carried out for stock accounting purposes"
  - "Provide monthly review of inventory to finance and justifications for all material stock movements"
  - "Tariffs control, reporting and provisions management"
  - "Monitor and timely account for product returns"
  — [karierawfinansach.pl](https://www.karierawfinansach.pl/oferta-pracy/112798,outbound-finished-goods-officer-krakow)
- A UK FMCG "Inventory Controller" role keeps SAP aligned with stock at co-packers and 3PL warehouses, reconciles monthly 3PL stock reports with SAP, and records receipts, dispatches, adjustments and write-offs. — [Hays](https://www.hays.co.uk/job-detail/JOB_5267119&jobSource=GCJ) (search extract)
- In standard SAP MM, a count document is created per plant and storage location (MI01), the count is entered (MI04), and the difference is posted (MI07) with a reason code, creating a material document. — [Guru99](https://www.guru99.com/all-about-physical-inventory.html); [SAP Answers](https://answers.sap.com/questions/3849882/stock-removal-from-storage-location.html); [JBVNL MM07 manual](https://jbvnl.co.in/Training/MM/JBVNL_MM07_User%20Manual_Physical%20Inventory%20Process_V0.pdf)
- MI07 can post a difference only in the fiscal period in which the count took place (SAP KBA 1589511). A back-dated posting uses current stock, not stock at the count date. — [SAP KBA 1589511](https://userapps.support.sap.com/sap/support/knowledge/en/1589511); [SAP Answers](https://answers.sap.com/questions/9225383/physical-inventory-count-posting-for-a-back-date.html)
- In a SAP forum thread on a 3PL whose WMS feeds SAP through PI/XI interfaces, practitioners advise using a physical inventory to clear differences that remain after the interface movements. — [SAP archive](https://archive.sap.com/discussions/thread/3221439); [SAP Community Q&A](https://community.sap.com/t5/supply-chain-management-q-a/inventory-reconciliation-problem-at-3pl/qaa-p/12781315)

### Inferences
- For a Shell warehouse such as WSM SUB 2 (SAP storage location WHS1 plus the inbound location), the likely owner-side path is:
  1. CKB sends stock and movement reports.
  2. A Shell stock-accounting analyst, probably in a Shell Business Operations hub rather than in Surabaya, compares them with GSAP.
  3. Unexplained differences go back to the 3PL for investigation.
  4. Only a final difference is posted. Within tolerance it goes to gain/loss under the MoA. Above tolerance it needs higher MoA approval and a possible claim against the 3PL.
- The custom movement types Z31/Z55 seen in the Shell data are probably Shell's own GSAP movement types for such postings or transfers. This is not publicly confirmed.
- Because of the "same fiscal period" rule in MI07, owners push the 3PL to explain differences before month-end close. The 3PL's speed of explanation therefore matters to the owner.

### Gaps
- The numeric tolerance and MoA thresholds are not public.
- Whether Shell lubricants (as opposed to fuels and hydrocarbons) use the same "HC inventory" stock-accounting team was not confirmed.
- No public description of how Shell provisions for stock loss was found.

## 3. Damaged, leaking, expired or quarantined lubricants: blocking, disposal, B3, recovery

### Takeaway
I found no oil-company public procedure for 3PL-held damaged or expired lubricant. Under Indonesian law, expired B3 material, spilled B3 material and off-spec product to be discarded, plus used B3 packaging, form their own category of B3 waste under PP 22/2021. Handing it to a licensed party requires delivery documents. Illegal processors are prosecuted.

### Cited Findings
- PP 22/2021 groups waste from expired B3, spilled B3, off-spec B3 product to be discarded, and used B3 packaging as its own source category. — [Perwal lampiran (BPK)](https://peraturan.bpk.go.id/Download/204789/79%20Lampiran%20perwal%20Limbah%20B3%20(%20jadi).pdf); [CRPG summary of PP 22/2021](https://crpg.info/b3-waste-labeling-and-packaging-indonesias-safety-framework-under-pp-22-2021/)
- Waste codes in that category (for example A108d) are described inconsistently across secondary sources ("limbah terkontaminasi B3" in one regional annex, other descriptions in academic papers). The official PP 22/2021 annex should be checked. — [BPK lampiran](https://peraturan.bpk.go.id/Download/204789/79%20Lampiran%20perwal%20Limbah%20B3%20(%20jadi).pdf); [ITATS](https://ejournal.itats.ac.id/envitats/article/download/09/pdf)
- Under PP 101/2014 (since replaced by PP 22/2021), a B3 waste producer that hands waste to another party must have delivery evidence documents (Art. 32(2)). — [BIOLINK journal](https://garuda.kemdiktisaintek.go.id/documents/detail/1617686)
- Used oil is B3, and the producer of B3 waste must manage it. — [detikOto](https://oto.detik.com/berita/d-4218772/bahayanya-oli-bekas-jika-tidak-dikelola-dengan-benar); [Unisla journal](https://jurnalkesehatan.unisla.ac.id/index.php/jev/article/view/377)
- The Ministry of Environment sealed an illegal used-oil processor in Tangerang that had no Persetujuan Teknis or SLO. — [KemenLH](https://kemenlh.go.id/news/detail/tindak-lanjut-keluhan-masyarakat-menteri-lh-tugaskan-deputi-gakkum-segel-pabrik-pemanfaatan-oli-bekas-ilegal-di-tangerang)
- A Europe-based 3PL-facing role lists "goods disposal approvals" together with reconciliation with the 3PL and stock adjustments. This shows disposal is approved by the owner, not decided by the 3PL. — search extract from [karierawfinansach.pl inventory analyst Krakow](https://www.karierawfinansach.pl/oferta-pracy/106764,inventory-analyst-in-contracting-procurement-krakow) (not fetched)

### Inferences
- For CKB, damaged or expired Shell product should be:
  1. blocked (moved to quarantine; in SAP, blocked stock);
  2. reported to Shell;
  3. disposed of only on Shell's written approval, through a licensed B3 transporter and processor, with the manifest and berita acara pemusnahan kept as the evidence behind Shell's write-off.
- Who counts as the "penghasil" (waste producer), Shell as owner or CKB as site operator, needs to be settled contractually. No public source settles it.

### Gaps
- No Shell, Castrol or ExxonMobil public procedure for disposal approval or for recovering the cost of damaged lubricant from a 3PL or insurer was found.
- No published berita acara template specific to lubricant was found.

## 4. Case studies: FMCG/chemical companies fixing 3PL stock mismatches

### Takeaway
Named-company case studies with measured results are scarce. The clearest case (JK Tech) is an anonymous FMCG client whose stock controllers manually reconciled several 3PL WMSs against SAP ("Sirius"). It was automated with daily rule-based root-cause reports, and the published benefits are qualitative only. I found no Unilever, P&G, Nestlé or BASF case with numbers.

### Cited Findings
- JK Tech's FMCG client covers food and beverages, cleaning and beauty/personal care, and has 80+ years of history. Its 3PL WMS stock often did not match its SAP system "Sirius". Stock controllers investigated by hand, daily for interfaced warehouses and weekly for non-interfaced ones.
  - Root causes: IDoc failures between WMS and SAP and inside PI; WMS transactions with no preceding SAP document; and WMS-completed transactions never triggered in SAP.
  - Fix: automated rule-based analysis giving a likely root cause and resolution path per difference, run once a day and emailed to the person responsible for reconciliation.
  - Results are qualitative only: better stock availability and ATP accuracy, lower financial risk, reusable in other regions.
  — [JK Tech](https://jktech.com/success-stories/enabling-business-transformation-by-eliminating-stock-mismatch-reconciliation-increasing-stock-accuracy-and-reducing-financial-risk/)
- Protiviti describes a PI/PO real-time integration between S/4HANA and a 3PL WMS for an Indian PVC manufacturer. No reconciliation metrics are given. — [Protiviti](https://www.protiviti.com/sites/default/files/2024-08/protiviti_client_story_sap_s4hana_and_3pl_warehouse_integration_for_a_leading_indian_pvc_manufacturer.pdf)
- Master-data mismatches (material numbers, storage locations) make handoffs fail and let WMS and ERP drift apart. — [C3 Solutions](https://www.c3solutions.com/blog-c3/3pl-process-flow/)
- Unilever consolidated SAP into four regional landscapes, with Western Europe completed in 2008. This is context only. No public source names "Sirius" as a Unilever instance. — [The Manufacturer](https://www.themanufacturer.com/articles/unilever-to-expand-use-of-sap-in-the-us/); [Computer Weekly](https://www.computerweekly.com/feature/Unilever-puts-SAP-at-the-captains-table)

### Inferences
- The JK Tech client profile fits Unilever (foods, home care, beauty/personal care), but this is unconfirmed. Do not name Unilever in the report.
- The three root causes (failed interface messages, WMS movements without an SAP document, WMS movements never sent) are the categories an owner checks before treating a difference as physical loss. A WMS that can show every movement with its matching SAP document number directly reduces the owner's investigation work.

### Gaps
- No measured outcomes (accuracy %, hours saved, write-off reduction) were found for any named FMCG or chemical owner.

## 5. How owners charge the 3PL (liability, tolerance, KPIs)

### Takeaway
Nothing public from the named companies. Generic contract practice: the owner absorbs shrinkage up to a contractual tolerance, and the 3PL is liable above it when the loss happened in its custody and procedures were not followed. Liability is often capped, and insurance covers catastrophic loss, not routine variance.

### Cited Findings
- Most 3PL agreements set a shrinkage allowance or tolerance before liability applies. Liability is often capped per occurrence or as a multiple of monthly fees, with carve-outs for gross negligence. Some contracts split unexplained shrinkage, for example 50/50. — [Racklify](https://racklify.com/encyclopedia/liability-insurance-and-contract-tips-for-managing-lost-inventory-with-3pls/); [Cleverence](https://www.cleverence.com/amp/articles/3pl-business/liability-for-lost-or-damaged-goods-risk-for-3pls-4827/)
- One vendor's sample clause: the owner absorbs shrinkage up to 0.5% of monthly average inventory value, the 3PL is liable above that, with a 99.5% accuracy guarantee and material breach below 99%. This is illustrative and unsourced, not a market standard. — [Red Stag Fulfillment](https://redstagfulfillment.com/what-is-average-shrinkage-rate-for-3pl/)
- Common owner-tracked KPIs: inventory accuracy (cycle-count variance), shrinkage/loss rate, days on hand. — [Infosys BPM](https://www.infosysbpm.com/blogs/supply-chain/3pl-performance-metrics.html); [Racklify KPIs](https://racklify.com/encyclopedia/3pl-kpis-key-metrics-to-measure-3pl-performance/)
- The Shell Krakow role includes "Tariffs control, reporting and provisions management", which suggests the owner tracks 3PL tariffs and stock provisions in the same role. — [karierawfinansach.pl](https://www.karierawfinansach.pl/oferta-pracy/112798,outbound-finished-goods-officer-krakow)

### Gaps
- No public Shell (or other oil major) tolerance %, charge-back rule or valuation basis for 3PL losses (cost vs. selling price) was found.

## 6. Shell-specific: SAP setup, 3PLs in Indonesia, Marunda, ownership/consignment

### Takeaway
Shell runs a global SAP instance called GSAP. Postings to stock differences are governed by a Manual of Authorities and SOX, and done by Business Operations hubs. Public sources describe the Marunda plant and Shell's Indonesian distributors, but name no Shell lubricants 3PL, and nothing public describes stock ownership or consignment arrangements with Indonesian 3PLs.

### Cited Findings
- GSAP, the MoA and SOX are cited together for posting stock differences within tolerance to gain/loss accounts. — [ACCA Careers / Shell](https://jobs.accaglobal.com/job/7480537/analyst-manage-hc-inventory/) (search extract)
- Marunda (Marunda Centre, north of Jakarta) opened in late 2015. It blends automotive, industrial and marine lubricants. A capacity doubling to 300 million litres a year on a 9-hectare site was announced in 2020. — [Shell 2020 release](https://www.shell.com/business-customers/lubricants-for-business/news-and-media-releases/2020/shell-to-double-capacity-in-indonesian-lubricant-plant.html)
- Marunda produces almost 70% of the lubricants Shell sells in Indonesia (2016). Before that, product was imported from regional plants. — [Shell marine release 2016](https://www.shell.com/business-customers/marine/news-and-media-releases/news-and-media-2016/shell-indonesia-lubes-plant-producing-marine-lubricants.html); [Lubes'n'Greases](https://www.lubesngreases.com/lubereport-asia/3_41/indonesian-energy-boom-beckons-lube-suppliers/)
- Shell lubricants distributors in East Java include Sefas Pelindotama (warehouses in Krembangan Utara and Margomulyo, Surabaya) and PT Pancaputra Mitratama Mandiri (industrial/transport). — [Sefas Group](https://sefasgroup.com/companies)
- A secondary source reports Shell selling its Indonesian retail stations to a Sefas-linked venture, with completion expected by end-2026. — [Asia News Network](https://asianews.network/shell-to-sell-local-gas-stations-to-new-indonesia-philippine-venture/) (not fetched; verify)
- An hr.asia award profile reportedly mentions a Shell terminal in Gresik, third-party terminals (Tanjung Priok, Merak, Kuala Tanjung), and Surabaya as a marine-lubricant stock point. — [hr.asia](https://hr.asia/awards/?p=5359) (search extract only; fetch returned 403; treat as unverified)
- Shell-linked lubricant businesses elsewhere (Vivo Energy Kenya) run monthly cycle counts of lubricants and periodic stock counts. — [MyJobMag Kenya](https://www.myjobmag.co.ke/job/lubricants-warehouse-dispatcher-vivo-energy) (search extract)

### Inferences
- WSM SUB 2 is a Shell-owned stock location operated by CKB (Shell storage location WHS1 in GSAP). If so, the goods are Shell's own stock in a 3PL warehouse, not consignment to a distributor. Every difference is therefore a Shell gain/loss posting needing MoA approval, and CKB's role is to provide counts, explanations and evidence.

### Gaps
- No public information was found on:
  - the 3PL used for Shell lubricants in Surabaya (CKB's role is not publicly documented);
  - Shell Indonesia's lubricants storage-location design;
  - the meaning of movement types Z31/Z55;
  - consignment arrangements.
