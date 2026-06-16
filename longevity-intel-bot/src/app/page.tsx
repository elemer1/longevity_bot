import { Dashboard } from "@/components/Dashboard";
import { getDashboardData } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Home() {
  const data = await getDashboardData();
  return <Dashboard initialData={data} />;
}
