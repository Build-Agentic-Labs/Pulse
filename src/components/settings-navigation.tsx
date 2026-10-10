"use client";

import { CircleUserRound, HardDrive, Smartphone, Palette, Settings, UsersRound } from "lucide-react";
import { NavSelectionTrack } from "@/components/nav-selection-track";

export const settingsSections = [
  { id: "account", label: "Account", icon: CircleUserRound },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "organization", label: "Organization", icon: UsersRound },
  { id: "phone-portal", label: "Phone portal", icon: Smartphone },
  { id: "planning", label: "Planning", icon: Settings },
  { id: "backups", label: "Backups", icon: HardDrive },
] as const;

export const embeddedSettingsSections = settingsSections.slice(0, 3);

export type SettingsSection = (typeof settingsSections)[number]["id"];
export type SettingsNavigationItem = (typeof settingsSections)[number];

/**
 * One navigation tree for both the Settings fallback and its settled panel.
 * Reusing it keeps section labels, icons, row heights and active-track
 * geometry identical while the route's data boundary resolves.
 */
export function SettingsNavigation({
  activeSection,
  sections = settingsSections.filter((item) => item.id !== "backups"),
  onSelect,
}: {
  activeSection: SettingsSection;
  sections?: readonly SettingsNavigationItem[];
  onSelect?: (section: SettingsSection) => void;
}) {
  const activeSectionIndex = sections.findIndex((item) => item.id === activeSection);

  return (
    <>
      <NavSelectionTrack as="nav" persistenceKey="settings-mobile"
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-surface px-2 py-2 md:hidden"
        aria-label="Settings sections"
      >
        {sections.map((item) => {
          const Icon = item.icon;
          const active = activeSection === item.id;

          return (
            <button
              key={item.id}
              type="button"
              onClick={onSelect ? () => onSelect(item.id) : undefined}
              tabIndex={onSelect ? undefined : -1}
              className={`ui-settings-subnav-item mx-0 shrink-0 ${
                active ? "ui-settings-subnav-item-active" : "ui-settings-subnav-item-idle"
              }`}
            >
              <Icon size={14} strokeWidth={1.75} />
              {item.label}
            </button>
          );
        })}
      </NavSelectionTrack>

      <aside className="ui-settings-subnav">
        <div className="ui-nav-section px-4">Settings</div>
        <NavSelectionTrack
          persistenceKey="settings-desktop"
          activeIndex={activeSectionIndex}
          as="nav"
          inset
          className="mt-1 flex flex-col gap-0.5"
        >
          {sections.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={onSelect ? () => onSelect(item.id) : undefined}
                tabIndex={onSelect ? undefined : -1}
                className={`ui-settings-subnav-item ${
                  active ? "ui-settings-subnav-item-active" : "ui-settings-subnav-item-idle"
                }`}
              >
                <Icon size={14} strokeWidth={1.75} />
                {item.label}
              </button>
            );
          })}
        </NavSelectionTrack>
      </aside>
    </>
  );
}
