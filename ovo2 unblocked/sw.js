"use strict";
const OFFLINE_DATA_FILE = "offline.json"
  , CACHE_NAME_PREFIX = "c3offline"
  , BROADCASTCHANNEL_NAME = "offline"
  , CONSOLE_PREFIX = "[SW] "
  , LAZYLOAD_KEYNAME = ""
  , broadcastChannel = "undefined" == typeof BroadcastChannel ? null : new BroadcastChannel("offline");
function PostBroadcastMessage(a) {
    broadcastChannel && setTimeout( () => broadcastChannel.postMessage(a), 3e3)
}
function Broadcast(a) {
    PostBroadcastMessage({
        "type": a
    })
}
function BroadcastDownloadingUpdate(a) {
    PostBroadcastMessage({
        "type": "downloading-update",
        "version": a
    })
}
function BroadcastUpdateReady(a) {
    PostBroadcastMessage({
        "type": "update-ready",
        "version": a
    })
}
function IsUrlInLazyLoadList(a, b) {
    if (!b)
        return !1;
    try {
        for (const c of b)
            if (new RegExp(c).test(a))
                return !0
    } catch (a) {
        console.error("[SW] Error matching in lazy-load list: ", a)
    }
    return !1
}
function WriteLazyLoadListToStorage(a) {
    return "undefined" == typeof localforage ? Promise.resolve() : localforage.setItem(LAZYLOAD_KEYNAME, a)
}
function ReadLazyLoadListFromStorage() {
    return "undefined" == typeof localforage ? Promise.resolve([]) : localforage.getItem(LAZYLOAD_KEYNAME)
}
function GetCacheBaseName() {
    return "c3offline-" + self.registration.scope
}
function GetCacheVersionName(a) {
    return GetCacheBaseName() + "-v" + a
}
async function GetAvailableCacheNames() {
    const a = await caches.keys()
      , b = GetCacheBaseName();
    return a.filter( (a) => a.startsWith(b))
}
async function IsUpdatePending() {
    const a = await GetAvailableCacheNames();
    return 2 <= a.length
}
async function GetMainPageUrl() {
    const a = await clients.matchAll({
        includeUncontrolled: !0,
        type: "window"
    });
    for (const b of a) {
        let a = b.url;
        if (a.startsWith(self.registration.scope) && (a = a.substring(self.registration.scope.length)),
        a && "/" !== a)
            return a.startsWith("?") && (a = "/" + a),
            a
    }
    return ""
}
function fetchWithBypass(a, b) {
    return "string" == typeof a && (a = new Request(a)),
    b ? fetch(a.url, {
        headers: a.headers,
        mode: a.mode,
        credentials: a.credentials,
        redirect: a.redirect,
        cache: "no-store"
    }) : fetch(a)
}
async function CreateCacheFromFileList(a, b, c) {
    const d = await Promise.all(b.map( (a) => fetchWithBypass(a, c)));
    let e = !0;
    for (const f of d)
        f.ok || (e = !1,
        console.error("[SW] Error fetching '" + f.url + "' (" + f.status + " " + f.statusText + ")"));
    if (!e)
        throw new Error("not all resources were fetched successfully");
    const f = await caches.open(a);
    try {
        return await Promise.all(d.map( (a, c) => f.put(b[c], a)))
    } catch (b) {
        throw console.error("[SW] Error writing cache entries: ", b),
        caches.delete(a),
        b
    }
}
async function UpdateCheck(a) {
    try {
        const b = await fetchWithBypass(OFFLINE_DATA_FILE, !0);
        if (!b.ok)
            throw new Error("offline.json responded with " + b.status + " " + b.statusText);
        const c = await b.json()
          , d = c.version
          , e = c.fileList
          , f = c.lazyLoad
          , g = GetCacheVersionName(d)
          , h = await caches.has(g);
        if (h) {
            const a = await IsUpdatePending();
            return void (a ? (console.log("[SW] Update pending"),
            Broadcast("update-pending")) : (console.log("[SW] Up to date"),
            Broadcast("up-to-date")))
        }
        const i = await GetMainPageUrl();
        e.unshift("./"),
        i && -1 === e.indexOf(i) && e.unshift(i),
        console.log("[SW] Caching " + e.length + " files for offline use"),
        a ? Broadcast("downloading") : BroadcastDownloadingUpdate(d),
        f && (await WriteLazyLoadListToStorage(f)),
        await CreateCacheFromFileList(g, e, !a);
        const j = await IsUpdatePending();
        j ? (console.log("[SW] All resources saved, update ready"),
        BroadcastUpdateReady(d)) : (console.log("[SW] All resources saved, offline support ready"),
        Broadcast("offline-ready"))
    } catch (a) {
        console.warn("[SW] Update check failed: ", a)
    }
}
self.addEventListener("install", (a) => {
    a.waitUntil(UpdateCheck(!0).catch( () => null))
}
);
async function GetCacheNameToUse(a, b) {
    if (1 === a.length || !b)
        return a[0];
    const c = await clients.matchAll();
    if (1 < c.length)
        return a[0];
    const d = a[a.length - 1];
    return console.log("[SW] Updating to new version"),
    await Promise.all(a.slice(0, -1).map( (a) => caches.delete(a))),
    d
}
async function HandleFetch(a, b) {
    const c = await GetAvailableCacheNames();
    if (!c.length)
        return fetch(a.request);
    const d = await GetCacheNameToUse(c, b)
      , e = await caches.open(d)
      , f = await e.match(a.request);
    if (f)
        return f;
    const g = await Promise.all([fetch(a.request), ReadLazyLoadListFromStorage()])
      , h = g[0]
      , i = g[1];
    if (IsUrlInLazyLoadList(a.request.url, i))
        try {
            await e.put(a.request, h.clone())
        } catch (b) {
            console.warn("[SW] Error caching '" + a.request.url + "': ", b)
        }
    return h
}
self.addEventListener("fetch", (a) => {
    if (new URL(a.request.url).origin === location.origin) {
        const b = "navigate" === a.request.mode
          , c = HandleFetch(a, b);
        b && a.waitUntil(c.then( () => UpdateCheck(!1))),
        a.respondWith(c)
    }
}
);
