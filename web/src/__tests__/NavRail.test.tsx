import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import NavRail from "@/app/components/NavRail";

describe("NavRail", () => {
  it("renders all navigation items", () => {
    const { container } = render(<NavRail view="terminal" setView={() => {}} />);
    expect(container.textContent).toContain("⌂");
    expect(container.textContent).toContain("◇");
    expect(container.textContent).toContain("📁");
  });

  it("calls setView when a nav item is clicked", () => {
    const setView = vi.fn();
    const { container } = render(<NavRail view="terminal" setView={setView} />);
    const navItems = container.querySelectorAll<HTMLDivElement>("[style*='cursor: pointer']");
    // Click the workflow (◇) item — second nav item
    const workflowItem = Array.from(navItems).find((el) => el.textContent?.includes("◇"));
    fireEvent.click(workflowItem!);
    expect(setView).toHaveBeenCalledWith("workflow");
  });

  it("shows hover label on mouse enter", () => {
    const { container } = render(<NavRail view="terminal" setView={() => {}} />);
    const navItems = container.querySelectorAll<HTMLDivElement>("[style*='cursor: pointer']");
    const workflowItem = Array.from(navItems).find((el) => el.textContent?.includes("◇"));
    fireEvent.mouseEnter(workflowItem!);
    expect(container.textContent).toContain("Workflow");
  });

  it("renders the logo", () => {
    const { container } = render(<NavRail view="terminal" setView={() => {}} />);
    const imgs = container.querySelectorAll("img[alt='LX']");
    expect(imgs.length).toBeGreaterThan(0);
  });
});
