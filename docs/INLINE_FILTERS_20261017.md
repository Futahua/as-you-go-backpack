# Inline filters — 17 October 2026

The detached Sort & filter form is replaced with inline heading editors. Normal click sorts; right-click or a 450 ms touch hold opens the editor. Moving the touch cancels hold activation and a completed hold consumes its click. Name/Type expose one field; Size/Modified expose paired From/Through fields. Enter, the check button, or leaving the editor applies validated values. Escape discards the draft. Compact badges show active parameters. Existing per-device/per-mode preferences and projection validation remain authoritative.

The former funnel location now toggles hidden items with an eye icon. A neighbouring reset action clears filters and restores manual order. Column headers remain available when filtering produces zero native results. Graph mode receives the same strip. Background renderer/metadata refresh does not replace an active inline draft.

Verification: full AYG suite 2,099 passed, plus pretests. Isolated Electron fixture `D:/Programs/evTEMP/ayg-inline-filter-fixture.cjs` passed normal click, context menu, paired ranges, invalid range rejection, date range, touch hold/click suppression, focus-out commit, Escape, actual projection filtering, and 380px layout. No creator mouse or keyboard was controlled.

Delivery: seven combined current AYG assets were SHA-256 checked on LapDog; three inline-filter assets were SHA-256 checked on SlopTop. Recovery copies: `D:/Programs/evTEMP/ayg-inline-filter-20261017` and LapDog `C:/Users/admin/Documents/Papers-Updates/inline-filter-20261017`. The same-key Android APK was rebuilt and installed with `adb install -r` after the existing document save barrier. Desktop renderers still need a normal Papers reload; no process was force-terminated or UI automated. Phone fixture gestures are browser simulation, not a claim of an exhaustive physical-device gesture test.

The earlier USB desktop host build and its live cable acceptance remain pending activation/verification; installing these AYG assets does not claim that host feature is active.

Activation completed at 09:02 local time through the existing `host:app:reload` registered main-process handler, using a verified host WebContents sender. No mouse or keyboard input was injected. SlopTop PID 41972 completed its shutdown barrier and restarted as 40504; LapDog PID 28436 completed its barrier and restarted as 25048. Temporary localhost inspector endpoints disappeared with the old processes. This activated the installed AYG assets and the prior Proxima assets; it did not install the separately built USB host update.
