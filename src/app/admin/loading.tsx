import { PageSkeleton } from "@/components/skeleton";

/** Shown under the admin menu the moment a menu link is clicked, while the next admin page renders. */
export default function Loading() {
  return <PageSkeleton />;
}
