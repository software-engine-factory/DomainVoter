import { requireVoter } from "@/lib/auth";

export default async function VoteLayout({ children }: { children: React.ReactNode }) {
  await requireVoter();
  return children;
}
