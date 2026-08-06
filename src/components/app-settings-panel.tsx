"use client";

import "./app-settings-panel.css";

import { Check, Moon, Sun } from "lucide-react";
import dynamic from "next/dynamic";

import { useEffect, useState, type ReactNode } from "react";

import { useTheme, type AppearanceColorKey, type AppearancePalette } from "@/components/theme-provider";

import { projectContextLabel } from "@/lib/display-names";

import { AccountSettings } from "@/components/account-settings";

import { SettingsSectionLoadingContent } from "@/components/space-loading-states";

import {
  SettingsNavigation,
  settingsSections,
  type SettingsSection,
} from "@/components/settings-navigation";

import type { PlannerProjectContext, WorkspaceProjectGroup } from "@/domain/types";

import type { ThemeMode } from "@/lib/theme-init";

const OrganizationSettings = dynamic(
  () => import("@/components/organization-settings").then((module) => module.OrganizationSettings),
  { loading: () => <SettingsSectionLoadingContent /> },
);

const ProjectSettings = dynamic(
  () => import("@/components/project-settings").then((module) => module.ProjectSettings),
  { loading: () => <SettingsSectionLoadingContent /> },
);

const PlanningSettings = dynamic(
  () => import("@/components/planning/planning-settings").then((module) => module.PlanningSettings),
  { loading: () => <SettingsSectionLoadingContent /> },
);



const appearanceColorKeys: AppearanceColorKey[] = ["canvas", "surface", "raised", "accent"];

type AppearanceThemePreset = {
  id: string;
  name: string;
  tone: string;
  palette: AppearancePalette;
};

const lightThemePresets: AppearanceThemePreset[] = [
  {
    id: "studio",
    name: "Studio",
    tone: "Crisp neutral",
    palette: {
      canvas: "#f0f0ee",
      surface: "#ffffff",
      raised: "#f3f3f1",
      accent: "#1f2428",
    },
  },
  {
    id: "paper",
    name: "Paper",
    tone: "Warm editorial",
    palette: {
      canvas: "#efe9df",
      surface: "#fbf8f2",
      raised: "#f3ede4",
      accent: "#a24f32",
    },
  },
  {
    id: "cloud",
    name: "Cloud",
    tone: "Cool and quiet",
    palette: {
      canvas: "#e8edf1",
      surface: "#fcfdfe",
      raised: "#f0f4f6",
      accent: "#315f7a",
    },
  },
  {
    id: "sage",
    name: "Sage",
    tone: "Soft natural",
    palette: {
      canvas: "#e9eee9",
      surface: "#fbfcfa",
      raised: "#f0f3ef",
      accent: "#41634f",
    },
  },
];

const darkThemePresets: AppearanceThemePreset[] = [
  {
    id: "oled",
    name: "OLED",
    tone: "True black",
    palette: {
      canvas: "#000000",
      surface: "#0a0a0a",
      raised: "#171717",
      accent: "#ffffff",
    },
  },
  {
    id: "graphite",
    name: "Graphite",
    tone: "Soft charcoal",
    palette: {
      canvas: "#111214",
      surface: "#181a1d",
      raised: "#23262a",
      accent: "#e3e6e8",
    },
  },
  {
    id: "midnight",
    name: "Midnight",
    tone: "Cool black",
    palette: {
      canvas: "#080b0f",
      surface: "#10151c",
      raised: "#18212c",
      accent: "#8ab4f8",
    },
  },
  {
    id: "moss",
    name: "Moss",
    tone: "Natural black",
    palette: {
      canvas: "#0b0f0c",
      surface: "#121814",
      raised: "#1b241e",
      accent: "#8fbe82",
    },
  },
];

