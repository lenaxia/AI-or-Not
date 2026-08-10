"use client";

import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Bucket } from "@/lib/types";

export default function Distribution({
  buckets,
  yourScore,
}: {
  buckets: Bucket[];
  yourScore: number;
}) {
  const yourBucket = Math.min(9, Math.floor(yourScore / 10));
  const data = buckets.map((b, i) => ({
    name: `${b.lo}`,
    count: b.count,
    mine: i === yourBucket,
  }));

  return (
    <div className="h-40 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
          <XAxis
            dataKey="name"
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            interval={0}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={28}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.4 }}
            formatter={(value) => [`${value} players`, ""] as [string, string]}
            labelFormatter={(label) => `${label}% score bucket`}
          />
          <Bar dataKey="count" radius={[3, 3, 0, 0]}>
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={entry.mine ? "var(--primary)" : "var(--muted-foreground)"}
                opacity={entry.mine ? 1 : 0.5}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
