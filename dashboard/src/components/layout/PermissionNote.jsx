import useAuth from "../../context/useAuth";
import { missingPermissionHint } from "../../utils/permissions";

// Explains why a page's editing controls are hidden for this role. Nothing is
// shown until the role's permissions have loaded, so it never flashes.
export default function PermissionNote({ permissions, children = "View only." }) {
  const { permissionsReady } = useAuth();
  if (!permissionsReady) return null;
  return <p className="crm-permission-note" role="note">{children} {missingPermissionHint(permissions)}</p>;
}
