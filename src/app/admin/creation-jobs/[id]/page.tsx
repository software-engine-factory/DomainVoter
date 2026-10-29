import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { creationSnapshot, getCreationJob } from "@/lib/creation-jobs";
import { JobMonitor } from "./job-monitor";

export default async function CreationJobPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin();
  const { id } = await params;
  const row = getCreationJob(id, session.userId);
  if (!row) notFound();
  return <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6"><JobMonitor initial={creationSnapshot(row)} /></main>;
}
