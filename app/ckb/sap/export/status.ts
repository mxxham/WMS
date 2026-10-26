/** Labels for ckb_sap_exports.status. */
export const EXPORT_STATUS = {
  GENERATED: { label: "Dibuat, belum dikonfirmasi SAP", tone: "warn" },
  SAP_CONFIRMED: { label: "Dikonfirmasi SAP", tone: "ok" },
  VOIDED: { label: "Dibatalkan", tone: "muted" },
} as const;
