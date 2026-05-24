/**
 * CabinesDEssayage.fr — Widget embarquable
 *
 * Intégration Shopify (theme.liquid avant </body>) :
 *   <script src="https://cabinesdessayage.fr/embed.js"
 *           data-app-url="https://cabinesdessayage.fr"
 *           data-delay="2500"
 *           data-label="Essayer virtuellement"
 *           async></script>
 */
(function () {
  if (window.__cabinesEmbedded) return;
  window.__cabinesEmbedded = true;

  function getConfigScript() {
    var byId = document.getElementById("cabines-embed");
    if (byId && byId.src && byId.src.indexOf("embed.js") !== -1) return byId;
    if (document.currentScript) return document.currentScript;
    var scripts = document.getElementsByTagName("script");
    for (var i = scripts.length - 1; i >= 0; i--) {
      if (scripts[i].src && scripts[i].src.indexOf("embed.js") !== -1) {
        return scripts[i];
      }
    }
    return null;
  }

  function resolveAppUrl(ds) {
    var fromAttr = ds.appUrl && String(ds.appUrl).trim();
    if (fromAttr) return fromAttr.replace(/\/$/, "");
    // Local dev / demo : même origine que la page marchande
    if (typeof window !== "undefined" && window.location && window.location.origin) {
      return window.location.origin.replace(/\/$/, "");
    }
    return "https://cabinesdessayage.fr";
  }

  var scriptEl = getConfigScript();
  var ds = (scriptEl && scriptEl.dataset) || {};
  var APP_URL = resolveAppUrl(ds);
  var DELAY = parseInt(ds.delay || "2500", 10);
  var LABEL = ds.label || "Essayer virtuellement";
  var PAGES = ds.pages || "product";
  var POSITION = ds.position === "left" ? "left" : "right";
  var COLOR = ds.color || "#7A1F2B";

  function isProductPage() {
    if (PAGES === "all") return true;
    var path = window.location.pathname;
    if (path.indexOf("/products/") !== -1) return true;
    if (path.indexOf("/demo") !== -1) return true;
    try {
      if (window.ShopifyAnalytics && window.ShopifyAnalytics.meta &&
          window.ShopifyAnalytics.meta.product) return true;
    } catch (e) {}
    if (document.querySelector('meta[property="og:type"][content="product"]'))
      return true;
    return false;
  }

  /** Resolve relative / localhost image URLs to the current page origin (LAN-safe). */
  function normalizeImageUrl(url) {
    if (!url) return "";
    var resolved = String(url).trim();
    if (!resolved) return "";

    if (resolved.indexOf("//") === 0) {
      resolved = window.location.protocol + resolved;
    } else if (resolved.charAt(0) === "/") {
      resolved = window.location.origin + resolved;
    }

    try {
      var parsed = new URL(resolved);
      var localHosts = ["localhost", "127.0.0.1"];
      var curHost = window.location.hostname;
      if (
        localHosts.indexOf(parsed.hostname) !== -1 &&
        localHosts.indexOf(curHost) === -1
      ) {
        parsed.hostname = curHost;
        parsed.port = window.location.port;
        parsed.protocol = window.location.protocol;
        resolved = parsed.toString();
      }
    } catch (e) {}

    return resolved;
  }

  /** Pick the largest variant from an `srcset` declaration. */
  function bestFromSrcset(srcset) {
    if (!srcset) return "";
    var best = { url: "", w: 0 };
    var parts = srcset.split(",");
    for (var i = 0; i < parts.length; i++) {
      var seg = parts[i].trim().split(/\s+/);
      if (!seg[0]) continue;
      var w = 0;
      if (seg[1]) {
        var m = seg[1].match(/(\d+)w/);
        if (m) w = parseInt(m[1], 10);
        else {
          var d = seg[1].match(/([\d.]+)x/);
          if (d) w = Math.round(parseFloat(d[1]) * 1000);
        }
      }
      if (w >= best.w) best = { url: seg[0], w: w };
    }
    return best.url;
  }

  function isLikelyJunkUrl(url) {
    if (!url) return true;
    var u = url.toLowerCase();
    if (u.indexOf("data:") === 0 && u.length < 1500) return true;
    if (/(logo|icon|favicon|sprite|placeholder|swatch|thumb|loader|spinner)/.test(u))
      return true;
    return false;
  }

  /** Score a candidate {url, w, h, meta}. Higher is better. */
  function scoreCandidate(c) {
    if (!c.url || isLikelyJunkUrl(c.url)) return -1;
    var w = c.w || 0;
    var h = c.h || 0;
    var area = w * h;
    var score = 0;
    score += Math.min(area, 4000000) / 1000;     // bigger = better, capped
    score += Math.min(Math.max(w, h), 2000) / 5; // longest side bonus
    if (c.priority) score += c.priority;          // explicit signal
    if (w && h) {
      var ratio = Math.max(w, h) / Math.max(1, Math.min(w, h));
      if (ratio > 4) score -= 200; // very thin → likely banner
    }
    if (w > 0 && w < 200) score -= 300; // tiny
    return score;
  }

  function pushCandidate(list, url, w, h, priority) {
    if (!url) return;
    list.push({
      url: normalizeImageUrl(url),
      w: w || 0,
      h: h || 0,
      priority: priority || 0,
    });
  }

  /** Walk DOM + JSON-LD + meta tags to build candidates, then return the best. */
  function findBestProductImage() {
    var candidates = [];

    // 1. Explicit override from <script data-product-image="...">
    if (ds.productImage) {
      pushCandidate(candidates, ds.productImage, 0, 0, 10000);
    }

    // 2. Shopify featured image (best signal on Shopify themes)
    try {
      var meta = window.ShopifyAnalytics &&
        window.ShopifyAnalytics.meta &&
        window.ShopifyAnalytics.meta.product;
      if (meta) {
        if (meta.featured_image) pushCandidate(candidates, meta.featured_image, 0, 0, 8000);
        if (meta.images && meta.images.length) {
          for (var i = 0; i < meta.images.length; i++) {
            pushCandidate(candidates, meta.images[i], 0, 0, 4000 - i * 50);
          }
        }
      }
    } catch (e) {}

    // 3. JSON-LD Product schema
    try {
      var ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (var s = 0; s < ldScripts.length; s++) {
        try {
          var data = JSON.parse(ldScripts[s].textContent || "null");
          var nodes = Array.isArray(data) ? data : [data];
          for (var n = 0; n < nodes.length; n++) {
            var node = nodes[n];
            if (!node) continue;
            // Handle @graph wrapper
            var inner = node["@graph"] && Array.isArray(node["@graph"]) ? node["@graph"] : [node];
            for (var k = 0; k < inner.length; k++) {
              var d = inner[k];
              if (!d) continue;
              var type = d["@type"];
              var isProduct = type === "Product" ||
                (Array.isArray(type) && type.indexOf("Product") !== -1);
              if (!isProduct) continue;
              var img = d.image;
              if (!img) continue;
              if (typeof img === "string") {
                pushCandidate(candidates, img, 0, 0, 7000);
              } else if (Array.isArray(img)) {
                for (var ii = 0; ii < img.length; ii++) {
                  var v = img[ii];
                  if (typeof v === "string") pushCandidate(candidates, v, 0, 0, 6000 - ii * 50);
                  else if (v && v.url) pushCandidate(candidates, v.url, v.width || 0, v.height || 0, 6000 - ii * 50);
                }
              } else if (img && img.url) {
                pushCandidate(candidates, img.url, img.width || 0, img.height || 0, 7000);
              }
            }
          }
        } catch (eIn) {}
      }
    } catch (e) {}

    // 4. og:image / twitter:image
    var og = document.querySelector('meta[property="og:image"]');
    if (og && og.content) pushCandidate(candidates, og.content, 0, 0, 3000);
    var ogW = parseInt((document.querySelector('meta[property="og:image:width"]') || {}).content || "0", 10);
    var ogH = parseInt((document.querySelector('meta[property="og:image:height"]') || {}).content || "0", 10);
    if (og && og.content && (ogW || ogH)) {
      // patch the previous push with dimensions
      var last = candidates[candidates.length - 1];
      if (last) { last.w = ogW; last.h = ogH; }
    }
    var tw = document.querySelector('meta[name="twitter:image"]');
    if (tw && tw.content) pushCandidate(candidates, tw.content, 0, 0, 2500);

    // 5. <link rel="image_src">
    var linkSrc = document.querySelector('link[rel="image_src"]');
    if (linkSrc && linkSrc.href) pushCandidate(candidates, linkSrc.href, 0, 0, 2000);

    // 6. DOM scan: prefer images inside known product containers
    var productScopes = [
      "[data-product-featured-image]",
      ".product-single__photos",
      ".product__media",
      ".product-gallery",
      ".product__photo",
      "[data-product-media]",
      "main [class*='product']",
      "main",
    ];
    for (var p = 0; p < productScopes.length; p++) {
      var roots = document.querySelectorAll(productScopes[p]);
      for (var r = 0; r < roots.length; r++) {
        // Try <picture><source srcset>
        var sources = roots[r].querySelectorAll("source[srcset]");
        for (var ss = 0; ss < sources.length; ss++) {
          var url = bestFromSrcset(sources[ss].getAttribute("srcset"));
          if (url) pushCandidate(candidates, url, 0, 0, 1500 - p * 100);
        }
        var imgs = roots[r].querySelectorAll("img");
        for (var im = 0; im < imgs.length; im++) {
          var el = imgs[im];
          var srcset = el.getAttribute("srcset");
          var u = (srcset && bestFromSrcset(srcset)) || el.currentSrc || el.src;
          var w = el.naturalWidth || parseInt(el.getAttribute("width") || "0", 10) || 0;
          var h = el.naturalHeight || parseInt(el.getAttribute("height") || "0", 10) || 0;
          pushCandidate(candidates, u, w, h, 1000 - p * 100);
        }
      }
    }

    // Score & pick the best
    var best = null;
    var bestScore = -Infinity;
    for (var c = 0; c < candidates.length; c++) {
      var sc = scoreCandidate(candidates[c]);
      if (sc > bestScore) {
        bestScore = sc;
        best = candidates[c];
      }
    }
    return best ? best.url : "";
  }

  function detectProductInfo() {
    var info = { title: "", image: "", url: window.location.href };

    info.image = findBestProductImage();

    try {
      if (window.ShopifyAnalytics && window.ShopifyAnalytics.meta &&
          window.ShopifyAnalytics.meta.product) {
        info.title = window.ShopifyAnalytics.meta.product.title || info.title;
      }
    } catch (e) {}
    if (!info.title) {
      var ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle && ogTitle.content) info.title = ogTitle.content.trim();
    }
    if (!info.title) {
      var h1 = document.querySelector("h1");
      if (h1) info.title = h1.textContent.trim();
    }

    return info;
  }

  function injectStyles() {
    if (document.getElementById("cabines-embed-styles")) return;
    var style = document.createElement("style");
    style.id = "cabines-embed-styles";
    style.textContent = [
      "@keyframes cab-rise{0%{transform:translateY(120%) scale(.85);opacity:0}100%{transform:translateY(0) scale(1);opacity:1}}",
      "@keyframes cab-pulse{0%{box-shadow:0 10px 28px rgba(122,31,43,.32),0 0 0 0 rgba(201,169,110,.55)}70%{box-shadow:0 10px 28px rgba(122,31,43,.32),0 0 0 16px rgba(201,169,110,0)}100%{box-shadow:0 10px 28px rgba(122,31,43,.32),0 0 0 0 rgba(201,169,110,0)}}",
      "@keyframes cab-fadein{from{opacity:0}to{opacity:1}}",
      "@keyframes cab-zoomin{from{transform:scale(.92);opacity:0}to{transform:scale(1);opacity:1}}",
      "@keyframes cab-spin{to{transform:rotate(360deg)}}",
      "@keyframes cab-shirt-cycle{0%,2%{transform:translateY(-9px) scale(.85);opacity:0}10%,28%{transform:translateY(0) scale(1);opacity:1}33%,100%{transform:translateY(2px) scale(.95);opacity:0}}",
      "@keyframes cab-arm-l{0%,15%,45%,100%{transform:rotate(0)}25%,35%{transform:rotate(-30deg)}}",
      "@keyframes cab-arm-r{0%,15%,45%,100%{transform:rotate(0)}25%,35%{transform:rotate(30deg)}}",
      "@keyframes cab-callout-in{0%{opacity:0;transform:translateY(8px) scale(.92)}100%{opacity:1;transform:translateY(0) scale(1)}}",
      "@keyframes cab-callout-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}",
      "@keyframes cab-dot-pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.25);opacity:.7}}",
      ".cabines-bubble{position:fixed;bottom:24px;z-index:2147483646;display:flex;align-items:center;gap:10px;padding:14px 20px;border:none;border-radius:999px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;font-weight:500;color:#fff;cursor:pointer;animation:cab-rise .55s cubic-bezier(.22,1,.36,1) both,cab-pulse 2.6s ease-out 1.2s 3;box-shadow:0 10px 28px rgba(122,31,43,.32);transition:transform .25s,box-shadow .25s}",
      ".cabines-bubble:hover{transform:translateY(-2px) scale(1.03);box-shadow:0 14px 36px rgba(122,31,43,.45)}",
      ".cabines-bubble:hover .cab-callout{opacity:0;pointer-events:none}",
      ".cabines-bubble .cab-tag{display:inline-block;background:linear-gradient(135deg,#C9A96E,#E0C99A);color:#1A1410;font-size:10px;font-weight:700;padding:2px 7px;border-radius:6px;margin-right:4px;letter-spacing:.3px}",
      // Animated character SVG
      ".cab-char{width:26px;height:30px;flex-shrink:0;overflow:visible}",
      ".cab-char .cab-shirt{transform-origin:center;transform-box:fill-box;animation:cab-shirt-cycle 3.6s cubic-bezier(.22,1,.36,1) infinite}",
      ".cab-char .cab-shirt-2{animation-delay:1.2s}",
      ".cab-char .cab-shirt-3{animation-delay:2.4s}",
      ".cab-char .cab-arm-l{transform-origin:11px 16px;animation:cab-arm-l 3.6s ease-in-out infinite}",
      ".cab-char .cab-arm-r{transform-origin:21px 16px;animation:cab-arm-r 3.6s ease-in-out infinite}",
      // Mobile callout
      ".cabines-bubble .cab-callout{position:absolute;bottom:calc(100% + 14px);background:#fff;color:#1A1410;font-size:13px;font-weight:600;padding:10px 14px;border-radius:14px;box-shadow:0 10px 30px rgba(26,20,16,.18);white-space:nowrap;pointer-events:auto;animation:cab-callout-in .45s cubic-bezier(.22,1,.36,1) both,cab-callout-bob 2.4s ease-in-out 1s infinite;display:flex;align-items:center;gap:8px}",
      ".cabines-bubble[data-pos='right'] .cab-callout{right:0}",
      ".cabines-bubble[data-pos='left'] .cab-callout{left:0}",
      ".cabines-bubble .cab-callout::after{content:'';position:absolute;top:100%;width:14px;height:14px;background:#fff;transform:translateY(-7px) rotate(45deg);box-shadow:3px 3px 6px rgba(26,20,16,.06)}",
      ".cabines-bubble[data-pos='right'] .cab-callout::after{right:18px}",
      ".cabines-bubble[data-pos='left'] .cab-callout::after{left:18px}",
      ".cabines-bubble .cab-callout .cab-tag{margin:0}",
      ".cabines-bubble .cab-callout-close{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border:none;background:rgba(26,20,16,.06);color:#4A4038;border-radius:50%;cursor:pointer;font-size:12px;line-height:1;margin-left:4px}",
      ".cabines-bubble .cab-callout-close:hover{background:rgba(26,20,16,.12)}",
      // Notification dot (mobile)
      ".cabines-bubble .cab-dot{position:absolute;top:6px;right:6px;width:10px;height:10px;background:#C9A96E;border:2px solid #fff;border-radius:50%;animation:cab-dot-pulse 1.6s ease-in-out infinite}",
      ".cabines-bubble[data-pos='left'] .cab-dot{right:auto;left:6px}",
      ".cabines-overlay{position:fixed;inset:0;z-index:2147483647;background:rgba(26,20,16,.65);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:16px;animation:cab-fadein .3s ease-out}",
      ".cabines-modal{position:relative;width:100%;max-width:1080px;height:92vh;max-height:920px;background:#FBF7F2;border-radius:24px;overflow:hidden;box-shadow:0 28px 80px rgba(0,0,0,.45);animation:cab-zoomin .35s cubic-bezier(.22,1,.36,1) both}",
      ".cabines-iframe{width:100%;height:100%;border:none;display:block;background:#FBF7F2}",
      ".cabines-loader{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:#FBF7F2;z-index:5}",
      ".cabines-loader-spinner{width:44px;height:44px;border:3px solid rgba(122,31,43,.15);border-top-color:#7A1F2B;border-radius:50%;animation:cab-spin .8s linear infinite}",
      ".cabines-loader p{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;color:#4A4038;margin:0}",
      ".cabines-close{position:absolute;top:14px;right:14px;width:38px;height:38px;border:none;border-radius:50%;background:rgba(255,255,255,.95);color:#1A1410;font-size:18px;cursor:pointer;z-index:10;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(0,0,0,.18);transition:transform .2s}",
      ".cabines-close:hover{transform:scale(1.1) rotate(90deg);background:#fff}",
      // Mobile: hide inline label, enlarge bubble, keep character + callout + dot visible
      "@media (max-width:640px){",
      " .cabines-bubble .cab-label{display:none}",
      " .cabines-bubble{padding:14px;border-radius:50%;width:64px;height:64px;justify-content:center;animation:cab-rise .55s cubic-bezier(.22,1,.36,1) both,cab-pulse 2.6s ease-out 1.2s infinite}",
      " .cabines-bubble .cab-char{width:34px;height:38px}",
      " .cabines-bubble .cab-callout{bottom:calc(100% + 12px);font-size:12px;padding:9px 12px}",
      " .cabines-overlay{padding:0}",
      " .cabines-modal{height:100vh;max-height:100vh;border-radius:0}",
      " .cabines-close{top:10px;right:10px}",
      "}",
      // Desktop: hide notification dot (label is enough)
      "@media (min-width:641px){.cabines-bubble .cab-dot{display:none}}"
    ].join("");
    document.head.appendChild(style);
  }

  function buildCharacterSvg() {
    // Animated character putting on different garments in a loop.
    // Three garments overlap with staggered animation delays so one is always
    // visible "on" the body while others slide in/out.
    return [
      '<svg class="cab-char" viewBox="0 0 32 36" aria-hidden="true">',
      // Head
      '<circle cx="16" cy="6.5" r="3.6" fill="currentColor"/>',
      // Neck
      '<rect x="14.5" y="9.5" width="3" height="2" rx="1" fill="currentColor"/>',
      // Body (torso) silhouette behind shirts
      '<path d="M9.5 16 Q11 12 14.5 11.5 L17.5 11.5 Q21 12 22.5 16 L21 25 Q16 26 11 25 Z" fill="currentColor" opacity=".55"/>',
      // Garment #1 — bordeaux/wine
      '<path class="cab-shirt cab-shirt-1" d="M9 16 L13 12 L19 12 L23 16 L21 19 L19 17 L19 25 Q16 26 13 25 L13 17 L11 19 Z" fill="#7A1F2B"/>',
      // Garment #2 — gold
      '<path class="cab-shirt cab-shirt-2" d="M9 16 L13 12 L19 12 L23 16 L21 19 L19 17 L19 25 Q16 26 13 25 L13 17 L11 19 Z" fill="#C9A96E"/>',
      // Garment #3 — cream
      '<path class="cab-shirt cab-shirt-3" d="M9 16 L13 12 L19 12 L23 16 L21 19 L19 17 L19 25 Q16 26 13 25 L13 17 L11 19 Z" fill="#FBF7F2"/>',
      // Arms (raise during swap)
      '<g class="cab-arm-l"><path d="M11 16 L8 22" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></g>',
      '<g class="cab-arm-r"><path d="M21 16 L24 22" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></g>',
      // Legs
      '<path d="M14 25 L13 33" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
      '<path d="M18 25 L19 33" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
      "</svg>",
    ].join("");
  }

  function createBubble() {
    if (document.getElementById("cabines-bubble")) return;

    var bubble = document.createElement("button");
    bubble.id = "cabines-bubble";
    bubble.className = "cabines-bubble";
    bubble.setAttribute("data-pos", POSITION);
    bubble.style.background =
      "linear-gradient(135deg, " + COLOR + ", " + lighten(COLOR, 12) + ")";
    bubble.style[POSITION] = "24px";
    bubble.setAttribute("aria-label", "Essayer ce produit virtuellement");

    // Decide whether to show callout (only once per session)
    var showCallout = !sessionStorage.getItem("cabines-callout-dismissed");

    bubble.innerHTML =
      buildCharacterSvg() +
      '<span class="cab-label"><span class="cab-tag">IA</span>' +
      escapeHtml(LABEL) +
      "</span>" +
      '<span class="cab-dot" aria-hidden="true"></span>' +
      (showCallout
        ? '<span class="cab-callout" role="status">' +
          '<span class="cab-tag">IA</span>' +
          '<span>' + escapeHtml(LABEL) + '</span>' +
          '<button type="button" class="cab-callout-close" aria-label="Masquer">&times;</button>' +
          "</span>"
        : "");

    bubble.addEventListener("click", function (e) {
      var t = e.target;
      // Ignore clicks on the callout-close button
      if (t && t.classList && t.classList.contains("cab-callout-close")) {
        e.stopPropagation();
        var co = bubble.querySelector(".cab-callout");
        if (co) co.remove();
        try { sessionStorage.setItem("cabines-callout-dismissed", "1"); } catch (_) {}
        return;
      }
      openModal();
    });

    document.body.appendChild(bubble);

    // Auto-dismiss callout after 8s (still remembered for the session)
    if (showCallout) {
      setTimeout(function () {
        var co = bubble.querySelector(".cab-callout");
        if (co) {
          co.style.transition = "opacity .35s, transform .35s";
          co.style.opacity = "0";
          co.style.transform = "translateY(6px)";
          setTimeout(function () { if (co.parentNode) co.remove(); }, 380);
        }
      }, 8000);
    }
  }

  function openModal() {
    if (document.getElementById("cabines-overlay")) return;

    var info = detectProductInfo();
    var params = new URLSearchParams();
    params.set("embed", "1");
    if (info.image) params.set("productImage", info.image);
    if (info.url) params.set("productUrl", info.url);
    if (info.title) params.set("productTitle", info.title);
    if (window.location.origin) params.set("origin", window.location.origin);

    var iframeSrc = APP_URL + "/embed?" + params.toString();

    var overlay = document.createElement("div");
    overlay.id = "cabines-overlay";
    overlay.className = "cabines-overlay";
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeModal();
    });

    var modal = document.createElement("div");
    modal.className = "cabines-modal";

    var loader = document.createElement("div");
    loader.className = "cabines-loader";
    loader.id = "cabines-loader";
    loader.innerHTML =
      '<div class="cabines-loader-spinner" aria-hidden="true"></div>' +
      "<p>Ouverture de la cabine d'essayage…</p>";

    var iframe = document.createElement("iframe");
    iframe.className = "cabines-iframe";
    iframe.src = iframeSrc;
    iframe.title = "Cabine d'essayage virtuelle";
    iframe.allow = "camera; clipboard-write; fullscreen";
    iframe.setAttribute("allowfullscreen", "");

    iframe.addEventListener("load", function () {
      var el = document.getElementById("cabines-loader");
      if (el) {
        el.style.opacity = "0";
        el.style.transition = "opacity .3s";
        setTimeout(function () {
          if (el.parentNode) el.parentNode.removeChild(el);
        }, 300);
      }
    });

    iframe.addEventListener("error", function () {
      var el = document.getElementById("cabines-loader");
      if (el) {
        el.innerHTML =
          "<p style='color:#7A1F2B;text-align:center;padding:0 24px'>Impossible de charger la cabine.<br>Vérifiez l'URL : " +
          escapeHtml(APP_URL) +
          "</p>";
      }
    });

    var closeBtn = document.createElement("button");
    closeBtn.className = "cabines-close";
    closeBtn.setAttribute("aria-label", "Fermer la cabine");
    closeBtn.innerHTML = "&times;";
    closeBtn.addEventListener("click", closeModal);

    modal.appendChild(loader);
    modal.appendChild(iframe);
    modal.appendChild(closeBtn);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";

    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("message", onMessage);
  }

  function closeModal() {
    var overlay = document.getElementById("cabines-overlay");
    if (!overlay) return;
    overlay.style.opacity = "0";
    overlay.style.transition = "opacity .25s";
    setTimeout(function () {
      overlay.remove();
      document.body.style.overflow = "";
    }, 260);
    document.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("message", onMessage);
  }

  function onKeyDown(e) {
    if (e.key === "Escape") closeModal();
  }

  function onMessage(e) {
    if (!e.data || typeof e.data !== "object") return;
    if (e.data.type === "cabines:close") closeModal();
    if (e.data.type === "cabines:ready") {
      var el = document.getElementById("cabines-loader");
      if (el) {
        el.style.opacity = "0";
        el.style.transition = "opacity .3s";
        setTimeout(function () {
          if (el.parentNode) el.parentNode.removeChild(el);
        }, 300);
      }
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function lighten(hex, percent) {
    var h = hex.replace("#", "");
    if (h.length === 3)
      h = h
        .split("")
        .map(function (c) {
          return c + c;
        })
        .join("");
    var num = parseInt(h, 16);
    var r = Math.min(
      255,
      ((num >> 16) & 0xff) + Math.round(255 * (percent / 100))
    );
    var g = Math.min(
      255,
      ((num >> 8) & 0xff) + Math.round(255 * (percent / 100))
    );
    var b = Math.min(255, (num & 0xff) + Math.round(255 * (percent / 100)));
    return (
      "#" +
      ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")
    );
  }

  function init() {
    if (!isProductPage()) return;
    injectStyles();
    setTimeout(createBubble, DELAY);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.CabinesDEssayage = {
    open: openModal,
    close: closeModal,
    show: createBubble,
    hide: function () {
      var b = document.getElementById("cabines-bubble");
      if (b) b.remove();
    },
    getAppUrl: function () {
      return APP_URL;
    },
  };
})();
