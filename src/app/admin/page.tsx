import { notFound } from "next/navigation";
import { adminEnabled } from "@/lib/admin-auth";
import AdminShell from "./AdminShell";

export default function AdminPage() {
  // Hide the portal entirely when the password isn't set.
  if (!adminEnabled()) {
    notFound();
  }
  return <AdminShell />;
}
