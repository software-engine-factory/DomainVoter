import { ResponsiveTables } from "@/components/responsive-tables";
import { requireAdmin } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <>
      <ResponsiveTables />
      {children}
    </>
  );
}
