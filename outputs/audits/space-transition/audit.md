# Space Transition Audit

## Scope

Dashboard navigation into Product and Production at desktop width, including a cold application start.

## Evidence

1. `01-dashboard-start.png` - stable company dashboard.
2. `06-cold-route-loader.png` - full-screen organization loading state.
3. `08-cold-product-route.png` - loaded Product workspace.
4. `05-production-early.png` - loaded Production space.

## Findings

1. The font family is consistent. Both loader variants resolve through `--font-ui-family` to Inter.
2. The typography treatment is inconsistent. Route loading uses a small `ui-mono-label` with 0.1em tracking, while the application loader uses 12px bracketed uppercase copy with 0.04em tracking.
3. Product can pass through several independently owned fallbacks: route loading, dynamic chunk loading, organization loading, and project data loading. Their copy and framing change even though they describe one user action.
4. The full-screen loading card removes the dashboard and does not preserve spatial continuity with the selected card or destination shell.
5. Warm transitions are fast and abrupt; cold transitions can flash a centered authentication-style card. The experience therefore changes according to cache state.

## Recommended Model

1. Keep the dashboard visible after selection and show a restrained pending state on the selected card.
2. Use one user-facing message, such as `Opening Product`, instead of exposing chunk, organization, or project loading phases.
3. Render the destination chrome immediately. For Product, reuse the existing planner shell and workspace skeleton rather than a centered card.
4. Suppress loading UI for transitions under roughly 150ms. Once shown, keep it stable for about 250ms so it does not flash.
5. Use one `role="status"` region with `aria-busy` on the transitioning surface and respect reduced-motion preferences.

## Implementation Order

1. Consolidate route, chunk, auth, and project fallbacks behind one transition component and copy contract.
2. Mark dashboard-to-Product navigation as a project switch so cached project context can paint immediately.
3. Add the selected-card pending treatment and destination-shell skeleton.
4. Verify Product, Planning, Production, Quality, and People in warm and cold cache states.
