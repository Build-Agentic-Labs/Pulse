// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProblemPilotAccessProvider, ProblemPilotLink } from "./problem-pilot-link";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), auth: null as null | ((event: string, session: { user: { id: string } } | null) => void) }));
vi.mock("@/domain/supabase-planner", () => ({ createPlannerSupabaseClient: () => ({ rpc: mock.rpc, auth: { onAuthStateChange: (callback: typeof mock.auth) => { mock.auth = callback; return { data: { subscription: { unsubscribe() {} } } }; } } }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("renders server-verified access immediately without a second hydration lookup", () => {
  render(<ProblemPilotAccessProvider initialUserId="user" initialAllowed><ProblemPilotLink /></ProblemPilotAccessProvider>);
  expect(screen.getByRole("link", { name: "Problem Solving" })).toBeInTheDocument();
  act(() => mock.auth?.("INITIAL_SESSION", { user: { id: "user" } }));
  expect(screen.getByRole("link", { name: "Problem Solving" })).toBeInTheDocument();
  expect(mock.rpc).not.toHaveBeenCalled();
  act(() => mock.auth?.("SIGNED_OUT", null));
  expect(screen.queryByRole("link", { name: "Problem Solving" })).not.toBeInTheDocument();
});
it("keeps access when the sidebar remounts and the same user's token refreshes", async () => {
  mock.rpc.mockResolvedValue({ data: true, error: null });
  const view = render(<ProblemPilotAccessProvider><ProblemPilotLink key="a" /></ProblemPilotAccessProvider>);
  act(() => mock.auth?.("INITIAL_SESSION", { user: { id: "user" } }));
  await screen.findByRole("link", { name: "Problem Solving" });
  view.rerender(<ProblemPilotAccessProvider><ProblemPilotLink key="b" /></ProblemPilotAccessProvider>);
  act(() => mock.auth?.("TOKEN_REFRESHED", { user: { id: "user" } }));
  expect(screen.getByRole("link", { name: "Problem Solving" })).toBeInTheDocument();
  expect(mock.rpc).toHaveBeenCalledOnce();
});
it("clears access on sign out and ignores the old user's pending response", async () => {
  let resolve!: (value: { data: boolean; error: null }) => void;
  mock.rpc.mockReturnValue(new Promise(done => { resolve = done; }));
  render(<ProblemPilotAccessProvider><ProblemPilotLink /></ProblemPilotAccessProvider>);
  act(() => mock.auth?.("INITIAL_SESSION", { user: { id: "user" } }));
  await waitFor(() => expect(mock.rpc).toHaveBeenCalledOnce());
  act(() => mock.auth?.("SIGNED_OUT", null));
  await act(async () => resolve({ data: true, error: null }));
  expect(screen.queryByRole("link", { name: "Problem Solving" })).not.toBeInTheDocument();
});
