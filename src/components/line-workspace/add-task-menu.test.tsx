import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { AddTaskMenu } from "./add-task-menu";
import { listAwiMasters, type AwiMaster } from "@/lib/awi/store";
vi.mock("@/lib/awi/store", () => ({listAwiMasters:vi.fn(), awiDraftStatus:()=>"Draft"}));
vi.mock("../ui/modal-surface",()=>({ModalSurface:({children}:{children:React.ReactNode})=><div>{children}</div>}));
const master = {id:"master",workspace_id:"workspace",project_id:"master-project",task_id:"master-task",document_number:"AWI-001",title:"Install Tires",category:"Trailer"} as AwiMaster;
beforeEach(()=>{vi.mocked(listAwiMasters).mockReset();});
it("keeps new tasks available without loading the master list",()=>{
  const onNewTask=vi.fn();
  render(<AddTaskMenu workspaceId="workspace" onNewTask={onNewTask} onLinkTask={vi.fn()}/>);
  fireEvent.click(screen.getByRole("button",{name:"Task"}));
  fireEvent.click(screen.getByRole("menuitem",{name:"New task"}));
  expect(onNewTask).toHaveBeenCalledOnce();
  expect(listAwiMasters).not.toHaveBeenCalled();
});
it("loads workspace AWIs only when requested and links the searched choice",async()=>{
  vi.mocked(listAwiMasters).mockResolvedValue([master]);
  const onLinkTask=vi.fn().mockResolvedValue(undefined);
  render(<AddTaskMenu workspaceId="workspace" onNewTask={vi.fn()} onLinkTask={onLinkTask}/>);
  fireEvent.click(screen.getByRole("button",{name:"Task"}));
  fireEvent.click(screen.getByRole("menuitem",{name:"Link AWI from master list"}));
  expect(listAwiMasters).toHaveBeenCalledWith("workspace");
  fireEvent.change(screen.getByRole("textbox",{name:"Search master AWIs"}),{target:{value:"tires"}});
  fireEvent.click(await screen.findByRole("button",{name:/AWI-001.*Install Tires/}));
  expect(onLinkTask).toHaveBeenCalledWith(master);
  await waitFor(()=>expect(screen.queryByRole("textbox",{name:"Search master AWIs"})).toBeNull());
});
it("keeps a failed link visible for retry",async()=>{
  vi.mocked(listAwiMasters).mockResolvedValue([master]);
  render(<AddTaskMenu workspaceId="workspace" onNewTask={vi.fn()} onLinkTask={vi.fn().mockRejectedValue(new Error("Access changed"))}/>);
  fireEvent.click(screen.getByRole("button",{name:"Task"}));
  fireEvent.click(screen.getByRole("menuitem",{name:"Link AWI from master list"}));
  fireEvent.click(await screen.findByRole("button",{name:/AWI-001.*Install Tires/}));
  expect(await screen.findByRole("alert")).toHaveTextContent("Access changed");
});
