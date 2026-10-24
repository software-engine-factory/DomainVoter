"use client";

import { useEffect } from "react";
import { recordViews } from "@/lib/actions/votes";

export function RecordViews({ roundId, domainIds }: { roundId: number; domainIds: number[] }) {
  const key = domainIds.join(",");

  useEffect(() => {
    if (!key) return;
    const ids = key.split(",").map((id) => Number(id));
    void recordViews(roundId, ids);
  }, [key, roundId]);

  return null;
}
