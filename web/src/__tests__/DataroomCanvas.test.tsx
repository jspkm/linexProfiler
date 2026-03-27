import { describe, it, expect } from "vitest";
import { render, fireEvent, within } from "@testing-library/react";
import DataroomCanvas from "@/app/components/DataroomCanvas";

const mockDatasets = [
  {
    dataset_id: "ds1",
    upload_name: "Portfolio A",
    row_count: 1500,
    parsed_user_count: 300,
    created_at: "2025-01-15T00:00:00Z",
  },
  {
    dataset_id: "ds2",
    upload_name: "Portfolio B",
    row_count: 2000,
    parsed_user_count: 400,
    created_at: "2025-02-20T00:00:00Z",
  },
];

describe("DataroomCanvas", () => {
  it("renders the header and upload button", () => {
    const { container } = render(<DataroomCanvas datasets={[]} />);
    expect(within(container).getByText("Dataroom")).toBeInTheDocument();
    expect(container.querySelector("button")).toBeInTheDocument();
  });

  it("renders column headers", () => {
    const { container } = render(<DataroomCanvas datasets={[]} />);
    const headers = container.querySelectorAll("th");
    const headerTexts = Array.from(headers).map((h) => h.textContent);
    expect(headerTexts).toContain("Name");
    expect(headerTexts).toContain("Rows");
    expect(headerTexts).toContain("User Count");
    expect(headerTexts).toContain("Uploaded On");
  });

  it("shows dataset count in Sample Portfolio folder", () => {
    const { container } = render(<DataroomCanvas datasets={mockDatasets} />);
    expect(within(container).getByText("(2)")).toBeInTheDocument();
  });

  it("expands Sample Portfolio folder on click to show datasets", () => {
    const { container } = render(<DataroomCanvas datasets={mockDatasets} />);
    const sampleFolder = within(container).getAllByText("Sample Portfolio")[0];
    fireEvent.click(sampleFolder.closest("tr")!);
    expect(within(container).getByText("Portfolio A")).toBeInTheDocument();
    expect(within(container).getByText("Portfolio B")).toBeInTheDocument();
  });

  it("shows empty state when no datasets", () => {
    const { container } = render(<DataroomCanvas datasets={[]} />);
    expect(
      within(container).getAllByText("No portfolios uploaded yet.").length
    ).toBeGreaterThan(0);
  });

  it("toggles upload drop zone", () => {
    const { container } = render(<DataroomCanvas datasets={[]} />);
    fireEvent.click(container.querySelector("button")!);
    expect(
      within(container).getByText("Drop files here to upload")
    ).toBeInTheDocument();
  });
});
