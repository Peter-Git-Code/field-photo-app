/* Field Photo: offline photography guides.
   Plain JavaScript, no build step. Content lives in content/ as JSON and is
   listed in content/index.json. The service worker (sw.js) keeps a copy of
   everything on the phone so it works without signal. */
(function () {
  "use strict";

  var view = document.getElementById("view");
  var CONTENT = "content/";
  var TYPES = { basic: "Basics", guide: "How-to guides", lesson: "Lessons" };

  var state = {
    index: null,        // content/index.json
    items: {},          // id -> loaded item JSON
    manuals: {},        // device id -> loaded manual JSON
    mode: store("mode") || "photo",
    kit: store("kit") || ["canon-r10", "dji-lito-x1", "dji-osmo-action-5-pro", "canon-speedlite-420ex"],
    custom: store("customDevices") || [],
    active: store("activeDevice") || "canon-r10",
    theme: store("theme") || "day"
  };

  // ---------- storage (wrapped: private windows can throw) ----------
  function store(key, value) {
    try {
      if (arguments.length === 1) {
        var raw = localStorage.getItem("fp:" + key);
        return raw ? JSON.parse(raw) : null;
      }
      localStorage.setItem("fp:" + key, JSON.stringify(value));
    } catch (e) { return null; }
  }

  // ---------- tiny DOM helper ----------
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === "text") node.textContent = v;
        else if (k === "class") node.className = v;
        else if (k.slice(0, 2) === "on") node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? "" : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) add(node, arguments[i]);
    return node;
  }
  function add(node, child) {
    if (child == null || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { add(node, c); }); return; }
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  // Text with **bold** only. Built from text nodes, never innerHTML.
  function rich(text) {
    var frag = document.createDocumentFragment();
    String(text).split(/(\*\*[^*]+\*\*)/).forEach(function (part) {
      if (/^\*\*[^*]+\*\*$/.test(part)) frag.appendChild(el("strong", { text: part.slice(2, -2) }));
      else if (part) frag.appendChild(document.createTextNode(part));
    });
    return frag;
  }
  function toast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  // ---------- theme ----------
  var THEMES = ["day", "dark", "night"];
  var THEME_LABEL = { day: "☀ Day", dark: "☾ Dark", night: "● Night" };
  function applyTheme(t) {
    state.theme = t; store("theme", t);
    document.documentElement.setAttribute("data-theme", t);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t === "day" ? "#ffffff" : t === "dark" ? "#121418" : "#000000");
    document.querySelectorAll(".theme-btn").forEach(function (b) { b.textContent = THEME_LABEL[t]; });
  }
  function themeButton() {
    return el("button", {
      type: "button", class: "theme-btn", text: THEME_LABEL[state.theme], "aria-label": "Change theme",
      onclick: function () { applyTheme(THEMES[(THEMES.indexOf(state.theme) + 1) % 3]); }
    });
  }
  function header(title, backHref, backText) {
    return el("div", { class: "bar" },
      backHref ? el("a", { class: "back", href: backHref, text: "‹ " + (backText || "Back") }) : el("h1", { text: title }),
      themeButton());
  }

  // ---------- data ----------
  function getJSON(path, fresh) {
    return fetch(path, fresh ? { cache: "no-store" } : undefined).then(function (r) {
      if (!r.ok) throw new Error(path + " " + r.status);
      return r.json();
    });
  }
  function loadIndex(fresh) {
    return getJSON(CONTENT + "index.json", fresh).then(function (idx) { state.index = idx; return idx; });
  }
  function loadItem(id) {
    if (state.items[id]) return Promise.resolve(state.items[id]);
    var meta = findMeta(id);
    if (!meta) return Promise.reject(new Error("Unknown item " + id));
    return getJSON(CONTENT + meta.file).then(function (it) { state.items[id] = it; return it; });
  }
  function loadManual(deviceId) {
    var m = (state.index.manuals || []).filter(function (x) { return x.device === deviceId; })[0];
    if (!m) return Promise.resolve(null);
    if (state.manuals[deviceId]) return Promise.resolve(state.manuals[deviceId]);
    return getJSON(CONTENT + m.file).then(function (j) { state.manuals[deviceId] = j; return j; });
  }
  function findMeta(id) { return state.index.items.filter(function (i) { return i.id === id; })[0]; }
  function allDevices() { return (state.index.devices || []).concat(state.custom); }
  function device(id) { return allDevices().filter(function (d) { return d.id === id; })[0]; }
  function kitDevices() { return state.kit.map(device).filter(Boolean); }
  function activeDevice() { return device(state.active) || kitDevices()[0] || null; }

  // Device support for a guide: ok | unavailable | unchecked
  function support(meta, dev) {
    if (!dev || meta.type !== "guide") return null;
    var d = (meta.devices || {})[dev.id];
    if (d) return d;
    if (meta.appliesTo && meta.appliesTo.indexOf(dev.type) === -1) {
      return { status: "unavailable", note: "This guide is for " + meta.appliesTo.map(typeName).join(" or ") + ". It doesn't apply to " + dev.name + "." };
    }
    return { status: "unchecked" };
  }
  var TYPE_NAMES = { camera: "Cameras", drone: "Drones", action: "Action cameras", flash: "Flashes", phone: "Phones" };
  function typeName(t) { return (TYPE_NAMES[t] || t).toLowerCase(); }
  // The device a guide should open with: the selected one if the guide fits it,
  // otherwise the first device in the kit the guide is written for.
  function deviceFor(meta) {
    var dev = activeDevice();
    if (!meta.appliesTo || (dev && meta.appliesTo.indexOf(dev.type) !== -1)) return dev;
    return kitDevices().filter(function (d) { return meta.appliesTo.indexOf(d.type) !== -1; })[0] || dev;
  }
  var SUPPORT_LABEL = {
    ok: ["Steps for your device", "ok"],
    unavailable: ["Feature unavailable", "no"],
    unchecked: ["General steps", "warn"]
  };

  // Download every content file so the whole library works offline.
  function downloadLibrary(fresh) {
    var files = state.index.items.map(function (i) { return i.file; })
      .concat((state.index.manuals || []).map(function (m) { return m.file; }));
    var done = 0;
    return Promise.all(files.map(function (f) {
      return getJSON(CONTENT + f, fresh).then(function (j) {
        done++;
        if (j.id && j.type) state.items[j.id] = j;
        else if (j.device) state.manuals[j.device] = j;
      });
    })).then(function () {
      store("libVersion", state.index.version);
      store("lastSync", new Date().toISOString());
      return done;
    });
  }

  // ---------- router ----------
  function route() {
    var hash = location.hash.replace(/^#\/?/, "");
    var parts = hash.split("/");
    var page = parts[0] || "home";
    document.querySelectorAll(".nav a").forEach(function (a) {
      var n = a.getAttribute("data-nav");
      var on = n === page || (n === "home" && (page === "item" || page === "kit")) || (n === "manuals" && page === "manual");
      a.classList.toggle("on", on);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    view.innerHTML = "";
    var r;
    if (page === "home") r = renderHome();
    else if (page === "item") r = renderItem(decodeURIComponent(parts[1] || ""));
    else if (page === "kit") r = renderKit();
    else if (page === "manuals") r = renderManuals();
    else if (page === "manual") r = renderManual(decodeURIComponent(parts[1] || ""));
    else if (page === "tools") r = renderTools(parts[1] || "exposure");
    else if (page === "updates") r = renderUpdates();
    else r = renderHome();
    Promise.resolve(r).catch(function (e) {
      view.innerHTML = "";
      add(view, [header("Field Photo"), el("div", { class: "note warn", text: "Couldn't open this page. " + e.message })]);
    });
    window.scrollTo(0, 0);
  }

  // ---------- Home ----------
  function renderHome() {
    var dev = activeDevice();
    var kit = kitDevices();
    var q = "";
    var list = el("div");

    function draw() {
      list.innerHTML = "";
      var items = state.index.items.filter(function (i) {
        if (q) return (i.title + " " + (i.summary || "") + " " + (i.tags || []).join(" ")).toLowerCase().indexOf(q) !== -1;
        return i.mode === state.mode || i.mode === "both";
      });
      if (!items.length) add(list, el("p", { class: "muted", text: "Nothing matches “" + q + "”." }));
      ["guide", "lesson", "basic"].forEach(function (type) {
        var group = items.filter(function (i) { return i.type === type; });
        if (!group.length) return;
        add(list, el("div", { class: "lab", text: TYPES[type] }));
        if (type === "lesson") {
          add(list, group.map(function (i) {
            return el("a", { class: "row", href: "#/item/" + i.id },
              el("span", null, el("b", { text: i.title }), el("span", { class: "muted", text: i.summary })),
              el("span", { class: "muted rowbtn", text: (i.minutes || 3) + " min" }));
          }));
        } else {
          add(list, el("div", { class: "tiles" }, group.map(function (i) {
            var s = support(i, deviceFor(i));
            return el("a", { class: "tile", href: "#/item/" + i.id },
              el("b", { text: i.title }),
              el("span", { class: "muted", text: i.summary }),
              s ? el("span", { class: "pill " + SUPPORT_LABEL[s.status][1], text: SUPPORT_LABEL[s.status][0] }) : null);
          })));
        }
      });
    }

    var seg = el("div", { class: "seg", role: "group", "aria-label": "Photo or video" },
      ["photo", "video"].map(function (m) {
        return el("button", {
          type: "button", class: state.mode === m ? "on" : "", "aria-pressed": String(state.mode === m),
          text: m === "photo" ? "Photo" : "Video",
          onclick: function () {
            state.mode = m; store("mode", m);
            seg.querySelectorAll("button").forEach(function (b) {
              var on = b.textContent.toLowerCase() === m; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on));
            });
            draw();
          }
        });
      }));

    add(view, [
      header("Field Photo"),
      el("div", { class: "lab", text: "My kit · guides match the selected device" }),
      el("div", { class: "chips" },
        kit.map(function (d) {
          return el("button", {
            type: "button", class: "chip" + (dev && d.id === dev.id ? " on" : ""), text: d.name,
            "aria-pressed": String(!!dev && d.id === dev.id),
            onclick: function () { state.active = d.id; store("activeDevice", d.id); route(); }
          });
        }),
        el("a", { class: "chip", href: "#/kit", text: kit.length ? "Edit kit" : "+ Add a device" })),
      el("div", { style: "margin-top:14px" },
        el("label", { for: "q", class: "f", text: "Search" }),
        el("input", {
          id: "q", class: "search", type: "search", placeholder: "Star trails, ND filter, white balance…",
          oninput: function (e) { q = e.target.value.trim().toLowerCase(); draw(); }
        })),
      el("div", { style: "margin-top:12px" }, seg),
      list
    ]);
    draw();
  }

  // ---------- Item (basic, guide, lesson) ----------
  function renderItem(id) {
    var meta = findMeta(id);
    if (!meta) throw new Error("That guide isn't in the library.");
    add(view, [header(null, "#/", "Guides"), el("p", { class: "muted", text: "Loading…" })]);
    return loadItem(id).then(function (it) {
      view.innerHTML = "";
      add(view, header(null, "#/", TYPES[it.type] || "Guides"));
      if (it.type !== "basic") add(view, mediaSlot(it));
      add(view, [
        el("div", { class: "muted", text: (TYPES[it.type] || "").replace(/s$/, "") + (it.minutes ? " · " + it.minutes + " min" : "") }),
        el("h2", { text: it.title }),
        it.summary ? el("p", { class: "summary", text: it.summary }) : null
      ]);
      if (it.type === "guide") add(view, deviceSection(it, meta));
      add(view, blocks(it.blocks || []));
      if (it.type === "guide") add(view, stepsSection(it, meta));
      if (it.after) add(view, blocks(it.after));
      if (it.source) {
        add(view, el("div", { class: "source" },
          "Based on ", el("em", { text: it.source.title }), it.source.author ? " by " + it.source.author : "", ". ",
          it.source.url ? el("a", { href: it.source.url, target: "_blank", rel: "noopener", text: "Original" }) : null,
          it.source.note ? el("div", { text: it.source.note }) : null));
      }
    });
  }

  function mediaSlot(it) {
    if (it.media && it.media.src) {
      return it.media.kind === "video"
        ? el("video", { class: "media", src: it.media.src, controls: true, playsinline: true, preload: "metadata" })
        : el("img", { class: "media", src: it.media.src, alt: it.media.alt || "" });
    }
    return el("div", { class: "media", role: "img", "aria-label": "Sample placeholder" },
      el("b", { text: "▶" }), el("span", { text: "Sample " + (it.mode === "video" ? "clip" : "photo") }),
      el("span", { text: "Placeholder until your own shot is added" }));
  }

  var chosenDevice = null, chosenFor = null;
  function deviceSection(it, meta) {
    if (chosenFor !== it.id) { chosenDevice = null; chosenFor = it.id; }
    var kit = kitDevices();
    var wrap = el("div");
    if (!kit.length) return el("p", { class: "muted" }, "Add your camera in ", el("a", { href: "#/kit", text: "My kit" }), " to see steps for it.");
    var current = chosenDevice && kit.some(function (d) { return d.id === chosenDevice; }) ? chosenDevice : (deviceFor(meta) || kit[0]).id;
    var sel = el("select", {
      id: "dev", onchange: function () { chosenDevice = sel.value; route(); }
    }, kit.map(function (d) {
      var s = support(meta, d);
      var label = d.name + " · " + (s.status === "ok" ? "Available" : s.status === "unavailable" ? "Feature unavailable" : "Not checked yet");
      return el("option", { value: d.id, selected: d.id === current, text: label });
    }));
    add(wrap, [el("label", { for: "dev", class: "lab", text: "Steps for" }), sel]);
    var s = support(meta, device(current));
    if (s.status === "unavailable") {
      add(wrap, el("div", { class: "note no" }, el("strong", { text: "Feature unavailable. " }), s.note || ""));
    } else if (s.status === "unchecked") {
      add(wrap, el("div", { class: "note warn", text: s.note || ("Device steps not written yet for " + device(current).name + ". Showing general steps.") }));
    }
    it._device = current;
    return wrap;
  }

  function stepsSection(it, meta) {
    var s = support(meta, device(it._device));
    var steps = (s && s.status === "ok" && s.steps) ? s.steps : it.steps || [];
    var key = "ticks:" + it.id + ":" + (s && s.status === "ok" ? it._device : "general");
    var ticks = store(key) || [];
    var out = [el("div", { class: "lab", text: "Steps · tap to tick" })];
    out.push(el("ol", { class: "steps" }, steps.map(function (text, i) {
      var li = el("li", {
        class: ticks.indexOf(i) !== -1 ? "done" : "", tabindex: "0", role: "checkbox",
        "aria-checked": String(ticks.indexOf(i) !== -1)
      }, el("span", null, rich(text)));
      function toggle() {
        var at = ticks.indexOf(i);
        if (at === -1) ticks.push(i); else ticks.splice(at, 1);
        li.classList.toggle("done"); li.setAttribute("aria-checked", String(at === -1));
        store(key, ticks);
      }
      li.addEventListener("click", toggle);
      li.addEventListener("keydown", function (e) { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(); } });
      return li;
    })));
    if (s && s.status === "ok" && s.note) out.push(el("div", { class: "note ok", text: s.note }));
    if (ticks.length) out.push(el("button", {
      type: "button", class: "btn ghost", text: "Clear ticks", style: "margin-top:10px",
      onclick: function () { store(key, []); route(); }
    }));
    return out;
  }

  function blocks(list) {
    return list.map(function (b) {
      switch (b.t) {
        case "p": return el("p", null, rich(b.text));
        case "h": return el("h3", { text: b.text });
        case "list": return el("ul", { class: "list" }, b.items.map(function (x) { return el("li", null, rich(x)); }));
        case "note": return el("div", { class: "note " + (b.tone || "warn") }, rich(b.text));
        case "tips": return el("div", { class: "tips" }, el("b", { text: b.title || "Tips" }),
          el("ul", null, b.items.map(function (x) { return el("li", null, rich(x)); })));
        case "scale": return el("div", { class: "scale" },
          el("ol", null, b.values.map(function (v) { return el("li", { text: v }); })),
          el("div", { class: "ends" }, el("span", { text: "← " + b.left }), el("span", { text: b.right + " →" })));
        case "table": return el("div", { class: "tablewrap" }, el("table", null,
          el("thead", null, el("tr", null, b.head.map(function (h) { return el("th", { scope: "col", text: h }); }))),
          el("tbody", null, b.rows.map(function (r) { return el("tr", null, r.map(function (c) { return el("td", null, rich(c)); })); }))));
        case "settings": return el("div", { class: "card", style: "margin:8px 0" },
          el("div", { class: "settings" }, b.items.map(function (p) { return el("div", null, p[0], el("b", { text: p[1] })); })),
          b.note ? el("div", { class: "calcline", text: b.note }) : null);
        case "kit": return el("div", null, el("div", { class: "lab", text: "Kit" }),
          el("div", { class: "chips" }, b.items.map(function (x) { return el("span", { class: "chip", text: x }); })));
        case "tool": return el("a", { class: "btn ghost", href: "#/tools/" + b.tool, style: "margin:10px 0", text: b.text || "Open the calculator" });
        case "more": return el("details", null, el("summary", { text: b.title }), el("div", null, blocks(b.blocks)));
        case "link": return el("p", null, el("a", { href: "#/item/" + b.id, text: b.text }));
        default: return null;
      }
    });
  }

  // ---------- My kit ----------
  function renderKit() {
    var custom = { name: "", type: "camera" };
    function toggleKit(id) {
      var at = state.kit.indexOf(id);
      if (at === -1) { state.kit.push(id); state.active = id; store("activeDevice", id); toast("Added to my kit"); }
      else { state.kit.splice(at, 1); toast("Removed from my kit"); }
      store("kit", state.kit);
      route();
    }
    var byType = {};
    allDevices().forEach(function (d) { (byType[d.type] = byType[d.type] || []).push(d); });
    var typeNames = TYPE_NAMES;
    add(view, [
      header(null, "#/", "Guides"),
      el("h2", { text: "My kit" }),
      el("p", { class: "muted", text: "Guides and manuals follow the devices you add here. Saved on this phone only." })
    ]);
    Object.keys(byType).forEach(function (t) {
      add(view, el("div", { class: "lab", text: typeNames[t] || t }));
      add(view, byType[t].map(function (d) {
        var inKit = state.kit.indexOf(d.id) !== -1;
        var hasManual = (state.index.manuals || []).some(function (m) { return m.device === d.id && m.status === "ready"; });
        var status = d.custom ? ["General guides only", "no"] : hasManual ? ["Manual + device steps", "ok"] : ["Manual coming", "warn"];
        return el("div", { class: "row" },
          el("span", null, el("b", { text: d.name }), el("span", { class: "pill " + status[1], text: status[0] })),
          el("button", { type: "button", class: "chip rowbtn" + (inKit ? " on" : ""), text: inKit ? "✓ In kit" : "Add",
            "aria-pressed": String(inKit), onclick: function () { toggleKit(d.id); } }));
      }));
    });
    var nameIn = el("input", { id: "cname", type: "text", placeholder: "e.g. Fujifilm X-T5", oninput: function (e) { custom.name = e.target.value; } });
    var typeIn = el("select", { id: "ctype", onchange: function (e) { custom.type = e.target.value; } },
      ["camera", "drone", "action", "flash", "phone"].map(function (t) { return el("option", { value: t, text: (typeNames[t] || t).replace(/s$/, "") }); }));
    add(view, [
      el("div", { class: "lab", text: "Not listed?" }),
      el("div", { class: "card" },
        el("div", { class: "grid2" },
          el("div", null, el("label", { for: "cname", class: "f", text: "Device name" }), nameIn),
          el("div", null, el("label", { for: "ctype", class: "f", text: "Type" }), typeIn)),
        el("p", { class: "muted", text: "Your own devices get the general guides. Send the manual to Claude to get device steps added to the shared library." }),
        el("button", { type: "button", class: "btn", text: "Add my device", onclick: function () {
          var name = custom.name.trim();
          if (!name) { toast("Type the device name first"); nameIn.focus(); return; }
          var id = "custom-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
          if (!device(id)) { state.custom.push({ id: id, name: name, type: custom.type, custom: true }); store("customDevices", state.custom); }
          if (state.kit.indexOf(id) === -1) { state.kit.push(id); store("kit", state.kit); }
          state.active = id; store("activeDevice", id);
          toast(name + " added"); route();
        } }))
    ]);
  }

  // ---------- Manuals ----------
  function renderManuals() {
    add(view, [header("Manuals"), el("p", { class: "muted", text: "Quick reference for the devices in your kit." })]);
    var kit = kitDevices();
    if (!kit.length) { add(view, el("a", { class: "btn", href: "#/kit", text: "Add a device" })); return; }
    add(view, kit.map(function (d) {
      var m = (state.index.manuals || []).filter(function (x) { return x.device === d.id; })[0];
      var status = !m ? ["No manual yet", "no"] : m.status === "ready" ? ["Offline", "ok"] : ["Being written", "warn"];
      return el("a", { class: "row", href: "#/manual/" + d.id },
        el("span", null, el("b", { text: d.name }), el("span", { class: "muted", text: m && m.summary ? m.summary : "General guides still apply" })),
        el("span", { class: "pill " + status[1], text: status[0] }));
    }));
  }
  function renderManual(id) {
    var d = device(id);
    if (!d) throw new Error("That device isn't in the catalogue.");
    add(view, header(null, "#/manuals", "Manuals"));
    return loadManual(id).then(function (m) {
      add(view, el("h2", { text: d.name }));
      if (!m || m.status !== "ready") {
        add(view, [
          el("div", { class: "note warn", text: (m && m.message) || "No manual for this device yet." }),
          el("p", { class: "muted", text: "Once the manual is summarised it appears here and downloads for offline use on the next sync." })
        ]);
        if (m && m.planned) add(view, [el("div", { class: "lab", text: "Planned sections" }),
          el("ul", { class: "list" }, m.planned.map(function (x) { return el("li", { text: x }); }))]);
        return;
      }
      if (m.specs) add(view, [el("div", { class: "lab", text: "Key specs" }), el("div", { class: "tablewrap" }, el("table", null, el("tbody", null,
        m.specs.map(function (r) { return el("tr", null, el("td", { text: r[0] }), el("td", { text: r[1] })); }))))]);
      add(view, el("div", { class: "lab", text: "Quick reference" }));
      add(view, (m.sections || []).map(function (s) {
        return el("details", null, el("summary", { text: s.title }), el("div", null, blocks(s.blocks || []),
          s.usedIn ? el("p", { class: "muted" }, "Used in: ", s.usedIn.map(function (gid, i) {
            var meta = findMeta(gid);
            return [i ? ", " : "", el("a", { href: "#/item/" + gid, text: meta ? meta.title : gid })];
          })) : null));
      }));
      if (m.source) add(view, el("div", { class: "source" }, "Summarised from the official manual. ",
        m.source.url ? el("a", { href: m.source.url, target: "_blank", rel: "noopener", text: "Full manual" }) : null));
    });
  }

  // ---------- Tools ----------
  function fmtShutter(t) {
    if (!isFinite(t) || t <= 0) return "–";
    if (t >= 60) { var m = Math.floor(t / 60), s = Math.round(t % 60); return m + " min" + (s ? " " + s + " s" : ""); }
    if (t >= 0.4) return (t < 10 ? Math.round(t * 10) / 10 : Math.round(t)) + " s";
    // Snap to the shutter speeds cameras actually offer (1/3-stop steps).
    var d = 1 / t, best = STOPS[0];
    STOPS.forEach(function (s) { if (Math.abs(Math.log(s / d)) < Math.abs(Math.log(best / d))) best = s; });
    return "1/" + best;
  }
  var STOPS = [8000, 6400, 5000, 4000, 3200, 2500, 2000, 1600, 1250, 1000, 800, 640, 500, 400, 320, 250, 200, 160,
    125, 100, 80, 60, 50, 40, 30, 25, 20, 15, 13, 10, 8, 6, 5, 4, 3];
  var EV_PRESETS = [
    [16, "Snow or sand, full sun"], [15, "Full sun, clear sky"], [14, "Hazy sun, soft shadows"],
    [13, "Bright overcast"], [12, "Heavy overcast or open shade"], [11, "Sunset, low sun"],
    [9, "Just after sunset"], [8, "Bright interior"], [7, "Normal interior, floodlit building"],
    [5, "Night street, city lights"], [-3, "Landscape under full moon"], [-7, "Milky Way, no moon"]
  ];
  function numSelect(id, values, selected, labelFn) {
    return el("select", { id: id }, values.map(function (v) {
      return el("option", { value: v, selected: String(v) === String(selected), text: labelFn ? labelFn(v) : String(v) });
    }));
  }

  function renderTools(tab) {
    var tabs = [["exposure", "Exposure"], ["nd", "ND filter"], ["timelapse", "Time-lapse"], ["stars", "Stars"]];
    add(view, [header("Tools"),
      el("div", { class: "chips", role: "tablist" }, tabs.map(function (t) {
        return el("a", { class: "chip" + (t[0] === tab ? " on" : ""), href: "#/tools/" + t[0], role: "tab", "aria-selected": String(t[0] === tab), text: t[1] });
      }))]);
    var box = el("div", { style: "margin-top:12px" });
    add(view, box);
    ({ exposure: toolExposure, nd: toolND, timelapse: toolTimelapse, stars: toolStars }[tab] || toolExposure)(box);
  }

  function toolExposure(box) {
    var ev = store("ev") != null ? store("ev") : 15;
    var evSel = el("select", { id: "ev" }, EV_PRESETS.map(function (p) {
      return el("option", { value: p[0], selected: p[0] === ev, text: p[1] + " (EV " + p[0] + ")" });
    }));
    var measured = el("option", { value: "m", text: "Measured", hidden: true });
    evSel.appendChild(measured);
    var ap = numSelect("ap", [1.4, 1.8, 2, 2.8, 4, 5.6, 8, 11, 16, 22], 8, function (v) { return "f/" + v; });
    var iso = numSelect("iso", [100, 200, 400, 800, 1600, 3200, 6400], 100);
    var nd = numSelect("nd", [0, 3, 6, 10], 0, function (v) { return v ? "ND" + Math.pow(2, v) + " (" + v + " stops)" : "None"; });
    var out = el("div", { class: "big", text: "–" });
    var hint = el("div", { class: "muted" });
    var meterMsg = el("div", { class: "muted", style: "margin-top:6px" });
    var meterBtn = el("button", { type: "button", class: "btn ghost", style: "margin-top:10px", text: "Meter with phone camera" });

    function calc() {
      if (evSel.value !== "m") { ev = +evSel.value; store("ev", ev); }
      var N = +ap.value, I = +iso.value, s = +nd.value;
      var t = (N * N) / Math.pow(2, ev + Math.log2(I / 100)) * Math.pow(2, s);
      out.textContent = fmtShutter(t);
      hint.textContent = t > 30 ? "Longer than 30 s: use Bulb mode and a remote." :
        t > 1 / 30 ? "Use a tripod or a steady surface." :
        t < 1 / 8000 ? "Faster than most shutters: close the aperture, lower ISO or add ND." : "Handheld is fine.";
    }
    [evSel, ap, iso, nd].forEach(function (s) { s.addEventListener("change", calc); });

    meterBtn.addEventListener("click", function () {
      meterBtn.disabled = true; meterBtn.textContent = "Metering…"; meterMsg.textContent = "";
      meterScene().then(function (r) {
        ev = r.ev; measured.hidden = false; measured.textContent = "Measured: EV " + r.ev.toFixed(1); evSel.value = "m";
        meterMsg.textContent = "Phone estimate, about ±1 stop. Check your camera's histogram.";
        calc();
      }).catch(function (e) {
        meterMsg.textContent = e.message;
      }).then(function () { meterBtn.disabled = false; meterBtn.textContent = "Meter again"; });
    });

    add(box, [
      el("div", { class: "card" },
        el("label", { for: "ev", class: "f", text: "Light" }), evSel, meterBtn, meterMsg),
      el("div", { class: "grid3", style: "margin-top:10px" },
        el("div", null, el("label", { for: "ap", class: "f", text: "Aperture" }), ap),
        el("div", null, el("label", { for: "iso", class: "f", text: "ISO" }), iso),
        el("div", null, el("label", { for: "nd", class: "f", text: "ND" }), nd)),
      el("div", { class: "card", style: "margin-top:10px" },
        el("div", { class: "lab", style: "margin-top:0", text: "Shutter speed" }), out, hint),
      el("p", { class: "muted", text: "Light values are starting points for an average scene. Backlit or very bright or dark subjects need exposure compensation." })
    ]);
    calc();
  }

  // Phone light meter. Needs the browser to report the camera's own exposure
  // time and ISO (Chrome on Android does; Safari on iPhone does not). The frame
  // brightness then corrects that reading towards a mid-grey scene.
  function meterScene() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(new Error("This browser can't use the camera. Pick the light from the list instead."));
    }
    var stream;
    return navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }).then(function (s) {
      stream = s;
      var video = el("video", { playsinline: true, muted: true });
      video.srcObject = s;
      return video.play().then(function () { return new Promise(function (r) { setTimeout(r, 1500); }); }).then(function () {
        var track = s.getVideoTracks()[0];
        var st = track.getSettings ? track.getSettings() : {};
        if (!st.exposureTime || !st.iso) {
          throw new Error("This phone's browser doesn't share the camera's exposure data, so it can't meter. Pick the light from the list instead.");
        }
        var t = st.exposureTime / 10000;           // spec unit: 100 microseconds
        var N = 1.8;                                // typical phone main camera
        var ev100 = Math.log2((N * N) / t) - Math.log2(st.iso / 100);
        var c = document.createElement("canvas"); c.width = 64; c.height = 48;
        var g = c.getContext("2d"); g.drawImage(video, 0, 0, 64, 48);
        var px = g.getImageData(0, 0, 64, 48).data, sum = 0;
        for (var i = 0; i < px.length; i += 4) {
          var y = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
          sum += y <= 0.04045 ? y / 12.92 : Math.pow((y + 0.055) / 1.055, 2.4);
        }
        var mean = Math.max(sum / (px.length / 4), 0.001);
        return { ev: Math.max(-8, Math.min(18, ev100 + Math.log2(mean / 0.18))) };
      });
    }).then(function (r) { stop(); return r; }, function (e) {
      stop();
      if (e && e.name === "NotAllowedError") throw new Error("Camera permission was refused. Allow it in the browser settings to meter.");
      throw e;
    });
    function stop() { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); }
  }

  function toolND(box) {
    var shutters = [1 / 4000, 1 / 2000, 1 / 1000, 1 / 500, 1 / 250, 1 / 125, 1 / 60, 1 / 30, 1 / 15, 1 / 8, 1 / 4, 1 / 2, 1, 2];
    var base = el("select", { id: "base" }, shutters.map(function (t) { return el("option", { value: t, selected: t === 1 / 125, text: fmtShutter(t) }); }));
    var nd = numSelect("nd2", [1, 2, 3, 4, 6, 8, 10, 13, 15], 6, function (v) { return v + " stops (ND" + Math.pow(2, v) + ")"; });
    var out = el("div", { class: "big" });
    function calc() { out.textContent = fmtShutter(+base.value * Math.pow(2, +nd.value)); }
    base.addEventListener("change", calc); nd.addEventListener("change", calc);
    add(box, [
      el("p", { text: "Meter without the filter, then add the filter and use this shutter speed." }),
      el("div", { class: "grid2" },
        el("div", null, el("label", { for: "base", class: "f", text: "Shutter without filter" }), base),
        el("div", null, el("label", { for: "nd2", class: "f", text: "Filter" }), nd)),
      el("div", { class: "card", style: "margin-top:10px" }, el("div", { class: "lab", style: "margin-top:0", text: "Shutter with filter" }), out),
      el("p", { class: "muted", text: "Common names: ND8 = 3 stops, ND64 = 6 stops, ND1000 = 10 stops." })
    ]);
    calc();
  }

  function toolTimelapse(box) {
    var interval = el("input", { id: "int", type: "number", min: "0.5", step: "0.5", value: "3", inputmode: "decimal" });
    var clip = el("input", { id: "clip", type: "number", min: "1", step: "1", value: "10", inputmode: "numeric" });
    var fps = numSelect("fps", [24, 25, 30, 60], 30);
    var shots = el("div", { class: "big" }), dur = el("div", { class: "muted" });
    function calc() {
      var n = Math.ceil(+clip.value * +fps.value);
      shots.textContent = isFinite(n) && n > 0 ? n + " shots" : "–";
      dur.textContent = "Shooting time: " + fmtShutter(n * +interval.value);
    }
    [interval, clip, fps].forEach(function (i) { i.addEventListener("input", calc); i.addEventListener("change", calc); });
    add(box, [
      el("div", { class: "grid3" },
        el("div", null, el("label", { for: "int", class: "f", text: "Interval (s)" }), interval),
        el("div", null, el("label", { for: "clip", class: "f", text: "Clip (s)" }), clip),
        el("div", null, el("label", { for: "fps", class: "f", text: "Frame rate" }), fps)),
      el("div", { class: "card", style: "margin-top:10px" }, shots, dur),
      el("table", { style: "margin-top:12px" },
        el("thead", null, el("tr", null, el("th", { text: "Subject" }), el("th", { text: "Interval" }))),
        el("tbody", null, [["Fast clouds, traffic", "1–2 s"], ["Sunset, slow clouds", "3–5 s"], ["Stars moving", "15–30 s"], ["Plants growing, building work", "minutes"]]
          .map(function (r) { return el("tr", null, el("td", { text: r[0] }), el("td", { text: r[1] })); })))
    ]);
    calc();
  }

  function toolStars(box) {
    var dev = activeDevice();
    var crop = dev && dev.crop ? dev.crop : 1;
    var fl = el("input", { id: "fl", type: "number", min: "8", step: "1", value: "18", inputmode: "numeric" });
    var cr = numSelect("crop", [1, 1.5, 1.6, 2], crop, function (v) { return v === 1 ? "Full frame (1×)" : v === 2 ? "Micro 4/3 (2×)" : "APS-C (" + v + "×)"; });
    var out = el("div", { class: "big" }), strict = el("div", { class: "muted" });
    function calc() {
      var eq = +fl.value * +cr.value;
      out.textContent = fmtShutter(500 / eq);
      strict.textContent = "Sharper stars on high-resolution sensors: about " + fmtShutter(300 / eq) + " (300 rule).";
    }
    fl.addEventListener("input", calc); cr.addEventListener("change", calc);
    add(box, [
      el("p", { text: "Longest shutter speed before stars start to streak." }),
      el("div", { class: "grid2" },
        el("div", null, el("label", { for: "fl", class: "f", text: "Focal length (mm)" }), fl),
        el("div", null, el("label", { for: "crop", class: "f", text: "Sensor" }), cr)),
      el("div", { class: "card", style: "margin-top:10px" }, el("div", { class: "lab", style: "margin-top:0", text: "Max shutter (500 rule)" }), out, strict),
      el("p", { class: "muted", text: dev && dev.crop ? "Sensor set from " + dev.name + "." : "Pick your sensor size." })
    ]);
    calc();
  }

  // ---------- Updates ----------
  function renderUpdates() {
    var last = store("lastSync");
    var libV = store("libVersion");
    var count = state.index.items.length;
    var status = el("div", { class: "muted", text: last ? "Last synced " + new Date(last).toLocaleString() : "Not fully downloaded yet." });
    var btn = el("button", { type: "button", class: "btn", text: "Check for updates", style: "margin-top:12px" });
    btn.addEventListener("click", function () {
      if (!navigator.onLine) { toast("No signal. Your saved library still works."); return; }
      btn.disabled = true; btn.textContent = "Checking…";
      loadIndex(true).then(function (idx) {
        var isNew = idx.version !== libV;
        state.items = {}; state.manuals = {};
        btn.textContent = "Downloading…";
        return downloadLibrary(true).then(function (n) {
          toast(isNew ? "Updated: " + n + " files saved for offline" : "Up to date");
          route();
        });
      }).catch(function () {
        toast("Couldn't reach the library. Try again with signal.");
        btn.disabled = false; btn.textContent = "Check for updates";
      });
    });
    var kinds = { "new": ["New", "ok"], updated: ["Updated", "no"], coming: ["Coming", "warn"] };
    add(view, [
      header("Updates"),
      el("div", { class: "card" },
        el("div", { class: "muted", text: "Saved on this phone" }),
        el("div", { style: "font-size:24px;font-weight:800", text: count + " guides, basics and lessons" }),
        status, btn),
      el("div", { class: "lab", text: "What's new" }),
      (state.index.changes || []).map(function (c) {
        var k = kinds[c.kind] || kinds.updated;
        return el("div", { class: "row" }, el("span", null, c.text, el("span", { class: "muted", text: " · " + c.date })), el("span", { class: "pill " + k[1], text: k[0] }));
      }),
      el("div", { class: "lab", text: "Theme" }),
      el("div", { class: "seg", role: "group", "aria-label": "Theme" }, THEMES.map(function (t) {
        return el("button", { type: "button", class: state.theme === t ? "on" : "", "aria-pressed": String(state.theme === t), text: THEME_LABEL[t],
          onclick: function () { applyTheme(t); route(); } });
      })),
      el("p", { class: "muted", text: "Day is high contrast for bright sun. Night is red, so your eyes stay adjusted to the dark." }),
      el("div", { class: "lab", text: "Install" }),
      el("p", { class: "muted", text: "iPhone: Safari › Share › Add to Home Screen. Android: Chrome menu › Install app. Installing keeps the library saved; a plain browser tab can lose it after a few weeks." }),
      el("p", { class: "muted", text: "Library version " + (state.index.version || "–") })
    ]);
  }

  // ---------- start ----------
  applyTheme(state.theme);
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(function () { /* offline support unavailable */ });
  }
  loadIndex().then(function (idx) {
    window.addEventListener("hashchange", route);
    route();
    // First run, or a new library version: save every file for offline use.
    if (store("libVersion") !== idx.version) {
      downloadLibrary().then(function (n) { if (store("lastSync")) toast("Library saved for offline (" + n + " files)"); })
        .catch(function () { /* will retry next launch */ });
    }
  }).catch(function () {
    add(view, [header("Field Photo"), el("div", { class: "note warn", text: "The library hasn't downloaded yet. Open the app once with signal." })]);
  });
})();
