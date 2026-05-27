/**
 * TryWithAI — Shopify try-on widget loader.
 *
 * Drop this script into theme.liquid (just before </body>):
 *
 *   <script src="https://trywithai.app/embed.js"
 *           data-app-url="https://trywithai.app"
 *           data-label="Essayer avec l'IA"
 *           data-delay="1500"
 *           data-position="right"
 *           data-color="#7C3AED"
 *           data-pages="product"
 *           data-merchant-id="my-shop"
 *           async></script>
 *
 * Backward compatibility: this script also exposes `window.CabinesDEssayage`
 * for any legacy site that already integrates the old widget.
 */
(function () {
  if (window.__tryWithAIEmbedded || window.__cabinesEmbedded) return;
  window.__tryWithAIEmbedded = true;
  window.__cabinesEmbedded = true;

  function getConfigScript() {
    var byId =
      document.getElementById("trywithai-embed") ||
      document.getElementById("cabines-embed");
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
    if (
      typeof window !== "undefined" &&
      window.location &&
      window.location.origin
    ) {
      return window.location.origin.replace(/\/$/, "");
    }
    return "https://trywithai.app";
  }

  var scriptEl = getConfigScript();
  var ds = (scriptEl && scriptEl.dataset) || {};
  var APP_URL = resolveAppUrl(ds);
  var DELAY = parseInt(ds.delay || "1500", 10);
  var LABEL = ds.label || "Essayer avec l'IA";
  var PAGES = (ds.pages || "product").toLowerCase();
  var POSITION = ds.position === "left" ? "left" : "right";
  var COLOR = ds.color || "#7C3AED";
  var MERCHANT_ID = (ds.merchantId || "").trim();
  var FORCED_CATEGORY = (ds.category || "").trim();

  function pageMatches(pages) {
    if (pages === "all") return true;
    var list = pages.split(",").map(function (s) {
      return s.trim();
    });
    var path = window.location.pathname;
    function check(kind) {
      switch (kind) {
        case "product":
          if (path.indexOf("/products/") !== -1) return true;
          if (path.indexOf("/demo") !== -1) return true;
          try {
            if (
              window.ShopifyAnalytics &&
              window.ShopifyAnalytics.meta &&
              window.ShopifyAnalytics.meta.product
            )
              return true;
          } catch (e) {}
          if (
            document.querySelector('meta[property="og:type"][content="product"]')
          )
            return true;
          return false;
        case "collection":
          return path.indexOf("/collections/") !== -1;
        case "home":
          return path === "/" || path === "";
        default:
          return false;
      }
    }
    for (var i = 0; i < list.length; i++) if (check(list[i])) return true;
    return false;
  }

  /** Resolve relative / localhost URLs against the current origin. */
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

  function scoreCandidate(c) {
    if (!c.url || isLikelyJunkUrl(c.url)) return -1;
    var w = c.w || 0;
    var h = c.h || 0;
    var area = w * h;
    var score = 0;
    score += Math.min(area, 4000000) / 1000;
    score += Math.min(Math.max(w, h), 2000) / 5;
    if (c.priority) score += c.priority;
    if (w && h) {
      var ratio = Math.max(w, h) / Math.max(1, Math.min(w, h));
      if (ratio > 4) score -= 200;
    }
    if (w > 0 && w < 200) score -= 300;
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

  function findBestProductImage() {
    var candidates = [];

    if (ds.productImage) {
      pushCandidate(candidates, ds.productImage, 0, 0, 10000);
    }

    try {
      var meta =
        window.ShopifyAnalytics &&
        window.ShopifyAnalytics.meta &&
        window.ShopifyAnalytics.meta.product;
      if (meta) {
        if (meta.featured_image)
          pushCandidate(candidates, meta.featured_image, 0, 0, 8000);
        if (meta.images && meta.images.length) {
          for (var i = 0; i < meta.images.length; i++) {
            pushCandidate(candidates, meta.images[i], 0, 0, 4000 - i * 50);
          }
        }
      }
    } catch (e) {}

    try {
      var ldScripts = document.querySelectorAll(
        'script[type="application/ld+json"]'
      );
      for (var s = 0; s < ldScripts.length; s++) {
        try {
          var data = JSON.parse(ldScripts[s].textContent || "null");
          var nodes = Array.isArray(data) ? data : [data];
          for (var n = 0; n < nodes.length; n++) {
            var node = nodes[n];
            if (!node) continue;
            var inner =
              node["@graph"] && Array.isArray(node["@graph"])
                ? node["@graph"]
                : [node];
            for (var k = 0; k < inner.length; k++) {
              var d = inner[k];
              if (!d) continue;
              var type = d["@type"];
              var isProduct =
                type === "Product" ||
                (Array.isArray(type) && type.indexOf("Product") !== -1);
              if (!isProduct) continue;
              var img = d.image;
              if (!img) continue;
              if (typeof img === "string") {
                pushCandidate(candidates, img, 0, 0, 7000);
              } else if (Array.isArray(img)) {
                for (var ii = 0; ii < img.length; ii++) {
                  var v = img[ii];
                  if (typeof v === "string")
                    pushCandidate(candidates, v, 0, 0, 6000 - ii * 50);
                  else if (v && v.url)
                    pushCandidate(
                      candidates,
                      v.url,
                      v.width || 0,
                      v.height || 0,
                      6000 - ii * 50
                    );
                }
              } else if (img && img.url) {
                pushCandidate(
                  candidates,
                  img.url,
                  img.width || 0,
                  img.height || 0,
                  7000
                );
              }
            }
          }
        } catch (eIn) {}
      }
    } catch (e) {}

    var og = document.querySelector('meta[property="og:image"]');
    if (og && og.content) pushCandidate(candidates, og.content, 0, 0, 3000);
    var ogW = parseInt(
      (document.querySelector('meta[property="og:image:width"]') || {}).content ||
        "0",
      10
    );
    var ogH = parseInt(
      (document.querySelector('meta[property="og:image:height"]') || {}).content ||
        "0",
      10
    );
    if (og && og.content && (ogW || ogH)) {
      var last = candidates[candidates.length - 1];
      if (last) {
        last.w = ogW;
        last.h = ogH;
      }
    }
    var tw = document.querySelector('meta[name="twitter:image"]');
    if (tw && tw.content) pushCandidate(candidates, tw.content, 0, 0, 2500);

    var linkSrc = document.querySelector('link[rel="image_src"]');
    if (linkSrc && linkSrc.href)
      pushCandidate(candidates, linkSrc.href, 0, 0, 2000);

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
        var sources = roots[r].querySelectorAll("source[srcset]");
        for (var ss = 0; ss < sources.length; ss++) {
          var u1 = bestFromSrcset(sources[ss].getAttribute("srcset"));
          if (u1) pushCandidate(candidates, u1, 0, 0, 1500 - p * 100);
        }
        var imgs = roots[r].querySelectorAll("img");
        for (var im = 0; im < imgs.length; im++) {
          var el = imgs[im];
          var srcset = el.getAttribute("srcset");
          var u =
            (srcset && bestFromSrcset(srcset)) || el.currentSrc || el.src;
          var w =
            el.naturalWidth || parseInt(el.getAttribute("width") || "0", 10) || 0;
          var h =
            el.naturalHeight ||
            parseInt(el.getAttribute("height") || "0", 10) ||
            0;
          pushCandidate(candidates, u, w, h, 1000 - p * 100);
        }
      }
    }

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
      if (
        window.ShopifyAnalytics &&
        window.ShopifyAnalytics.meta &&
        window.ShopifyAnalytics.meta.product
      ) {
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
    if (document.getElementById("trywithai-embed-styles")) return;
    var style = document.createElement("style");
    style.id = "trywithai-embed-styles";
    style.textContent = [
      "@keyframes twa-rise{0%{transform:translateY(120%) scale(.85);opacity:0}100%{transform:translateY(0) scale(1);opacity:1}}",
      "@keyframes twa-pulse{0%{box-shadow:0 10px 28px rgba(124,58,237,.32),0 0 0 0 rgba(236,72,153,.55)}70%{box-shadow:0 10px 28px rgba(124,58,237,.32),0 0 0 16px rgba(236,72,153,0)}100%{box-shadow:0 10px 28px rgba(124,58,237,.32),0 0 0 0 rgba(236,72,153,0)}}",
      "@keyframes twa-fadein{from{opacity:0}to{opacity:1}}",
      "@keyframes twa-zoomin{from{transform:scale(.92);opacity:0}to{transform:scale(1);opacity:1}}",
      "@keyframes twa-spin{to{transform:rotate(360deg)}}",
      "@keyframes twa-shirt-cycle{0%,2%{transform:translateY(-9px) scale(.85);opacity:0}10%,28%{transform:translateY(0) scale(1);opacity:1}33%,100%{transform:translateY(2px) scale(.95);opacity:0}}",
      "@keyframes twa-arm-l{0%,15%,45%,100%{transform:rotate(0)}25%,35%{transform:rotate(-30deg)}}",
      "@keyframes twa-arm-r{0%,15%,45%,100%{transform:rotate(0)}25%,35%{transform:rotate(30deg)}}",
      "@keyframes twa-callout-in{0%{opacity:0;transform:translateY(8px) scale(.92)}100%{opacity:1;transform:translateY(0) scale(1)}}",
      "@keyframes twa-callout-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}",
      "@keyframes twa-dot-pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.25);opacity:.7}}",
      ".trywithai-bubble{position:fixed;bottom:24px;z-index:2147483646;display:flex;align-items:center;gap:10px;padding:14px 20px;border:none;border-radius:999px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;font-weight:500;color:#fff;cursor:pointer;animation:twa-rise .55s cubic-bezier(.22,1,.36,1) both,twa-pulse 2.6s ease-out 1.2s 3;box-shadow:0 10px 28px rgba(124,58,237,.32);transition:transform .25s,box-shadow .25s}",
      ".trywithai-bubble:hover{transform:translateY(-2px) scale(1.03);box-shadow:0 14px 36px rgba(124,58,237,.45)}",
      ".trywithai-bubble:hover .twa-callout{opacity:0;pointer-events:none}",
      ".trywithai-bubble .twa-tag{display:inline-block;background:linear-gradient(135deg,#EC4899,#F9A8D4);color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:6px;margin-right:4px;letter-spacing:.3px}",
      ".twa-char{width:26px;height:30px;flex-shrink:0;overflow:visible}",
      ".twa-char .twa-shirt{transform-origin:center;transform-box:fill-box;animation:twa-shirt-cycle 3.6s cubic-bezier(.22,1,.36,1) infinite}",
      ".twa-char .twa-shirt-2{animation-delay:1.2s}",
      ".twa-char .twa-shirt-3{animation-delay:2.4s}",
      ".twa-char .twa-arm-l{transform-origin:11px 16px;animation:twa-arm-l 3.6s ease-in-out infinite}",
      ".twa-char .twa-arm-r{transform-origin:21px 16px;animation:twa-arm-r 3.6s ease-in-out infinite}",
      ".trywithai-bubble .twa-callout{position:absolute;bottom:calc(100% + 14px);background:#fff;color:#1E1B4B;font-size:13px;font-weight:600;padding:10px 14px;border-radius:14px;box-shadow:0 10px 30px rgba(91,33,182,.18);white-space:nowrap;pointer-events:auto;animation:twa-callout-in .45s cubic-bezier(.22,1,.36,1) both,twa-callout-bob 2.4s ease-in-out 1s infinite;display:flex;align-items:center;gap:8px}",
      ".trywithai-bubble[data-pos='right'] .twa-callout{right:0}",
      ".trywithai-bubble[data-pos='left'] .twa-callout{left:0}",
      ".trywithai-bubble .twa-callout::after{content:'';position:absolute;top:100%;width:14px;height:14px;background:#fff;transform:translateY(-7px) rotate(45deg);box-shadow:3px 3px 6px rgba(91,33,182,.06)}",
      ".trywithai-bubble[data-pos='right'] .twa-callout::after{right:18px}",
      ".trywithai-bubble[data-pos='left'] .twa-callout::after{left:18px}",
      ".trywithai-bubble .twa-callout .twa-tag{margin:0}",
      ".trywithai-bubble .twa-callout-close{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border:none;background:rgba(91,33,182,.08);color:#4C1D95;border-radius:50%;cursor:pointer;font-size:12px;line-height:1;margin-left:4px}",
      ".trywithai-bubble .twa-callout-close:hover{background:rgba(91,33,182,.16)}",
      ".trywithai-bubble .twa-dot{position:absolute;top:6px;right:6px;width:10px;height:10px;background:#EC4899;border:2px solid #fff;border-radius:50%;animation:twa-dot-pulse 1.6s ease-in-out infinite}",
      ".trywithai-bubble[data-pos='left'] .twa-dot{right:auto;left:6px}",
      // Bubble-mode overlay: transparent, sized to the bubble itself
      // so clicks outside still reach the merchant page.
      ".trywithai-overlay{position:fixed;bottom:0;right:0;width:100%;height:100%;z-index:2147483647;background:transparent;pointer-events:none;animation:twa-fadein .3s ease-out;transition:opacity .25s,visibility .25s}",
      "@media (min-width:641px){.trywithai-overlay{width:440px;height:90vh;max-height:760px;bottom:0;right:0;padding:0}}",
      // Minimized mode: shrink the overlay to a small bottom-right
      // area where ONLY the in-iframe pill is rendered. The host
      // page is then fully clickable outside that area. We never
      // render a duplicate host-side pill — see double-bubble fix.
      ".trywithai-overlay--minimized{width:260px !important;height:80px !important;bottom:8px !important;right:8px !important;max-height:none !important;background:transparent}",
      "@media (min-width:641px){.trywithai-overlay--minimized{width:260px !important;height:80px !important;max-height:none !important;bottom:8px !important;right:8px !important}}",
      // Fullscreen lightbox mode: the iframe grows to cover the entire
      // merchant viewport so the in-iframe Agrandir overlay is actually
      // large enough to be useful.
      ".trywithai-overlay--lightbox{width:100% !important;height:100% !important;bottom:0 !important;right:0 !important;max-height:none !important}",
      "@media (min-width:641px){.trywithai-overlay--lightbox{width:100% !important;height:100% !important;max-height:none !important}}",
      ".trywithai-jobbubble{position:fixed;bottom:24px;right:24px;z-index:2147483646;display:flex;align-items:center;gap:10px;padding:12px 16px;border:none;border-radius:999px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;font-weight:600;color:#fff;cursor:pointer;animation:twa-rise .55s cubic-bezier(.22,1,.36,1) both;box-shadow:0 10px 30px rgba(124,58,237,.36),0 0 0 2px rgba(255,255,255,.5) inset;transition:transform .25s,box-shadow .25s}",
      ".trywithai-jobbubble:hover{transform:translateY(-2px) scale(1.03)}",
      ".trywithai-jobbubble .twa-job-icon{width:10px;height:10px;border-radius:50%;background:#fff;animation:twa-dot-pulse 1.4s ease-in-out infinite}",
      ".trywithai-jobbubble--ready{animation:twa-rise .55s cubic-bezier(.22,1,.36,1) both,twa-pulse 1.6s ease-out infinite}",
      ".trywithai-jobbubble--ready .twa-job-icon{animation:none;background:#34D399}",
      ".trywithai-jobbubble .twa-job-pulse{width:10px;height:10px;border-radius:50%;background:#FBBF24;animation:twa-dot-pulse 1s ease-in-out infinite}",
      ".trywithai-iframe{position:absolute;inset:0;width:100%;height:100%;border:none;background:transparent;pointer-events:auto;color-scheme:light}",
      "@media (max-width:640px){",
      " .trywithai-bubble .twa-label{display:none}",
      " .trywithai-bubble{padding:14px;border-radius:50%;width:64px;height:64px;justify-content:center;animation:twa-rise .55s cubic-bezier(.22,1,.36,1) both,twa-pulse 2.6s ease-out 1.2s infinite}",
      " .trywithai-bubble .twa-char{width:34px;height:38px}",
      " .trywithai-bubble .twa-callout{bottom:calc(100% + 12px);font-size:12px;padding:9px 12px}",
      "}",
      "@media (min-width:641px){.trywithai-bubble .twa-dot{display:none}}",
    ].join("");
    document.head.appendChild(style);
  }

  function buildCharacterSvg() {
    return [
      '<svg class="twa-char" viewBox="0 0 32 36" aria-hidden="true">',
      '<circle cx="16" cy="6.5" r="3.6" fill="currentColor"/>',
      '<rect x="14.5" y="9.5" width="3" height="2" rx="1" fill="currentColor"/>',
      '<path d="M9.5 16 Q11 12 14.5 11.5 L17.5 11.5 Q21 12 22.5 16 L21 25 Q16 26 11 25 Z" fill="currentColor" opacity=".55"/>',
      '<path class="twa-shirt twa-shirt-1" d="M9 16 L13 12 L19 12 L23 16 L21 19 L19 17 L19 25 Q16 26 13 25 L13 17 L11 19 Z" fill="#7C3AED"/>',
      '<path class="twa-shirt twa-shirt-2" d="M9 16 L13 12 L19 12 L23 16 L21 19 L19 17 L19 25 Q16 26 13 25 L13 17 L11 19 Z" fill="#EC4899"/>',
      '<path class="twa-shirt twa-shirt-3" d="M9 16 L13 12 L19 12 L23 16 L21 19 L19 17 L19 25 Q16 26 13 25 L13 17 L11 19 Z" fill="#FDA4AF"/>',
      '<g class="twa-arm-l"><path d="M11 16 L8 22" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></g>',
      '<g class="twa-arm-r"><path d="M21 16 L24 22" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></g>',
      '<path d="M14 25 L13 33" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
      '<path d="M18 25 L19 33" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
      "</svg>",
    ].join("");
  }

  function createBubble() {
    if (document.getElementById("trywithai-bubble")) return;

    var bubble = document.createElement("button");
    bubble.id = "trywithai-bubble";
    bubble.className = "trywithai-bubble";
    bubble.setAttribute("data-pos", POSITION);
    bubble.style.background =
      "linear-gradient(135deg, " + COLOR + ", " + lighten(COLOR, 12) + ")";
    bubble.style[POSITION] = "24px";
    bubble.setAttribute("aria-label", "Essayer ce produit virtuellement");

    var showCallout = !sessionStorage.getItem("trywithai-callout-dismissed");

    bubble.innerHTML =
      buildCharacterSvg() +
      '<span class="twa-label"><span class="twa-tag">IA</span>' +
      escapeHtml(LABEL) +
      "</span>" +
      '<span class="twa-dot" aria-hidden="true"></span>' +
      (showCallout
        ? '<span class="twa-callout" role="status">' +
          '<span class="twa-tag">IA</span>' +
          "<span>" +
          escapeHtml(LABEL) +
          "</span>" +
          '<button type="button" class="twa-callout-close" aria-label="Masquer">&times;</button>' +
          "</span>"
        : "");

    bubble.addEventListener("click", function (e) {
      var t = e.target;
      if (t && t.classList && t.classList.contains("twa-callout-close")) {
        e.stopPropagation();
        var co = bubble.querySelector(".twa-callout");
        if (co) co.remove();
        try {
          sessionStorage.setItem("trywithai-callout-dismissed", "1");
        } catch (_) {}
        return;
      }
      openModal();
    });

    document.body.appendChild(bubble);

    if (showCallout) {
      setTimeout(function () {
        var co = bubble.querySelector(".twa-callout");
        if (co) {
          co.style.transition = "opacity .35s, transform .35s";
          co.style.opacity = "0";
          co.style.transform = "translateY(6px)";
          setTimeout(function () {
            if (co.parentNode) co.remove();
          }, 380);
        }
      }, 8000);
    }
  }

  // ── Async job state shared between overlay / parent bubble ─────────
  //
  //   When a try-on job is running we MUST keep the iframe mounted
  //   even if the customer "closes" the overlay — killing the iframe
  //   would cancel the fetch and waste an OpenAI call. We instead
  //   minimise the overlay to a small parent bubble, restore the
  //   body scroll, and reopen on click.
  var currentJob = {
    active: false,
    status: "idle",
    progress: 0,
    resultUrl: "",
    productTitle: "",
    category: "",
    minimized: false,
    jobId: "",
  };
  var currentProductVariantId = "";

  function detectVariantId() {
    // 1. ?variant= URL param (PDP query string).
    try {
      var qs = new URLSearchParams(window.location.search);
      var v = qs.get("variant");
      if (v) return String(v);
    } catch (e) {}
    // 2. Hidden input in the cart-add form.
    try {
      var input = document.querySelector(
        'form[action*="/cart/add"] [name="id"]'
      );
      if (input && input.value) return String(input.value);
    } catch (e) {}
    // 3. ShopifyAnalytics selected variant id.
    try {
      if (
        window.ShopifyAnalytics &&
        window.ShopifyAnalytics.meta &&
        window.ShopifyAnalytics.meta.selectedVariantId
      ) {
        return String(window.ShopifyAnalytics.meta.selectedVariantId);
      }
    } catch (e) {}
    // 4. First variant in ShopifyAnalytics product variants.
    try {
      var meta =
        window.ShopifyAnalytics &&
        window.ShopifyAnalytics.meta &&
        window.ShopifyAnalytics.meta.product;
      if (meta && meta.variants && meta.variants.length) {
        return String(meta.variants[0].id);
      }
    } catch (e) {}
    return "";
  }

  function openModal() {
    var existing = document.getElementById("trywithai-overlay");
    if (existing) {
      // Restore from minimised state if needed.
      restoreModal();
      return;
    }

    currentProductVariantId = detectVariantId();

    var info = detectProductInfo();
    var params = new URLSearchParams();
    params.set("embed", "1");
    if (info.image) params.set("productImage", info.image);
    if (info.url) params.set("productUrl", info.url);
    if (info.title) params.set("productTitle", info.title);
    if (FORCED_CATEGORY) params.set("category", FORCED_CATEGORY);
    if (MERCHANT_ID) params.set("merchantId", MERCHANT_ID);
    if (window.location.origin) params.set("origin", window.location.origin);

    var iframeSrc = APP_URL + "/embed?" + params.toString();

    // Bubble-mode: transparent overlay sized to the bubble itself.
    // No card, no close button (the bubble has its own X), no
    // backdrop. Clicks outside the bubble fall through to Shopify.
    var overlay = document.createElement("div");
    overlay.id = "trywithai-overlay";
    overlay.className = "trywithai-overlay";

    var iframe = document.createElement("iframe");
    iframe.id = "trywithai-iframe";
    iframe.className = "trywithai-iframe";
    iframe.src = iframeSrc;
    iframe.title = "TryWithAI — Cabine d'essayage IA";
    iframe.allow = "camera; clipboard-write; fullscreen";
    iframe.setAttribute("allowfullscreen", "");
    iframe.setAttribute(
      "allowtransparency",
      "true"
    ); // legacy IE/safari hint for transparent body
    iframe.style.background = "transparent";

    overlay.appendChild(iframe);
    document.body.appendChild(overlay);
    // The page stays scrollable — the user can keep browsing the
    // merchant catalogue while the bubble is open.

    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("message", onMessage);
  }

  function hideLoader() {
    // No-op kept for backwards compatibility with existing event
    // handlers. The bubble mode does not render a loader overlay —
    // the bubble itself appears as soon as the iframe boots.
    var el = document.getElementById("trywithai-loader");
    if (el && el.parentNode) {
      el.parentNode.removeChild(el);
    }
  }

  // Request to close — when a job is active, MINIMISE instead of
  // killing the iframe (which would cancel the fetch).
  function handleCloseRequest() {
    if (currentJob.active && currentJob.status !== "ready" &&
        currentJob.status !== "fallback_ready" &&
        currentJob.status !== "error") {
      minimizeModal();
      return;
    }
    closeModal();
  }

  function closeModal() {
    var overlay = document.getElementById("trywithai-overlay");
    if (!overlay) return;
    overlay.style.opacity = "0";
    overlay.style.transition = "opacity .25s";
    setTimeout(function () {
      overlay.remove();
    }, 260);
    document.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("message", onMessage);
    removeJobBubble();
    currentJob = {
      active: false,
      status: "idle",
      progress: 0,
      resultUrl: "",
      productTitle: "",
      category: "",
      minimized: false,
      jobId: "",
    };
  }

  function minimizeModal() {
    var overlay = document.getElementById("trywithai-overlay");
    if (!overlay) return;
    overlay.classList.add("trywithai-overlay--minimized");
    currentJob.minimized = true;
    // No more host-side pill — the iframe shrinks to pill size and
    // renders its own (single) minimized pill. Eliminates the
    // double-bubble visual reported by customers.
    removeJobBubble();
  }

  function restoreModal() {
    var overlay = document.getElementById("trywithai-overlay");
    if (!overlay) return;
    overlay.classList.remove("trywithai-overlay--minimized");
    currentJob.minimized = false;
    removeJobBubble();
    // Echo the restore down so the iframe's bubble UI follows.
    var iframe = document.getElementById("trywithai-iframe");
    if (iframe && iframe.contentWindow) {
      try {
        iframe.contentWindow.postMessage(
          { type: "TRYWITHAI_RESTORE_HOST", source: "trywithai-host" },
          "*"
        );
      } catch (_) {}
    }
  }

  function onKeyDown(e) {
    if (e.key === "Escape") handleCloseRequest();
  }

  function onMessage(e) {
    if (!e.data || typeof e.data !== "object") return;
    var msg = e.data;
    // Whitelist by `source` so we never react to Stripe / Klaviyo /
    // other unrelated postMessages.
    if (msg.source && msg.source !== "trywithai") return;
    var type = msg.type;
    var payload = msg.payload || {};

    switch (type) {
      case "TRYWITHAI_CLOSE":
      case "cabines:close":
        handleCloseRequest();
        return;
      case "TRYWITHAI_READY":
      case "cabines:ready":
        hideLoader();
        return;
      case "TRYWITHAI_JOB_STARTED":
        currentJob = {
          active: true,
          status: "preparing",
          progress: 0,
          resultUrl: "",
          productTitle: payload.productTitle || "",
          category: payload.category || "",
          minimized: false,
          jobId: payload.jobId || "",
        };
        return;
      case "TRYWITHAI_JOB_PROGRESS":
        currentJob.status = payload.status || currentJob.status;
        currentJob.progress = payload.progress || currentJob.progress;
        if (currentJob.minimized) updateJobBubble();
        return;
      case "TRYWITHAI_JOB_READY":
        currentJob.status = payload.fallbackUsed
          ? "fallback_ready"
          : "ready";
        currentJob.progress = 100;
        currentJob.resultUrl = payload.resultUrl || "";
        currentJob.active = false;
        if (currentJob.minimized) updateJobBubble();
        return;
      case "TRYWITHAI_JOB_ERROR":
        currentJob.status = "error";
        currentJob.active = false;
        if (currentJob.minimized) updateJobBubble();
        return;
      case "TRYWITHAI_MINIMIZE":
        minimizeModal();
        return;
      case "TRYWITHAI_RESTORE":
        restoreModal();
        return;
      case "TRYWITHAI_ADD_TO_CART":
        handleAddToCart(payload);
        return;
      case "TRYWITHAI_SHARE":
        // Pure analytics hook for now — the iframe handles the share
        // intent itself (Web Share API / URL open).
        return;
      case "TRYWITHAI_OPEN_RESULT":
        restoreModal();
        return;
      case "TRYWITHAI_LIGHTBOX_OPEN":
        expandIframeFullscreen();
        return;
      case "TRYWITHAI_LIGHTBOX_CLOSE":
        shrinkIframeBubble();
        return;
      default:
        return;
    }
  }

  function expandIframeFullscreen() {
    var overlay = document.getElementById("trywithai-overlay");
    if (!overlay) return;
    overlay.classList.add("trywithai-overlay--lightbox");
  }

  function shrinkIframeBubble() {
    var overlay = document.getElementById("trywithai-overlay");
    if (!overlay) return;
    overlay.classList.remove("trywithai-overlay--lightbox");
  }

  /** Detached overlay kept alive across Turbo / SPA navigations. */
  var detachedOverlay = null;
  var lastMerchantPath = "";

  function sendProductContextToIframe() {
    var overlay = document.getElementById("trywithai-overlay");
    if (!overlay) return;
    var info = detectProductInfo();
    currentProductVariantId = detectVariantId();
    replyToIframe("TRYWITHAI_PRODUCT_CONTEXT", {
      productImage: info.image || "",
      productUrl: info.url || "",
      productTitle: info.title || "",
      category: FORCED_CATEGORY || "",
      variantId: currentProductVariantId || "",
    });
  }

  function onMerchantNavigation() {
    var path =
      window.location.pathname + window.location.search + window.location.hash;
    if (path === lastMerchantPath) return;
    lastMerchantPath = path;
    var overlay = document.getElementById("trywithai-overlay");
    if (!overlay) return;
    // Never reload iframe.src — just tell the bubble the PDP changed.
    sendProductContextToIframe();
  }

  function setupOverlayPersistence() {
    lastMerchantPath =
      window.location.pathname + window.location.search + window.location.hash;

    // Turbo Drive (Hotwire) — detach before cache, reattach on load.
    document.addEventListener("turbo:before-cache", function () {
      var overlay = document.getElementById("trywithai-overlay");
      if (overlay && currentJob.active) {
        detachedOverlay = overlay;
        overlay.remove();
      }
    });
    document.addEventListener("turbo:load", function () {
      if (detachedOverlay) {
        document.body.appendChild(detachedOverlay);
        detachedOverlay = null;
        onMerchantNavigation();
      }
    });

    // Legacy Turbolinks + Shopify section reloads.
    document.addEventListener("turbolinks:load", onMerchantNavigation);
    document.addEventListener("shopify:section:load", onMerchantNavigation);
    window.addEventListener("popstate", onMerchantNavigation);

    // Fallback for themes that don't emit navigation events.
    setInterval(onMerchantNavigation, 1000);
  }

  function handleAddToCart(payload) {
    // Echo back the entryId the iframe sent so the bubble can update
    // the correct history card (the customer may have multiple
    // try-ons visible at once now).
    var entryId = (payload && payload.entryId) || "";
    var variantId = currentProductVariantId || detectVariantId();
    if (!variantId) {
      replyToIframe("TRYWITHAI_CART_ERROR", {
        message: "no_variant_id",
        entryId: entryId,
      });
      return;
    }
    var root =
      (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) ||
      "/";
    var url = root.replace(/\/?$/, "/") + "cart/add.js";
    var body = {
      items: [
        {
          id: Number(variantId) || variantId,
          quantity: 1,
          properties: {
            _TryWithAI: "Essayé avec TryWithAI",
            "_TryWithAI Result": (payload && payload.resultUrl) || "",
          },
        },
      ],
    };
    try {
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        credentials: "same-origin",
      })
        .then(function (res) {
          if (!res.ok) throw new Error("cart_http_" + res.status);
          return res.json();
        })
        .then(function (data) {
          var reply = Object.assign({}, data || {}, { entryId: entryId });
          replyToIframe("TRYWITHAI_CART_ADDED", reply);
          try {
            document.dispatchEvent(
              new CustomEvent("trywithai:cart-added", { detail: data })
            );
            document.dispatchEvent(new CustomEvent("cart:refresh"));
            document.dispatchEvent(new CustomEvent("cart:open"));
          } catch (_) {}
        })
        .catch(function () {
          replyToIframe("TRYWITHAI_CART_ERROR", {
            message: "cart_request_failed",
            entryId: entryId,
          });
        });
    } catch (e) {
      replyToIframe("TRYWITHAI_CART_ERROR", {
        message: "cart_throw",
        entryId: entryId,
      });
    }
  }

  function replyToIframe(type, payload) {
    var iframe = document.getElementById("trywithai-iframe");
    if (!iframe || !iframe.contentWindow) return;
    try {
      iframe.contentWindow.postMessage(
        { type: type, payload: payload, source: "trywithai-host" },
        "*"
      );
    } catch (_) {}
  }

  // ── Parent persistent bubble (visible when overlay minimised) ─────
  function createOrUpdateJobBubble() {
    var existing = document.getElementById("trywithai-jobbubble");
    if (existing) {
      updateJobBubble();
      return;
    }
    var b = document.createElement("button");
    b.id = "trywithai-jobbubble";
    b.className = "trywithai-jobbubble";
    b.setAttribute("aria-live", "polite");
    b.style.background =
      "linear-gradient(135deg, " + COLOR + ", " + lighten(COLOR, 12) + ")";
    b.addEventListener("click", restoreModal);
    document.body.appendChild(b);
    updateJobBubble();
  }

  function updateJobBubble() {
    var b = document.getElementById("trywithai-jobbubble");
    if (!b) return;
    var isReady =
      currentJob.status === "ready" || currentJob.status === "fallback_ready";
    var isError = currentJob.status === "error";
    var label;
    if (isReady) label = "Votre essayage est prêt — voir";
    else if (isError) label = "Une erreur — reprendre";
    else label = "Simulation… " + Math.round(currentJob.progress) + "%";
    b.innerHTML =
      '<span class="twa-job-icon" aria-hidden="true"></span>' +
      '<span class="twa-job-label">' +
      escapeHtml(label) +
      "</span>" +
      (isReady ? '<span class="twa-job-pulse" aria-hidden="true"></span>' : "");
    b.classList.toggle("trywithai-jobbubble--ready", isReady);
  }

  function removeJobBubble() {
    var b = document.getElementById("trywithai-jobbubble");
    if (b) b.remove();
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
    return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
  }

  function removeBubble() {
    var b = document.getElementById("trywithai-bubble");
    if (b) b.remove();
  }

  function init() {
    if (!pageMatches(PAGES)) return;
    injectStyles();
    setupOverlayPersistence();
    setTimeout(createBubble, DELAY);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  var api = {
    open: openModal,
    close: closeModal,
    show: createBubble,
    hide: removeBubble,
    getAppUrl: function () {
      return APP_URL;
    },
  };

  // New canonical namespace
  window.TryWithAI = api;
  // Backward compat
  window.CabinesDEssayage = api;
})();
