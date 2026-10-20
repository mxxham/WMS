import { jsPDF } from 'jspdf';
import { renderBinToBinPdfPage } from './lib/allocator/adapters/pdf-output';
import { writeFileSync } from 'node:fs';
const rows = [
  { seq: 1, aisle: 'CE', from_bin: 'CE30A02', to_bin: 'CE22A02', sku: '550058592', description: 'Adv4TAX515W40SLMA2_12*1L_A04W', shipment_number: 'SH 109694859', batch_lot: '05H26JJ', expiry_date: '2026-08-05', quantity: 12, uom: 'Carton', wave_no: '6', planned_date: '2026-10-08' },
  { seq: 2, aisle: 'CE', from_bin: 'CD13A01', to_bin: 'CF11E01', sku: '550048593', description: 'Adv4TAX5Sc20W40MB_12*0.8L_A04W', shipment_number: 'SH 109694903', batch_lot: '21H26JJ', expiry_date: '2026-08-21', quantity: 29, uom: 'Carton', wave_no: '3', planned_date: '2026-10-08' },
];
const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
renderBinToBinPdfPage(doc, rows as any);
writeFileSync('/tmp/b2b3.pdf', Buffer.from(doc.output('arraybuffer')));
console.log('pages:', doc.getNumberOfPages());
