"use client";

import { t } from "@/lib/copy/fa";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// Theme tokens only, so charts follow the active [data-theme].
const PALETTE = ["var(--color-accent)", "var(--color-gold)", "var(--color-ink)", "var(--color-danger)", "var(--color-accent-strong)", "var(--color-muted)"];
const short = (day: string) => day.slice(5);

/** Daily views (bars) vs votes (bars) with vote-per-view rate (line, right axis). */
export function ViewsVotesChart({ data }: { data: Array<{ day: string; views: number; votes: number; rate: number }> }) {
  return (
    <div dir="ltr" className="h-64 w-full sm:h-72">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.12} />
          <XAxis dataKey="day" tickFormatter={short} fontSize={11} minTickGap={16} />
          <YAxis yAxisId="n" fontSize={11} allowDecimals={false} />
          <YAxis yAxisId="r" orientation="right" fontSize={11} unit="%" width={40} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="n" dataKey="views" name={t.stats.seriesViews} fill={PALETTE[0]} radius={[3, 3, 0, 0]} />
          <Bar yAxisId="n" dataKey="votes" name={t.stats.seriesVotes} fill={PALETTE[1]} radius={[3, 3, 0, 0]} />
          <Line yAxisId="r" type="monotone" dataKey="rate" name={t.stats.seriesRate} stroke={PALETTE[2]} dot={false} strokeWidth={2} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** One line per voter: names seen per day. */
export function PerUserChart({ data, users }: { data: Array<Record<string, string | number>>; users: string[] }) {
  return (
    <div dir="ltr" className="h-64 w-full sm:h-72">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.12} />
          <XAxis dataKey="day" tickFormatter={short} fontSize={11} minTickGap={16} />
          <YAxis fontSize={11} allowDecimals={false} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {users.map((u, i) => (
            <Line key={u} type="monotone" dataKey={u} stroke={PALETTE[i % PALETTE.length]} dot={false} strokeWidth={2} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function HourChart({ data }: { data: Array<{ hour: number; views: number }> }) {
  return (
    <div dir="ltr" className="h-48 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.12} />
          <XAxis dataKey="hour" fontSize={11} interval={2} />
          <YAxis fontSize={11} allowDecimals={false} />
          <Tooltip />
          <Bar dataKey="views" name={t.stats.seriesViews} fill={PALETTE[0]} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
