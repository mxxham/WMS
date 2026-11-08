# How Indonesian warehouses and 3PLs handle stock differences ("selisih stok")

Scope note: about 16 searches and fetches, mostly in Indonesian, on 4 Nov 2026. Most public Indonesian material is academic (university repositories, SINTA/Garuda-indexed journals) or vendor and logistics blogs. **I found no published SOP, contract clause or case study from any named major 3PL (Kamadjaja, Puninar, Dunex, Enseval, Kalbe/KAEF, Pos Logistik, Lautan Luas, CKB Logistics, MGM Bosco, Pancaran, Agility, DHL Indonesia), and nothing from a Shell or Pertamina lubricant distributor.** Each gap is recorded below. Do not fill these gaps from memory.

## 1. The typical Indonesian procedure: stock opname, berita acara, approvals, settlement

### Takeaway
In Indonesian practice a count (`stock opname`, full or partial/cycle) is followed by a recount by a different person, a search through transaction documents, approval by a superior or warehouse manager, a signed `Berita Acara (Selisih) Stock Opname`, and finally a `jurnal penyesuaian` posted by finance, never a direct edit of the system. Public sources describe these steps inside one company. How the difference is then settled between a 3PL and its client (tolerance, valuation, `potong tagihan`) does not appear in any public Indonesian source I found.

