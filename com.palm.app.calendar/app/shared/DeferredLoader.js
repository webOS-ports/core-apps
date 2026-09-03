// Loads the parts of the app that no first-paint path can reach.
//
// The event editor and the preferences view are already declared `lazy: true` in
// AppView, so enyo defers *constructing* them -- but their kinds still have to be
// defined, which meant their code was fetched and parsed during cold start even
// though a user has to tap something before either can appear. This loads them on
// first use instead.
//
// enyo.depends() cannot be used here: it injects via document.write, which after
// load would blow away the document. So the bundle is appended as a plain script
// tag and callers are called back from its onload.
//
// enyo.loadScript() is not used either -- it is fire-and-forget with no completion
// callback, so `new EditView()` after it would race the fetch.

window.calendar = window.calendar || {};   // may load before any calendar.* kind is defined

calendar.loadDeferred = (function () {
    var IDLE = 0, LOADING = 1, READY = 2;

    // In a built package this is one bundle. Unbuilt (a dev checkout with no
    // enyo-compress pass) it falls back to the individual sources, in depends order.
    var BUNDLE = "deferred.js";
    var SOURCES = [
        "edit/EditView.js",
        "edit/TimeSelectView.js",
        "edit/AttendeesView.js",
        "edit/RepeatView.js",
        "edit/ContactView.js",
        "prefs/PrefSelector.js",
        "prefs/PreferencesView.js"
    ];

    var state = IDLE, queue = [];

    function drain() {
        var q = queue;
        queue = [];
        for (var i = 0; i < q.length; i++) { q[i](); }
    }

    function script(src, onLoad, onError) {
        var s = document.createElement("script");
        s.type = "text/javascript";
        s.src = src;
        s.onload = onLoad;
        s.onerror = onError;
        document.head.appendChild(s);
    }

    // Sequential, because these files define kinds that extend each other.
    function chain(list, i, done) {
        if (i >= list.length) { done(); return; }
        script(list[i], function () { chain(list, i + 1, done); }, function () {
            enyo.warn && enyo.warn("calendar: deferred source failed: " + list[i]);
            chain(list, i + 1, done);
        });
    }

    function ready() { state = READY; drain(); }

    return function loadDeferred(callback) {
        if (state === READY) { callback && callback(); return; }
        if (callback) { queue.push(callback); }
        if (state === LOADING) { return; }
        state = LOADING;

        // No stylesheet here: these views' CSS stays in the startup bundle because
        // it carries globally-scoped rules (deferring it shifts the header divider).
        script(BUNDLE, ready, function () {
            chain(SOURCES, 0, ready);   // no bundle -- unbuilt tree, pull the sources
        });
    };
}());
