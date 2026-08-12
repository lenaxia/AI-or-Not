import { notFound } from "next/navigation";
import { adminEnabled } from "@/lib/admin-auth";
import AdminShell from "./AdminShell";

// Force dynamic rendering. `adminEnabled()` reads process.env at request
// time, so the page must NOT be statically prerendered at build time
// (which would bake in the build-time env value and ship a 404 in
// production even when ROA_ADMIN_PASSWORD is set at runtime).
export const dynamic = "force-dynamic";

export default function AdminPage() {
  // Hide the portal entirely when the password isn't set.
  if (!adminEnabled()) {
    notFound();
  }
  return <AdminShell />;
}