function AppearancePresetGrid({
  targetTheme,
  currentTheme,
  currentPalette,
  presets,
  onSelect,
}: {
  targetTheme: ThemeMode;
  currentTheme: ThemeMode;
  currentPalette: AppearancePalette;
  presets: AppearanceThemePreset[];
  onSelect: (theme: ThemeMode, palette: AppearancePalette) => void;
}) {
  return (
    <div className="ui-appearance-preset-grid py-3">
      {presets.map((preset) => {
        const active = currentTheme === targetTheme && appearanceColorKeys.every(
          (color) => currentPalette[color] === preset.palette[color],
        );

        return (
          <button
            key={preset.id}
            type="button"
            className={`ui-appearance-preset ${active ? "ui-appearance-preset-active" : ""}`}
            onClick={() => onSelect(targetTheme, preset.palette)}
            aria-pressed={active}
          >
            <span className="flex min-w-0 items-start justify-between gap-3">
              <span className="min-w-0 text-left">
                <span className="ui-appearance-preset-name block">{preset.name}</span>
                <span className="ui-appearance-preset-tone block">{preset.tone}</span>
              </span>
              {active ? <Check size={14} strokeWidth={2} aria-hidden="true" /> : null}
            </span>
            <span className="ui-appearance-preset-swatches" aria-hidden="true">
              {appearanceColorKeys.map((color) => (
                <span key={color} style={{ backgroundColor: preset.palette[color] }} />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}



export { embeddedSettingsSections, settingsSections } from "@/components/settings-navigation";
export type { SettingsSection } from "@/components/settings-navigation";



function SettingsPage({
  title,
  description,
  wide = false,
  children,
}: {
  title: string;
  description: string;
  wide?: boolean;
  children: ReactNode;
}) {

  return (

    <div className={`ui-settings-page ${wide ? "ui-settings-page-wide" : ""}`}>

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

  groups = [],

  sections = settingsSections,

}: {

  project?: PlannerProjectContext;

  section?: SettingsSection;

  onSectionChange?: (section: SettingsSection) => void;

  showSubnav?: boolean;

  groups?: WorkspaceProjectGroup[];

  sections?: readonly (typeof settingsSections)[number][];

}) {

  const {
    theme,
    appearance,
    setTheme,
    setSurfaceMode,
    applyThemePreset,
  } = useTheme();

  const [internalSection, setInternalSection] = useState<SettingsSection>("account");

  const activeSection = section ?? internalSection;
  const [mountedSections, setMountedSections] = useState<Set<SettingsSection>>(
    () => new Set([activeSection]),
  );

  useEffect(() => {
    setMountedSections((current) => {
      if (current.has(activeSection)) return current;
      return new Set(current).add(activeSection);
    });
  }, [activeSection]);

  function setSection(nextSection: SettingsSection) {

    setMountedSections((current) => current.has(nextSection) ? current : new Set(current).add(nextSection));

    if (section === undefined) {

      setInternalSection(nextSection);

    }

    onSectionChange?.(nextSection);

  }



  return (

    <div className="ui-settings-layout flex h-full min-h-0 flex-col overflow-hidden bg-surface md:flex-row">

      {showSubnav ? (
        <SettingsNavigation activeSection={activeSection} sections={sections} onSelect={setSection} />
      ) : null}



      <div className="ui-settings-content">

        {mountedSections.has("account") ? (

          <div hidden={activeSection !== "account"} aria-hidden={activeSection !== "account"}>

          <SettingsPage title="Account" description="Your profile and sign-in credentials.">

            <AccountSettings embedded />

          </SettingsPage>

          </div>

        ) : null}



        {mountedSections.has("appearance") ? (

          <div hidden={activeSection !== "appearance"} aria-hidden={activeSection !== "appearance"}>

          <SettingsPage title="Appearance" description="Theme, surface layout, and interface colors.">

            <SettingsSectionBlock title="Theme" description="Choose light or dark mode for the Pulse interface.">

              <div className="py-3">

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

            {theme === "light" ? (

              <SettingsSectionBlock title="Light themes" description="Choose a complete light palette.">

                <AppearancePresetGrid

                  targetTheme="light"

                  currentTheme={theme}

                  currentPalette={appearance.palettes.light}

                  presets={lightThemePresets}

                  onSelect={applyThemePreset}

                />

              </SettingsSectionBlock>

            ) : (

              <SettingsSectionBlock title="Dark themes" description="Choose a complete black palette.">

                <AppearancePresetGrid

                  targetTheme="dark"

                  currentTheme={theme}

                  currentPalette={appearance.palettes.dark}

                  presets={darkThemePresets}

                  onSelect={applyThemePreset}

                />

              </SettingsSectionBlock>

            )}

            <SettingsSectionBlock title="Surface layout" description="Apply the surface arrangement across every space.">

              <div className="py-3">

                <div className="ui-appearance-segmented" role="group" aria-label="Surface layout">

                  <button

                    type="button"

                    onClick={() => setSurfaceMode("standard")}

                    className={`ui-appearance-segment ${appearance.surfaceMode === "standard" ? "ui-appearance-segment-active" : ""}`}

                    aria-pressed={appearance.surfaceMode === "standard"}

                  >

                    Standard

                  </button>

                  <button

                    type="button"

                    onClick={() => setSurfaceMode("flipped")}

                    className={`ui-appearance-segment ${appearance.surfaceMode === "flipped" ? "ui-appearance-segment-active" : ""}`}

                    aria-pressed={appearance.surfaceMode === "flipped"}

                  >

                    Flipped

                  </button>

                </div>

              </div>

            </SettingsSectionBlock>

          </SettingsPage>

          </div>

        ) : null}



        {mountedSections.has("organization") ? (

          <div hidden={activeSection !== "organization"} aria-hidden={activeSection !== "organization"}>

          <SettingsPage title="Organization" description="Rename the organization, manage members, and control who can access each project.">

            <SettingsSectionBlock title="Current organization">

              <SettingsRow label="Active project">

                <span className="ui-settings-group-row-value">

                  {project ? projectContextLabel(project.projectName, project.workspaceName) : "No workspace selected"}

                </span>

              </SettingsRow>

            </SettingsSectionBlock>

            <OrganizationSettings project={project} />

          </SettingsPage>

          </div>

        ) : null}



        {mountedSections.has("projects") ? (

          <div hidden={activeSection !== "projects"} aria-hidden={activeSection !== "projects"}>

          <SettingsPage title="Projects" description="Manage projects and project-specific tools.">

            <ProjectSettings groups={groups} activeProject={project} embedded />

          </SettingsPage>

          </div>

        ) : null}



        {mountedSections.has("planning") ? (

          <div hidden={activeSection !== "planning"} aria-hidden={activeSection !== "planning"}>

          <SettingsPage title="Planning" description="Catalog and production-planning configuration.">

            <PlanningSettings />

          </SettingsPage>

          </div>

        ) : null}



      </div>

    </div>

  );

}
