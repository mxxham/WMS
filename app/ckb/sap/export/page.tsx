import { CKB_MODULES } from "../../modules";
import { ModuleStub } from "../../module-stub";

/** /ckb/sap/export — placeholder module page (see module-stub). */
export default function Page() {
  return <ModuleStub module={CKB_MODULES.find((m) => m.href === "/ckb/sap/export")!} />;
}