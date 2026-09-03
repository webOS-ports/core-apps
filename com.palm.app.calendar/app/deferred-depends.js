// Code that no first-paint path can reach: the event editor and the preferences
// view, both already declared `lazy: true` in AppView. Loaded on first use by
// shared/DeferredLoader.js.
//
// JS only, deliberately. These views' stylesheets are NOT deferred: EditView.css,
// RepeatView.css and PreferencesView.css carry globally-scoped rules, and removing
// them from the startup bundle shifts the shared header divider by ~4px. CSS is
// ~7KB total, so keeping it eager costs nothing measurable.
enyo.depends(
    "edit/EditView.js",
    "edit/TimeSelectView.js",
    "edit/AttendeesView.js",
    "edit/RepeatView.js",
    "edit/ContactView.js",
    "prefs/PrefSelector.js",
    "prefs/PreferencesView.js"
);
