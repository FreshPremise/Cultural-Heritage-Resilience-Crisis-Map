# Mobile support and known limitations

Current build: `2026.08.28.1`
Release date: August 28, 2026
Asset version: `30`

Cultural Heritage Resilience is one responsive web application for desktop, tablet,
and phone browsers. It is not a separate native iOS or Android application and does
not provide offline operation.

## Responsive behavior

- Phone filters start collapsed, with a summary of enabled organization types and
  hazard layers.
- The list-size control switches between the balanced view and additional room for
  the event list or details. It remains available in event and affected-list views.
- Short landscape phones place the map and information panel side by side. Tablet
  and narrow desktop layouts use a compact header.
- Touch targets, dynamic viewport height, device safe-area spacing, and scrollable
  dialogs with persistent top close buttons are included.
- Map framing follows the map container's actual dimensions. Explicit navigation
  restores map space before moving the camera; marker clicks preserve the current view.
- Map controls remain available when the event list is expanded.

## Verification record

The broader layout was checked on August 26, 2026 in a desktop browser at device-sized
viewports. These are historical layout checks, not physical-device certifications.

| Coverage | Dimensions |
|---|---|
| Phone portrait | 320x568, 360x640, 390x844, 430x932 |
| Phone landscape | 568x320, 844x390 |
| Stacked landscape | 844x600, 899x600 |
| Tablet | 768x1024, 1024x768, 1180x820 |
| Desktop | 1366x768 |
| Width boundaries | 679x800, 680x800, 681x800, 899x800, 901x800, 1120x800, 1121x800, 1200x800, 1201x800 |
| Landscape height boundaries | 568x499, 568x500, 568x501 |

Across those 24 sizes and 40 balanced/expanded states, the checks found no horizontal
page overflow or clipped header/map controls after the layout fixes. Event lists stayed
within the viewport, and map canvases resized with their containers. Interactions covered
filters, event selection, organization popups, search, affected lists, the assistant
panel, and all three dialogs.

On August 27, help-text and build-label checks passed at 1366x768 and 390x844. The desktop
hazard-popup guidance was also checked. At that checkpoint, 62 JavaScript tests and
5 Python local-server tests passed.

The August 28 release adds air-quality assistant metadata coverage, removes a redundant
map resize listener, and adds tested Firebase package preparation. The dialog sizing
and Active Events trend display are unchanged.

August 28 verification:

- All 78 JavaScript tests and 5 Python local-server tests passed, along with runtime
  and tooling syntax, vendor-integrity, sensitive-file, and whitespace checks.
- Browser resize checks passed at 320x568, 390x844, 568x320, 844x390, 768x1024,
  1024x768, 899x600, 901x600, 1180x820, and 1366x768. Map canvases followed their
  containers, with no horizontal page overflow or clipped header buttons.
- Expanded-list checks passed at 320x568 and 390x844. Opening and closing the
  desktop assistant also preserved map sizing.
- The information dialog showed the current build, stayed within the desktop and
  phone viewports, and kept its phone close button visible after scrolling.
- No browser console errors were reported during these checks. No paid assistant
  provider requests were made; assistant tool behavior was tested offline.

## Known limitations and remaining validation

- Test a physical iPhone in Safari and an Android phone in Chrome, including touch
  scrolling, map gestures, rotation, browser bars, and the onscreen keyboard.
- Check a real notched device and assistive technology. Desktop viewport checks do
  not establish device-specific behavior, WebKit compatibility, or accessibility.
- Complete screen-reader, keyboard-only, and broader accessibility testing.
- After publication, verify the hosted build/version manifest and live phone layout.

Automated and desktop-browser checks do not replace these device and accessibility
checks. The application is a situational-awareness prototype, not an emergency
notification service. Always follow official guidance from local authorities.
