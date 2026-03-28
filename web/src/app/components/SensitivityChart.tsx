"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { C } from "./theme";

interface SensitivityData {
  param_name: string;
  base_value: number;
  low_delta: number;
  high_delta: number;
}

interface Props {
  data: SensitivityData[];
}

export default function SensitivityChart({ data }: Props) {
  if (!data || data.length === 0) return null;

  const chartData = data.map((d) => ({
    name: d.param_name,
    low: d.low_delta,
    high: d.high_delta,
    range: [d.low_delta, d.high_delta],
  }));

  return (
    <div style={{ marginTop: 24 }}>
      <h4
        style={{
          color: C.text,
          fontSize: 13,
          fontWeight: 600,
          marginBottom: 12,
          letterSpacing: "0.03em",
        }}
      >
        SENSITIVITY ANALYSIS (±20%)
      </h4>
      <ResponsiveContainer width="100%" height={Math.max(120, data.length * 60 + 40)}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 8, right: 40, left: 100, bottom: 8 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={C.border}
            horizontal={false}
          />
          <XAxis
            type="number"
            tick={{ fill: C.textSec, fontSize: 11 }}
            tickFormatter={(v: number) =>
              `${v >= 0 ? "+" : ""}$${Math.abs(v).toLocaleString()}`
            }
            axisLine={{ stroke: C.border }}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fill: C.textSec, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={90}
          />
          <Tooltip
            contentStyle={{
              background: C.panel,
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              color: C.text,
              fontSize: 12,
            }}
            formatter={(value, name) => {
              const v = Number(value ?? 0);
              return [
                `${v >= 0 ? "+" : ""}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                name === "low" ? "−20%" : "+20%",
              ];
            }}
          />
          <ReferenceLine x={0} stroke={C.muted} strokeDasharray="3 3" />
          <Bar dataKey="low" stackId="range" barSize={20}>
            {chartData.map((entry, i) => (
              <Cell
                key={`low-${i}`}
                fill={entry.low < 0 ? C.danger : C.accent}
                opacity={0.7}
              />
            ))}
          </Bar>
          <Bar dataKey="high" stackId="range" barSize={20}>
            {chartData.map((entry, i) => (
              <Cell
                key={`high-${i}`}
                fill={entry.high < 0 ? C.danger : C.accent}
                opacity={0.7}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>
        Shows how total portfolio lift changes when each assumption varies ±20% from base.
      </p>
    </div>
  );
}
