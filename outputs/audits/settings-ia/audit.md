# Settings information architecture audit

## Overall health

Needs reorganization. Pulse already has useful settings screens, but their ownership is unclear:

- Global settings are mounted inside a Product project route.
- Planning configuration opens inline above the operational work-order table.
- Organization departments and member roles are managed inside Quality.
- Project administration lives in per-project overflow menus.
- The dashboard calls the destination "People," even though it also contains account, appearance, organization, project access, and activity settings.

The recommended change is a dedicated Settings space that is always available and appears last on the company dashboard.

## Evidence

| Step | Screen | Health | Finding |
| --- | --- | --- | --- |
| 1 | `04-current-dashboard.png` | Needs change | Replace People with Settings and order cards as Product, Planning, Production, Quality, Insights, Settings. |
| 2 | `01-current-general.png` | Needs reorganization | Account settings are global, but organization context and the project-specific phone portal are mixed into General. |
| 3 | `02-current-appearance.png` | Good foundation | Theme belongs here. This section can later hold font, density, contrast, and motion preferences. |
| 4 | `03-current-organization.png` | Good content, wrong shell | Organizations, members, invites, project access, and activity are correct settings content but should not depend on a Product project route. |
| 5 | `05-planning-settings.png` | Move | Item master and trailer configuration are persistent Planning configuration. Opening them inline displaces the work-order table and mixes administration with operations. |
| 6 | `06-quality-departments.png` | Split and move | Department structure and membership are organization settings. SOP access and the Quality gate are Quality settings. |
| 7 | `07-account-menu.png` | Healthy shortcut | Keep identity and Sign out here. Add an Account settings link, but keep the canonical controls in Settings. |
| 8 | `08-project-controls.png` | Keep shortcut, centralize | Rename/archive/remove can remain as quick project actions, while full project administration belongs in Settings > Projects. |

## Recommended dashboard

1. Product
2. Planning
3. Production
4. Quality
5. Insights
6. Settings

Settings should use a dedicated `/settings` route rather than `/projects/[projectId]/planner?view=settings`. A system-level destination should still open when an organization has no projects. Project-specific sections can ask the user to select a project.

## Recommended Settings sections

### Account

- Display name
- Email
- Password and future authentication controls

### Appearance

- Light/dark/system theme
- Future font choice
- Future interface density
- Future contrast and reduced-motion preferences

### Organization

- Organization name
- Members, invitations, and roles
- Department directory, codes, members, and positions
- Activity log

### Projects

- Project list and active project context
- Create, rename, archive, and remove
- Project access
- Phone photo portal for the selected project

### Planning

- Item master import
- Trailer configurations

### Quality

- SOP access duties by department
- Quality-gate designation and release policy
- Future SOP numbering and document-control defaults

## Keep contextual

These are workflow setup, not general settings, and should remain in their modules:

- Product line setup, stations, procedures, work instructions, balance, and reports
- Planning work-order creation, filters, scheduling, and printing
- Quality SOP authoring, reviews, effective library, and retirement workflows
- Production station operation and live execution controls

The header theme button, project overflow menu, and module-level links can remain as shortcuts. They should point to or update the same source of truth as the canonical Settings screens.

## Implementation sequence

1. Replace the People dashboard metadata with Settings, move it to the final card position, and add a settings icon.
2. Add a dedicated `/settings` route and reuse the existing settings panel and visual system.
3. Separate General into Account and Projects; keep Appearance and Organization.
4. Move Planning configuration into Settings > Planning and replace the inline gear panel with a link to that section.
5. Move department structure to Settings > Organization and SOP policy to Settings > Quality.
6. Add Account settings to the profile menu and keep project overflow actions as shortcuts.
7. Verify permissions, keyboard focus, responsive layout, and deep links for every section.

## Accessibility limits

The screenshots show named icon controls and reasonable visual contrast, but they do not prove keyboard order, focus return after menus, screen-reader announcements, or permission-state behavior. Those checks should be included during implementation QA.
