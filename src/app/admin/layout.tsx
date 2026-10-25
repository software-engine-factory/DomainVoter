import { AdminNav } from "@/components/admin/admin-nav";
import { ResponsiveTables } from "@/components/responsive-tables";
import { requireAdmin } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin();
  return (
    <>
      <AdminNav user={session.username} />
      <ResponsiveTables />
      {children}
    </>
  );
}
