import { describe, it, expect, vi } from "vitest";
import { render, within, fireEvent } from "@testing-library/react";
import WorkflowCanvas from "@/app/components/WorkflowCanvas";

describe("WorkflowCanvas", () => {
  it("renders the built-in template", () => {
    const { container } = render(
      <WorkflowCanvas onTemplate={() => {}} workflows={[]} />
    );
    expect(
      within(container).getByText("Optimize portfolio")
    ).toBeInTheDocument();
  });

  it("renders user workflows", () => {
    const workflows = [
      {
        workflow_id: "wf1",
        name: "My Workflow",
        description: "Test description",
        detail: "detail",
      },
    ];
    const { container } = render(
      <WorkflowCanvas onTemplate={() => {}} workflows={workflows} />
    );
    expect(within(container).getByText("My Workflow")).toBeInTheDocument();
    expect(within(container).getByText("Test description")).toBeInTheDocument();
  });

  it("calls onTemplate when built-in is clicked", () => {
    const onTemplate = vi.fn();
    const { container } = render(
      <WorkflowCanvas onTemplate={onTemplate} workflows={[]} />
    );
    const card = within(container).getByText("Optimize portfolio").closest("div[style]")!;
    fireEvent.click(card);
    expect(onTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "t0", text: "Optimize portfolio" })
    );
  });

  it("calls onTemplate when user workflow is clicked", () => {
    const onTemplate = vi.fn();
    const workflows = [
      {
        workflow_id: "wf1",
        name: "Custom",
        description: "desc",
        detail: "detail",
      },
    ];
    const { container } = render(
      <WorkflowCanvas onTemplate={onTemplate} workflows={workflows} />
    );
    const card = within(container).getByText("Custom").closest("div[style]")!;
    fireEvent.click(card);
    expect(onTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "wf1", text: "Custom" })
    );
  });
});
