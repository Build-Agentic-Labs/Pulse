"use client";



import { FolderKanban, Moon, Palette, Settings, Sun } from "lucide-react";

import { useState, type ReactNode } from "react";

import { useTheme } from "@/components/theme-provider";

import { displayWorkspaceName, projectContextLabel } from "@/lib/display-names";

import { AccountSettings } from "@/components/account-settings";

import { PhonePhotoPortalPanel } from "@/components/phone-photo-portal-panel";

import { WorkspaceMembersSettings } from "@/components/workspace-members-settings";

import { WorkspaceListSettings } from "@/components/workspace-list-settings";

import type { PlannerProjectContext } from "@/domain/types";



const settingsSections = [

  { id: "general", label: "General", icon: Settings },

  { id: "appearance", label: "Appearance", icon: Palette },

  { id: "workspace", label: "Organization", icon: FolderKanban },

] as const;



type SettingsSection = (typeof settingsSections)[number]["id"];



export { settingsSections };

export type { SettingsSection };



function SettingsPage({ title, description, children }: { title: string; description: string; children: ReactNode }) {

  return (

    <div className="ui-settings-page">

      <h2 className="ui-settings-page-title">{title}</h2>

      <p className="ui-settings-page-desc">{description}</p>

      {children}

    </div>

  );

}



export function SettingsSectionBlock({

  title,

  description,

  children,

}: {

  title: string;

  description?: string;

  children: ReactNode;

}) {

  return (

    <section className="ui-settings-section">

      <h3 className="ui-settings-section-title">{title}</h3>

      {description ? <p className="ui-settings-section-desc">{description}</p> : null}

      <div className="ui-settings-group">{children}</div>

    </section>

  );

}



export function SettingsRow({

  label,

  description,

  children,

}: {

  label: string;

  description?: string;

  children: ReactNode;

}) {

  return (

    <div className="ui-settings-group-row">

      <div className="ui-settings-group-row-copy">

        <div className="ui-settings-group-row-label">{label}</div>

        {description ? <div className="ui-settings-group-row-desc">{description}</div> : null}

      </div>

      <div className="ui-settings-group-row-control">{children}</div>

    </div>

  );

}



export function AppSettingsPanel({

  project,

  section,

  onSectionChange,

  showSubnav = true,

}: {

  project?: PlannerProjectContext;

  section?: SettingsSection;

  onSectionChange?: (section: SettingsSection) => void;

  showSubnav?: boolean;

}) {

  const { theme, setTheme } = useTheme();

  const [internalSection, setInternalSection] = useState<SettingsSection>("general");

  const activeSection = section ?? internalSection;



  function setSection(nextSection: SettingsSection) {

    if (section === undefined) {

      setInternalSection(nextSection);

    }

    onSectionChange?.(nextSection);

  }



  return (

    <div className="flex h-full min-h-0 overflow-hidden bg-surface">

      {showSubnav ? (

        <aside className="ui-settings-subnav">

          <div className="ui-nav-section px-4">Settings</div>

          <nav className="mt-1 space-y-0.5">

            {settingsSections.map((item) => {

              const Icon = item.icon;

              const active = activeSection === item.id;

              return (

                <button

                  key={item.id}

                  type="button"

                  onClick={() => setSection(item.id)}

                  className={`ui-settings-subnav-item ${active ? "ui-settings-subnav-item-active" : "ui-settings-subnav-item-idle"}`}

                >

                  <Icon size={14} strokeWidth={1.75} />

                  {item.label}

                </button>

              );

            })}

          </nav>

        </aside>

      ) : null}



      <div className="ui-settings-content">

        {activeSection === "general" ? (

          <SettingsPage title="General" description="Account, organization access, and mobile photo capture.">

            <AccountSettings />

            <SettingsSectionBlock title="Organization access">

              <SettingsRow label="Project">

                <span className="ui-settings-group-row-value">{project?.projectName ?? "None selected"}</span>

              </SettingsRow>

              <SettingsRow label="Organization">

                <span className="ui-settings-group-row-value">

                  {project ? displayWorkspaceName(project.workspaceName) : "—"}

                </span>

              </SettingsRow>

              <SettingsRow label="Role">

                <span className="ui-settings-group-row-value capitalize">{project?.role ?? "—"}</span>

              </SettingsRow>

            </SettingsSectionBlock>



            <PhonePhotoPortalPanel project={project} />

          </SettingsPage>

        ) : null}



        {activeSection === "appearance" ? (

          <SettingsPage title="Appearance" description="Theme preference for the Pulse interface.">

            <SettingsSectionBlock title="Theme" description="Choose light or dark mode for the Pulse interface.">

              <div className="p-3.5">

                <div className="ui-settings-choice-grid">

                  <button

                    type="button"

                    onClick={() => setTheme("light")}

                    className={`ui-settings-choice ${theme === "light" ? "ui-settings-choice-active" : ""}`}

                  >

                    <div className="flex items-center gap-2">

                      <Sun size={14} strokeWidth={1.75} className="text-ink-secondary" />

                      <div className="ui-settings-choice-title">Light</div>

                    </div>

                    <div className="ui-settings-choice-desc">Bright canvas with crisp contrast.</div>

                  </button>

                  <button

                    type="button"

                    onClick={() => setTheme("dark")}

                    className={`ui-settings-choice ${theme === "dark" ? "ui-settings-choice-active" : ""}`}

                  >

                    <div className="flex items-center gap-2">

                      <Moon size={14} strokeWidth={1.75} className="text-ink-secondary" />

                      <div className="ui-settings-choice-title">Dark</div>

                    </div>

                    <div className="ui-settings-choice-desc">Monochrome Nothing-inspired palette.</div>

                  </button>

                </div>

              </div>

            </SettingsSectionBlock>

          </SettingsPage>

        ) : null}



        {activeSection === "workspace" ? (

          <SettingsPage title="Organization" description="Rename the organization, manage members, and control who can access each project.">

            <SettingsSectionBlock title="Current organization">

              <SettingsRow label="Active project">

                <span className="ui-settings-group-row-value">

                  {project ? projectContextLabel(project.projectName, project.workspaceName) : "No workspace selected"}

                </span>

              </SettingsRow>

            </SettingsSectionBlock>

            <WorkspaceListSettings />

            <WorkspaceMembersSettings project={project} />

          </SettingsPage>

        ) : null}

      </div>

    </div>

  );

}


