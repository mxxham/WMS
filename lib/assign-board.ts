/** Penugasan (/assign): shipment status and the confirmation sentences. */
export type AssignStatus = "Belum" | "Dipicking" | "Selesai" | "Dimuat";

/** One row of assignment_board(p_date) (0110): one wave = one shipment. */
export type BoardRow = {
  wave_id: string; wave_no: string; shipment_number: string; planned_slot: string | null; truck: string | null;
  fl_lines: number; hp_lines: number; status: AssignStatus; user_id: string | null; user_name: string | null;
};

/** One row of assignable_operators() (0110). */
export type OperatorRow = { id: string; name: string; username: string; open_count: number };

export const assignConfirm = (shipment: string, name: string) => `Tugaskan shipment ${shipment} ke ${name}?`;
export const unassignConfirm = (shipment: string, name: string) => `Lepas shipment ${shipment} dari ${name}?`;

/** A finished or loaded shipment cannot be (re)assigned (the database refuses it too). */
export const canAssign = (status: AssignStatus) => status !== "Selesai" && status !== "Dimuat";