### Cited Findings
- MAS Cargo Express is an Indonesian cargo and logistics firm based in Serpong, Tangerang Selatan. Its guide (published 30 Oct 2026) sets out these steps for a difference:
  1. Recount (`hitung ulang`) by a *different* officer.
  2. Trace the documents: `surat jalan`, `bukti terima`, receipt.
  3. Compare the difference against a tolerance. Its example tolerances are 0% for high-value goods (recount and trace immediately), 1% for fast movers (recount and report to the warehouse manager), and 2% for low-value goods (log it and review next cycle).
  4. A superior or warehouse manager approves before any adjustment.
  5. Write a `berita acara` with the date and location, the counters and a witness (`saksi`), the items with their difference, the suspected cause and the corrective action, and the signature of the responsible person (`penanggung jawab`).
  6. Never change the system record directly. Finance posts a `jurnal penyesuaian`. The guide cites PSAK 202 (inventories).

  — [MAS Cargo Express, "Stock Opname Partial"](https://www.mascargoexpress.com/stock-opname-partial-adalah/)
- A vendor guide says the `berita acara stock opname` records the time, the areas counted, the team members, the counting method, the final result and the *decision on the difference*. It is the formal proof that a count happened in a given period. Supporting documents named: proof of goods in and out, the `kartu stok`, and the stock adjustment report. — [HashMicro, "Cara mengatasi selisih stock opname"](https://www.hashmicro.com/id/blog/cara-mengatasi-selisih-stock-opname); [HashMicro, "Dokumen Stock Opname"](https://www.hashmicro.com/id/blog/dokumen-stock-opname/) (vendor blog, secondary)
- Accounting practice is described the same way. A difference is traced through the transaction evidence, then recorded in a `berita acara` and an adjusting journal approved by management. When a difference is found, the fix is a `jurnal koreksi`. — search summaries of [Mekari Jurnal stock opname guide](https://www.jurnal.id/id/blog/2018-stock-opname-dokumen-yang-dibutuhkan-dan-tips-melakukannya-secara-efektif) and [Poltek CWE journal](https://journal.poltekcwe.ac.id/index.php/jurnal_citrawidyaedukasi/article/download/87/79/314) (not fetched in full)
- A public template "BA Stok Opname Persediaan" exists on Scribd, which shows the document is standard. — [Scribd](https://www.scribd.com/document/698923357/BA-STOK-OPNAME-PERSEDIAAN) (not opened)
- Valuation: the value of a difference is the units short times the `harga pokok` (cost price) per unit. Worked example: 120 units on the books, 113 found, 7 × Rp25.000. An unresolved question these sources raise is when a difference becomes a company expense (`beban lain-lain`) and when it is *charged to the warehouse person responsible* (`dibebankan kepada penanggung jawab gudang`). They also recommend that someone independent of the warehouse verify the count. — search summary of [Mekari Expense, "Panduan Stock Opname"](https://expense.mekari.com/blog/panduan-stock-opname) and [Audithink](https://audithink.com/blog/stock-opname-adalah/) (not fetched individually)
- Frequencies in Indonesian job postings are daily, weekly and monthly counts plus investigation of differences (Bekasi posting). Another Jakarta posting runs stock opname for cosmetics stock across Indonesia. — [gaji.co.id listing](https://gaji.co.id/lowongan-kerja/staf-inventory-control/), [Indeed ID](https://id.indeed.com/q-inventory-control-lowongan.html) (search summaries)
- Typical "Staf Inventory Control" duties in Indonesian postings:
  - routine physical counts, and analysing and correcting the difference between physical and system stock (Jakarta Utara, Rp5.0–5.5 jt/month, contract) — [KitaLulus](https://kitalulus.com/lowongan/detail/staf-inventory-control-4oeg)
  - following up `selisih`, damage and loss "sesuai prosedur yang berlaku" (Jogja) — [Glints, PT Anugerah Senthosa Agoeng](https://glints.com/id/opportunities/s/inventory-control-staff/81803410-8ed5-4171-b76a-46fc04eb4cba)
  - investigating `selisih`, damaged, lost or mis-recorded goods, and producing stock opname and inventory accuracy reports (Makassar) — [KitaLulus Makassar](https://kitalulus.com/lowongan/detail/inventory-control-yw5p)

  All three are search-snippet summaries.
- At PT Rapi Trans Logistik Indonesia, a logistics company, the control step after a DMAIC study was:
  - a daily stock-check SOP recording physical stock, system stock and the difference
  - a daily checklist *verified by the warehouse supervisor*
  - routine checks by the supervisor and a *weekly report reviewed by the logistics manager*
  - an end-of-day stock check
  - weekly stock audits and an early-warning system

  — [Candra & Dewantoro (2025), Industrial & System Engineering Journal (UKDC) 3(2)](https://jurnal.ukdc.ac.id/index.php/isejou/article/download/784/442/4103)

### Inferences
- The chain of approval described is internal: counter, then supervisor or `kepala gudang`, then warehouse manager, then finance. For a 3PL the client's representative would be the extra signatory on the `berita acara` before the client posts the adjustment in its own system (Shell SAP for CKB). This step is inferred from how the documents work, not sourced.
- "Never edit the system directly; adjust through a signed document and a journal" in the MAS guide matches CKB's rule that stock only changes through `movements`.

### Gaps
- No Indonesian source describes 3PL-to-client settlement terms (`klaim selisih`, `potong tagihan`, the tolerance written in the contract, valuation at cost or selling price, claim deadlines). A targeted search for warehousing-agreement clauses (`perjanjian jasa pergudangan` + `ganti rugi` + `selisih`) found no sample contract. The only tolerance-clause material I found was non-Indonesian: [Racklify, shrinkage allowance](https://racklify.com/encyclopedia/what-is-shrinkage-allowance-definition-and-contract-basics/), example 0.8%/month; [Boyes Turner (UK)](https://www.boyesturner.com/insights/key-issues-for-customers-to-consider-when-negotiating-logistics-and-warehousing-contracts); [materialfluss.de on BGH I ZR 146/17 (Germany)](https://www.materialfluss.de/opinion/being-right--inventory-losses-and-exclusion-of-liability.htm).
- I found no public "Berita Acara Kerusakan Barang" procedure specific to 3PLs.

## 2. Named Indonesian 3PLs and distributors: SOPs, case studies, job postings

### Takeaway
None of the named major 3PLs or distributors publishes a stock-difference SOP that a search can find. The concrete named cases are academic case studies at PT Rapi Trans Logistik Indonesia and PT United Tractors, plus Telkom University studies of cycle counting at 3PL or distribution-centre sites. Those sites are anonymised as PT XYZ.

### Cited Findings
- **PT Rapi Trans Logistik Indonesia** (Candra & Dewantoro, 2025). This is the logistics company's *own spare-part warehouse*, not client stock.
  - A stock opname of 20 spare-part SKUs found discrepancies of 8.33% to 200% per item. Two items, a Hino side-mirror stay and an Isuzu Giga sensor, reached 200% against a p-chart UCL of 141.99%.
  - Root causes (fishbone): manual recording errors, parts withdrawn without being recorded, and slow data sync.
  - Improvements: barcode or RFID recording, a stricter SOP, and tighter control of withdrawals.
  - Result reported: recording accuracy +92% and stock differences −80% against the previous period.

  — [Candra & Dewantoro 2025, PDF](https://jurnal.ukdc.ac.id/index.php/isejou/article/download/784/442/4103)
- **PT United Tractors**, East Jakarta warehouse: Six Sigma DMAIC on "stock warehouse difference". The abstract reports 4 causes but gives no figures or names for them. — [Ramanta & Hidayat (2023), Jurnal Logistik STIAMI 7(1)](https://ojs.stiami.ac.id/index.php/logistik/article/view/3454)
- **PT XYZ raw-material distribution centre**, keywords "3PL, Inventory Record Accuracy, Cycle Counting". IRA was below target. The proposed cycle-count stock-take policy cut stock-take cycle time to 161.67 s per pallet. — [Telkom University abstract](https://openlibrary.telkomuniversity.ac.id/pustaka/files/104073/abstraksi/designing-stock-taking-policy-for-reducing-total-cost-of-stock-take-using-cycle-counting-method-in-raw-material-distribution-center-of-pt-xyz.pdf)
- **PT Al-Qosbah** holds over 600,000 items. It does a monthly full stock opname, and discrepancies still recur. The paper proposes a cycle-counting schedule. — [Telkom University e-proc](https://openlibrary.telkomuniversity.ac.id/pustaka/files/239307/jurnal_eproc/perancangan-kebijakan-penjadwalan-stock-opname-dengan-penerapan-cycle-counting-dan-metode-economic-order-quantity-eoq-untuk-mengurangi-ketidaksesuaian-persediaan-di-pt-alqosbah-dalam-bentuk-buku-karya-ilmiah.pdf) (search summary)
- A study compares an outsourced WMS with an in-house one on productivity and stock accuracy. I saw only the abstract header, so its findings are unverified. — [JPPI / IICET](https://jurnal.iicet.org/index.php/jppi/article/view/4964)

### Inferences
- Large Indonesian 3PLs treat their SOPs as internal or client-confidential. Public evidence of practice comes from student theses written at their sites, often anonymised.

### Gaps
- Kamadjaja, Puninar, Dunex, Enseval, Kalbe/KAEF, Pos Logistik, Lautan Luas, CKB Logistics, MGM Bosco, Pancaran, Agility, DHL Indonesia: no public SOP or case study found. A search combining these names with "selisih" or "inventory accuracy" returned nothing relevant. I did not search LinkedIn job pages for each company individually, which is the next step if this matters.

## 3. Indonesian theses and journals: causes, methods, measured results

### Takeaway
Indonesian studies almost all apply fishbone (often "6M") inside DMAIC, sometimes with FMEA, 5 Whys or p-charts. The causes they find repeat across studies: manual recording, unrecorded withdrawals, late system updates, unscheduled stock opname, and workload. Only one study gave a measured before/after result (−80% difference, PT Rapi Trans).

### Cited Findings
- **PT MI spare-part warehouse** (Barbara & Irawati, UKDC ISEJ 1(1), Dec 2022). Discrepancy is defined as actual minus system quantity. The study used DMAIC with a p-chart and found many points outside the UCL/LCL. Fishbone causes: people, method, and work environment. No quantified result. — [Barbara & Irawati 2022](https://jurnal.ukdc.ac.id/index.php/isejou/article/view/404)
- **PT Rapi Trans Logistik Indonesia**: DMAIC + SIPOC + fishbone, −80% difference, +92% accuracy (detail in §2). — [Candra & Dewantoro 2025](https://jurnal.ukdc.ac.id/index.php/isejou/article/download/784/442/4103)
- **Undip D3/S1 theses** using fishbone 6M:
  - BPTD Kelas II Banten: *method* was the dominant cause. Recommendations: timely data updates, periodic stock opname, supervision. — [Undip eprints 55247](https://eprints2.undip.ac.id/55247/7/BAB%20V%20%282%29.pdf)
  - PT XYZ Gudang I-1 Jakarta: the stock-recording system was "not yet fully effective". — [Undip eprints 58389](https://eprints2.undip.ac.id/id/eprint/58389/7/TUGAS%20AKHIR%20DILLA%20BAB%20V.pdf)
  - Another thesis names *unscheduled stock opname and high workload* as causes.

  (search summaries)
- **Jurnal PASTI** (Mercu Buana, 2021): fishbone + FMEA on raw-material inventory differences, with visual control as one fix. — [PASTI](https://publikasi.mercubuana.ac.id/index.php/pasti/article/download/12929/4774) (search summary)
- **Jurnal Industri Inovatif ITN** (2025): 5 Whys + fishbone found five main factors behind label stock differences. — [ITN](https://ejournal.itn.ac.id/index.php/industri/article/download/12924/7179) (search summary)
- **PT Citra Plastik Makmur**: Six Sigma DMAIC to improve stock opname accuracy. — [JCSR, Politeknik Pratama](https://ejurnal.politeknikpratama.ac.id/index.php/jcsr/article/view/6384) (title only)

### Inferences
- The cause categories (unrecorded withdrawals, delayed posting, manual recording) map directly onto CKB's two-system problem. The WMS is posted in real time while the client's SAP is posted later or differently, so a "selisih" between the two is often a *timing* difference and not a physical one. This is inferred, not sourced for Indonesia.

### Gaps
- Few studies report an independently measured before/after result. Most stop at a proposal. Small samples (for example 20 SKUs) limit how far the results generalise.

## 4. Lubricant and oil distributors (Shell, Pertamina Lubricants, Castrol, Mobil)

### Takeaway
I found no public information on stock-control practice at Indonesian lubricant distributors or 3PLs.

### Cited Findings
- The only lubricant-related hit was an Undip thesis table: a stock opname difference on a lubricant item (Rored EPA SAE 90) in a *spare-part* warehouse, December 2024. This is only a loose analogy. — [Undip eprints (search summary)](https://eprints2.undip.ac.id/41959/3/BAB%201%20TA_MAL_BIMA%20PRIANGGADA.pdf)

### Gaps
- No public SOP, contract term or case study for Shell Indonesia, Pertamina Lubricants, Castrol or ExxonMobil distributor warehouses. CKB's own Shell contract or SOP is the only reliable source here.

## 5. Legal and tax angles: write-offs, liability, B3 waste

### Takeaway
There are three relevant legal layers.
- **Civil liability:** a 3PL is a bailee (`penerima titipan`, KUHPerdata Art. 1706–1714) and owes ordinary care, a stricter standard if the contract says so.
- **Tax:** destroying damaged stock is deductible only with strong evidence. That means an itemised `berita acara pemusnahan`, photo or video, and for material amounts a tax office AR as witness.
- **Environment:** damaged or expired lubricants and their spill residue are B3 waste under PP 22/2021 and Permen LHK 6/2021. They go to a licensed handler, and the generator stays responsible.

### Cited Findings
- KUHPerdata, as summarised by Hukumonline:
  - Art. 1706: the bailee must care for entrusted goods as for its own.
  - Art. 1707: a stricter duty applies where expressly agreed, for example liability for all negligence.
  - Art. 1708: no liability where the goods would have perished in the owner's hands anyway.
  - Art. 1714: return the goods in the condition they are in at return.
  - A negligence claim must be proven in court, usually under Art. 1365.

  — [Hukumonline klinik](https://www.hukumonline.com/klinik/a/wajibkah-penerima-titipan-mengganti-barang-yang-hilang-lt5419979b673ce/); [Hukumonline klinik 2](https://www.hukumonline.com/klinik/a/barang-yang-dititipkan-hilang-apakah-yang-dititipkan-wajib-mengganti-lt50443032330bd/) (search summaries; general bailment, not warehouse-specific)
- Tax, destruction of damaged inventory (`pemusnahan persediaan rusak`):
  - The purpose is to let the cost be deducted to reduce taxable income (PKP). — [pajak.go.id](https://pajak.go.id/en/node/71300)
  - Tax office account representatives (AR) witness destruction, match the goods list to the documents, and sign the `berita acara`. — [DDTC News](https://news.ddtc.co.id/berita/daerah/1803985/petugas-pajak-awasi-kegiatan-pemusnahan-barang-persediaan-milik-wp); [pajak.go.id](https://www.pajak.go.id/index.php/id/berita/pajak-dentim-saksikan-kegiatan-pemusnahan-barang)
  - A consultant blog says auditors challenge *evidence and the year of deduction*, not the value. The BA should list each item (code, qty, acquisition cost, value, reason) with photos or video. A BA signed only by internal staff is easy to reject. No regulation lists the required documents, so the standard comes from audit practice and Tax Court rulings. The blog cites UU PPh Art. 6(1)(a) and PP 44/2022 Art. 19(2) on input VAT for destroyed goods. Unverified, consultant source. — [Enforcea blog](https://enforcea.com/Blog/biaya-pemusnahan-persediaan-bisa-dikoreksi-total-jika-dokumen-ini-tidak-ada)
- Accounting: under PSAK 14, inventory lost or stolen is an expense in the period it occurs. Small normal differences may go to COGS (HPP); material or abnormal ones go to a separate "kerugian persediaan" line. — [Binus Accounting, "Kerugian persediaan dalam PSAK 14"](https://accounting.binus.ac.id/2026/05/31/kerugian-persediaan-dalam-psak-14/). MAS Cargo cites PSAK 202 (the renumbered inventory standard). — [MAS Cargo Express](https://www.mascargoexpress.com/stock-opname-partial-adalah/)
- B3 waste:
  - PP 22/2021 with Permen LHK 6/2021 governs B3 waste management. B3 waste includes expired material, spills, packaging residue, and off-spec or unusable product.
  - Disposal is by a licensed third party, but the generator keeps primary responsibility, including recording and reporting.

  — search summaries of [UISI repository](https://repository.uisi.ac.id/3683/11/10.%20BAB%20I%20PENDAHULUAN.pdf) and Indonesian journals. One popular source (detik) still cites the old PP 18/1999, which conflicts with the others: [detik](https://oto.detik.com/tips-and-tricks/d-6437089/kalau-ganti-oli-di-rumah-begini-buang-limbahnya/amp).

### Inferences
- For CKB: the stock belongs to Shell, so tax write-off and destruction evidence are Shell's concern. CKB should still produce the itemised, photographed, witnessed `berita acara` that Shell's tax position depends on. Damaged lubricant should never just "disappear" from the WMS. It should move to a quarantine or damaged location and leave through a documented disposal movement handled by a licensed B3 handler.
- Without a contract clause, the KUHPerdata bailment rules leave the burden of proving negligence on the owner. In practice a 3PL contract usually replaces this with a tolerance and a valuation rule, but I found no Indonesian sample of such a clause.

### Gaps
- I did not read the full regulation text of PP 22/2021, Permen LHK 6/2021, PP 44/2022 or PSAK 14/202. The claims above come from secondary summaries. Confirm them with a tax or legal adviser.
- I found no Indonesian regulation that specifically governs warehouse-operator liability (versus general bailment), and no sample `perjanjian jasa pergudangan` clause on `selisih`.
