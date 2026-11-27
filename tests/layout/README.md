# Layout checks

Lays every core app out on every device LuneOS runs on and reports what a
user could not reach or read. Each app runs in headless Chromium with the real
Enyo 1.0 from source, the fake luna bus of the jsdom tests
(`tests/harness/luna.js`), and stand-ins for what WebAppMgr gives a page.

    npm run layout                                  # every app, every device
    npm run layout -- --app clock                   # one app (end of its id)
    npm run layout -- --device q25,sargo --view alarms

It prints one line per app, screen and device, with what is wrong beneath it,
and writes `out/results.json` and a screenshot of each screen in
`out/shots/<device>/<app>-<view>.png`. It exits 1 if any layout has issues.

## What it needs

| variable             | what for |
|----------------------|----------|
| `CHROME`             | the Chromium to run. Default `chromium` |
| `ENYO`               | the Enyo 1.0 checkout. Default `../enyo-1.0-ports` or `../enyo-1.0` next to this repository |
| `LUNEOS_COMPONENTS`  | the luneos-components checkout, for the device list. Default `../luneos-components` |
| `LUNEOS_ROOT`        | a LuneOS root filesystem, for MojoLoader and the Calendar and Contacts libraries. Without it, Calendar and Contacts are skipped |
| `LAYOUT_OUT`         | where results and screenshots go. Default `tests/layout/out` |
| `LAYOUT_JOBS`        | how many devices are laid out at once. Default 4 |
| `DEBUG`              | print the pages' console output and every bus call and answer |

## The devices

`devices.js` reads the display profiles the shell's own tests use
(luneos-components, `test/imports/LunaNext/Common/SettingsStub.js`), so the
two lists cannot drift apart. What an Enyo 1 app gets of a device is not its
panel:

- WebAppMgr zooms a legacy page by the device's
  `com.webos.surfacemanager.devicePixelRatio`, so the page lays out in panel /
  zoom CSS pixels. `devices.js` lists each device's zoom and where it comes
  from (its configd data or deviceinfo, or the panel width over 450, which
  `10-configd-surfacemanager` falls back to).
- The card is the panel less the shell's status bar (3 grid units, plus a
  notch's depth) and gesture area (4 grid units).
- A popup alert is as wide as the card on a phone and as the shell's popup
  panel on a tablet, and as tall as its opener asked, zoomed with the page.

Profiles that stand for no LuneOS device (`a500`, `asymmetric`, `desktop`)
are left out.

## The screens

`views.js` lists them. Every app gets its first screen ("start"); an app can
add others with launch params, a seeded bus and steps run in the page (Clock's
alarm list, empty, with one alarm and with eight, and the alarm going off).

## What is reported

| issue           | meaning |
|-----------------|---------|
| `off-screen`    | a control none of which is on the screen, with no scroller to bring it there |
| `clipped`       | a control less than 60% on the screen the same way |
| `covered`       | a control on the screen with something else over its middle |
| `squeezed`      | a scroller with too little of it on the screen to use |
| `scroller-cut`  | a scroller reaching past the window's edge: scrolled to its end, its last rows are still out of reach |
| `page-overflow` | the page is wider or taller than the window. WebAppMgr does not scroll the main frame, so the excess cannot be reached |
| `no-controls`   | no control was found, so nothing was checked: the page did not come up |

Controls inside an Enyo scroller are judged by the scroller, which can bring
them into view. A view parked beside the screen, as a phone's sliding panes
keep the ones not shown, is not off-screen. Page errors and bus failures are
reported as well; a ringtone the host cannot play is not.

## Limits

- The fonts are the host's, not the device's, so text can be a few pixels off.
- The bus answers as the jsdom tests' fake does, not with a device's data.
- Covering is judged at one point, the middle of the control.
