# Pulse UI Theme Contract (Draft)

This document defines the visual behavior that should remain consistent across the Dashboard, Product, Planning, Production, Quality, and Settings modules. Module content can differ, but shared chrome, navigation, controls, and states should not.

## Foundation

### Typography

- Use the application font token (`--font-ui-family`) everywhere.
- Reserve 28px display text for the dashboard greeting and true empty-space introductions.
- Use 20px for module page titles, 16px for section titles, 13px for body text, 12px for navigation and controls, 11px for supporting metadata, and 10px only for compact labels or identifiers.
- Use 400 for body copy, 500 for navigation and labels, and 600 for headings or important values.
- Use uppercase labels only for compact metadata, table headers, and status labels. Do not use uppercase for ordinary buttons or navigation.
- Use letter spacing only for uppercase metadata. Normal text has zero letter spacing.
- Use tabular numerals for dates, quantities, durations, and identifiers.

### Spacing

- Use a 4px base grid: 4, 8, 12, 16, 24, and 32px.
- Sidebar content has an 8px horizontal gutter.
- Page content uses 24px padding on desktop and 16px on compact screens.
- Related controls use an 8px gap; distinct groups use 16 or 24px.

### Radius

- Buttons, fields, navigation rows, and compact controls: 4px.
- Tables, panels, and repeated cards: 8px.
- Main module content corner where it meets a sidebar: 16px.
- Menus, popovers, and dialogs: 8px.
- Use fully rounded shapes only for avatars, status chips, swatches, and circular icon controls.

### Color And Elevation

- Canvas, surface, raised surface, text, border, and semantic colors come from CSS variables.
- Selected navigation uses `surface-muted` with primary text.
- Hover uses `surface-hover`; focus uses one visible, consistent focus ring.
- Disabled controls retain readable text and use reduced contrast without changing layout.
- Page sections remain flat. Shadows are reserved for menus, popovers, and dialogs.

## Shared Components

### App Chrome

- Header height is 48px on every module.
- Back, brand, context, theme, spaces, and account controls stay in the same positions.
- Module context uses the same type style and separator treatment across Planning, Quality, Settings, and Production.
- Header icon buttons are 32 x 32px.

### Sidebar Navigation

- Product, Quality, and Settings use the same row geometry.
- Every item fills the available sidebar width inside the 8px gutter.
- Row height is 32px, radius is 4px, and icon size is 14 to 15px.
- Active state is a full-row highlight. Do not highlight only the label width and do not add a left selection border.
- Section labels, item spacing, hover, focus, and disabled states are identical across modules.

### Buttons

- Standard command button height is 36px; compact toolbar buttons are 32px.
- Primary buttons use solid high-contrast fill. Secondary buttons use a border. Ghost buttons remain borderless.
- Icon-only actions use familiar icons, 32 x 32px targets, accessible names, and tooltips where needed.
- Button labels use sentence case and the shared UI font.
- Destructive actions use the same geometry as other buttons and introduce danger color only when the action is available.

### Fields And Selects

- Standard field height is 36px; compact table or toolbar fields are 32px.
- Inputs, selects, date fields, and search controls share radius, border, text size, placeholder color, focus state, and disabled state.
- Dropdown menus use the same surface, selected state, hover state, animation, and shadow regardless of module.

### Tables And Lists

- Table containers use an 8px radius and one outer border.
- Headers, row height, cell padding, hover, selected state, status, and empty states use shared styles.
- Use one separator between rows. Avoid stacking borders around headings, lists, and footers inside an already bounded panel.
- Identifiers align consistently and use tabular numerals.

### Status And Feedback

- Status chips are the only text controls that may use a capsule shape.
- Neutral, success, warning, and danger states use shared semantic tokens.
- Empty states use the same icon size, body style, vertical spacing, and action placement.
- Skeletons preserve the final layout and typography so navigation does not jump while loading.
- Standard motion is 160 to 200ms with `--ease-ui`; project or route transitions may use up to 320ms.
- Respect `prefers-reduced-motion` for every transition and skeleton animation.

### Responsive And Accessibility

- Desktop controls have a minimum 32px target; touch layouts increase targets to at least 44px.
- Focus indication must be visible on navigation, icon buttons, fields, menus, and table rows.
- Selected, error, and disabled states cannot rely on color alone.
- Sidebar navigation becomes a consistent compact tab row or drawer on smaller screens.

## Implementation Status

1. Settings, Product, and Quality navigation use full-row selection with 32px rows and 4px radii.
2. Shared command buttons use sentence case, the UI font, 4px radii, and 32px compact or 36px standard heights.
3. Dashboard, Product, Planning, Production, Quality, Settings, and their loading states share the 48px chrome and sentence-case context style.
4. Module page titles use the 20px title role. The 28px dashboard greeting remains an intentional display role.
5. Shared fields and dropdowns use 36px standard or 32px compact geometry, one focus treatment, one menu surface, and one motion pattern.
6. Panels, cards, tables, menus, popovers, and dialogs use their assigned 8px role. Main sidebar-to-content shell corners remain 16px.
7. Planning and Quality tables use the shared table frame and header treatment without changing row content or data density.
8. Quality list loading states use layout-preserving table skeletons, and empty states use the shared bounded state treatment.
9. The compact scenario period control remains a native inline selector because it behaves as a unit suffix, not a standard form dropdown.
10. Domain-specific editor utilities remain where they encode timeline, media, status, avatar, or compact data behavior. Repeated shared UI values should continue moving to these primitives during future feature work.

## Migration Order

1. Navigation geometry and active, hover, and focus states.
2. Button, field, select, and dropdown primitives.
3. App chrome and page title hierarchy.
4. Table and list primitives.
5. Panel and card radii plus border density.
6. Empty, loading, success, warning, and error states.
7. Remove remaining feature-level visual overrides after each module matches the shared primitives.
