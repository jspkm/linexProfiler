import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import Dropdown from "@/app/components/Dropdown";

const options = [
  { value: "a", label: "Alpha", description: "First option" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Charlie", description: "Third option" },
];

describe("Dropdown", () => {
  it("renders the selected option label", () => {
    const { container } = render(
      <Dropdown value="a" options={options} onChange={() => {}} />
    );
    expect(within(container).getByText("Alpha")).toBeInTheDocument();
  });

  it("shows fallback when value is empty", () => {
    const { container } = render(
      <Dropdown value="" options={options} onChange={() => {}} />
    );
    expect(within(container).getByText("—")).toBeInTheDocument();
  });

  it("opens dropdown on click and shows all options", () => {
    const { container } = render(
      <Dropdown value="a" options={options} onChange={() => {}} />
    );
    const trigger = container.querySelector("button")!;
    fireEvent.click(trigger);
    expect(within(container).getByText("Beta")).toBeInTheDocument();
    expect(within(container).getByText("Charlie")).toBeInTheDocument();
  });

  it("calls onChange when an option is selected", () => {
    const onChange = vi.fn();
    const { container } = render(
      <Dropdown value="a" options={options} onChange={onChange} />
    );
    fireEvent.click(container.querySelector("button")!);
    fireEvent.click(within(container).getByText("Beta"));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("closes dropdown after selection", () => {
    const onChange = vi.fn();
    const { container } = render(
      <Dropdown value="a" options={options} onChange={onChange} />
    );
    fireEvent.click(container.querySelector("button")!);
    fireEvent.click(within(container).getByText("Beta"));
    expect(within(container).queryByText("Charlie")).not.toBeInTheDocument();
  });

  it("renders option descriptions when provided", () => {
    const { container } = render(
      <Dropdown value="a" options={options} onChange={() => {}} />
    );
    fireEvent.click(container.querySelector("button")!);
    expect(within(container).getByText("First option")).toBeInTheDocument();
    expect(within(container).getByText("Third option")).toBeInTheDocument();
  });

  it("closes on outside click", () => {
    const { container } = render(
      <div>
        <span data-testid="outside">outside</span>
        <Dropdown value="a" options={options} onChange={() => {}} />
      </div>
    );
    const trigger = container.querySelector("button")!;
    fireEvent.click(trigger);
    expect(within(container).getAllByText("Beta").length).toBeGreaterThan(0);
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(within(container).queryByText("Beta")).not.toBeInTheDocument();
  });
});
