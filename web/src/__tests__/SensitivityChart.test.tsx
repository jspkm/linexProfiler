import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import SensitivityChart from "@/app/components/SensitivityChart";

describe("SensitivityChart", () => {
  const mockData = [
    { param_name: "Uptake rate", base_value: 100000, low_delta: -20000, high_delta: 15000 },
    { param_name: "Incentive cost", base_value: 100000, low_delta: -10000, high_delta: 12000 },
  ];

  it("renders the chart with data", () => {
    const { container } = render(<SensitivityChart data={mockData} />);
    expect(container.textContent).toContain("SENSITIVITY ANALYSIS");
    // Recharts doesn't render axis labels in jsdom, so check the container exists
    expect(container.querySelector("div")).not.toBeNull();
  });

  it("returns null when data is empty", () => {
    const { container } = render(<SensitivityChart data={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("returns null when data is undefined", () => {
    const { container } = render(<SensitivityChart data={undefined as unknown as []} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders the explanation text", () => {
    const { container } = render(<SensitivityChart data={mockData} />);
    expect(container.textContent).toContain("total portfolio lift");
  });

  it("handles single parameter", () => {
    const single = [{ param_name: "Cost", base_value: 50000, low_delta: -5000, high_delta: 7000 }];
    const { container } = render(<SensitivityChart data={single} />);
    expect(container.querySelector("div")).not.toBeNull();
    expect(container.textContent).toContain("SENSITIVITY ANALYSIS");
  });
});
