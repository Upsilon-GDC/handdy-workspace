import { Lock } from "lucide-react";
import { permissionNames } from "../../utils/permissions";

// Shown instead of a page whose data the signed-in role is not allowed to
// load, so the person sees why rather than an API error.
export default function AccessDenied({ permissions = [], failed = false }) {
  return (
    <section className="card crm-access-denied" role="alert">
      <Lock size={22} aria-hidden="true" />
      {failed ? <>
        <h2>We couldn’t check your access</h2>
        <p>Check your connection, then refresh the page.</p>
      </> : <>
        <h2>This page isn’t available to you</h2>
        <p>It needs the {permissionNames(permissions)} permission{permissions.length === 1 ? "" : "s"}. Ask an administrator or manager to turn {permissions.length === 1 ? "it" : "them"} on under Permissions.</p>
      </>}
    </section>
  );
}
