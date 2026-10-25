"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider, removeOldestQuery } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { fetchDatasetVersion } from "@/lib/query/fetchers";
import { qk, TWELVE_HOURS } from "@/lib/query/keys";

const STORAGE_KEY = "dv-query-cache";

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: TWELVE_HOURS,
        gcTime: TWELVE_HOURS,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: 1,
      },
    },
  });
}

/** Re-checks the dataset version (cheap, no-store) on focus and every 5 min; a change purges every cached query. */
function VersionWatcher({ version }: { version: string }) {
  const client = useQueryClient();
  const { data } = useQuery({
    queryKey: qk.datasetVersion(),
    queryFn: fetchDatasetVersion,
    initialData: version,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
  const seen = useRef(version);
  useEffect(() => {
    // The server-rendered layout always carries the latest version; a poll result can be newer still.
    const next = data && data !== seen.current ? data : version !== seen.current ? version : null;
    if (!next) return;
    const previous = seen.current;
    seen.current = next;
    client.removeQueries({ predicate: (q) => q.queryKey[0] !== "meta" });
    client.setQueryData(qk.datasetVersion(), next);
    if (process.env.NODE_ENV !== "production") console.info("[dv-cache] dataset version", previous, "→", next, "purged");
  }, [data, version, client]);
  return null;
}

export function QueryProvider({ datasetVersion, children }: { datasetVersion: string; children: ReactNode }) {
  const [client] = useState(makeClient);
  const [persister] = useState(() =>
    createSyncStoragePersister({
      storage: typeof window === "undefined" ? undefined : window.localStorage,
      key: STORAGE_KEY,
      throttleTime: 1000,
      // localStorage is ~5 MB: drop the oldest cached pages instead of failing when it fills up.
      retry: removeOldestQuery,
    }),
  );

  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{
        persister,
        maxAge: TWELVE_HOURS,
        // A different buster discards the whole persisted cache on load: this is the clean purge on dataset change.
        buster: `${datasetVersion}:cards-v2`,
        dehydrateOptions: {
          // Only dataset data is persisted; user votes always come from the server.
          shouldDehydrateQuery: (q) => q.state.status === "success" && q.queryKey[0] === "dataset",
        },
      }}
    >
      <VersionWatcher version={datasetVersion} />
      {children}
    </PersistQueryClientProvider>
  );
}
