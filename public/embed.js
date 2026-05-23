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

  function detectProductInfo() {
    var info = { title: "", image: "", url: window.location.href };
    try {
      if (window.ShopifyAnalytics && window.ShopifyAnalytics.meta &&
          window.ShopifyAnalytics.meta.product) {
        var p = window.ShopifyAnalytics.meta.product;
        info.title = p.title || info.title;
      }
    } catch (e) {}

    if (!info.title) {
      var h1 = document.querySelector("h1");
      if (h1) info.title = h1.textContent.trim();
    }

    var ogImage = document.querySelector('meta[property="og:image"]');
    if (ogImage && ogImage.content) info.image = ogImage.content;

    if (!info.image) {
      var imgEl =
        document.querySelector(".product__image img") ||
        document.querySelector(".product-single__photo img") ||
        document.querySelector(".product-gallery img") ||
        document.querySelector("[data-product-featured-image]") ||
        document.querySelector("main img");
      if (imgEl) {
        info.image = imgEl.currentSrc || imgEl.src;
      }
    }

    if (info.image && info.image.indexOf("//") === 0) {
      info.image = "https:" + info.image;
    }

    return info;
  }

  function injectStyles() {
    if (document.getElementById("cabines-embed-styles")) return;
    var style = document.createElement("style");
    style.id = "cabines-embed-styles";
    style.textContent = [
      "@keyframes cab-rise{0%{transform:translateY(120%) scale(.85);opacity:0}100%{transform:translateY(0) scale(1);opacity:1}}",
      "@keyframes cab-pulse{0%{box-shadow:0 8px 24px rgba(122,31,43,.3),0 0 0 0 rgba(201,169,110,.5)}70%{box-shadow:0 8px 24px rgba(122,31,43,.3),0 0 0 14px rgba(201,169,110,0)}100%{box-shadow:0 8px 24px rgba(122,31,43,.3),0 0 0 0 rgba(201,169,110,0)}}",
      "@keyframes cab-fadein{from{opacity:0}to{opacity:1}}",
      "@keyframes cab-zoomin{from{transform:scale(.92);opacity:0}to{transform:scale(1);opacity:1}}",
      "@keyframes cab-spin{to{transform:rotate(360deg)}}",
      ".cabines-bubble{position:fixed;bottom:24px;z-index:2147483646;display:flex;align-items:center;gap:10px;padding:14px 20px;border:none;border-radius:999px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;font-weight:500;color:#fff;cursor:pointer;animation:cab-rise .55s cubic-bezier(.22,1,.36,1) both,cab-pulse 2.6s ease-out 1.2s 3;box-shadow:0 8px 24px rgba(122,31,43,.3);transition:transform .25s,box-shadow .25s}",
      ".cabines-bubble:hover{transform:translateY(-2px) scale(1.03);box-shadow:0 12px 32px rgba(122,31,43,.4)}",
      ".cabines-bubble svg{width:22px;height:22px;flex-shrink:0}",
      ".cabines-bubble .cab-tag{display:inline-block;background:linear-gradient(135deg,#C9A96E,#E0C99A);color:#1A1410;font-size:10px;font-weight:700;padding:2px 7px;border-radius:6px;margin-right:4px;letter-spacing:.3px}",
      ".cabines-overlay{position:fixed;inset:0;z-index:2147483647;background:rgba(26,20,16,.65);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:16px;animation:cab-fadein .3s ease-out}",
      ".cabines-modal{position:relative;width:100%;max-width:1080px;height:92vh;max-height:920px;background:#FBF7F2;border-radius:24px;overflow:hidden;box-shadow:0 28px 80px rgba(0,0,0,.45);animation:cab-zoomin .35s cubic-bezier(.22,1,.36,1) both}",
      ".cabines-iframe{width:100%;height:100%;border:none;display:block;background:#FBF7F2}",
      ".cabines-loader{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:#FBF7F2;z-index:5}",
      ".cabines-loader-spinner{width:44px;height:44px;border:3px solid rgba(122,31,43,.15);border-top-color:#7A1F2B;border-radius:50%;animation:cab-spin .8s linear infinite}",
      ".cabines-loader p{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;color:#4A4038;margin:0}",
      ".cabines-close{position:absolute;top:14px;right:14px;width:38px;height:38px;border:none;border-radius:50%;background:rgba(255,255,255,.95);color:#1A1410;font-size:18px;cursor:pointer;z-index:10;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(0,0,0,.18);transition:transform .2s}",
      ".cabines-close:hover{transform:scale(1.1) rotate(90deg);background:#fff}",
      "@media (max-width:640px){.cabines-bubble .cab-label{display:none}.cabines-bubble{padding:14px;border-radius:50%}.cabines-overlay{padding:0}.cabines-modal{height:100vh;max-height:100vh;border-radius:0}.cabines-close{top:10px;right:10px}}"
    ].join("");
    document.head.appendChild(style);
  }

  function createBubble() {
    if (document.getElementById("cabines-bubble")) return;

    var bubble = document.createElement("button");
    bubble.id = "cabines-bubble";
    bubble.className = "cabines-bubble";
    bubble.style.background =
      "linear-gradient(135deg, " + COLOR + ", " + lighten(COLOR, 12) + ")";
    bubble.style[POSITION] = "24px";
    bubble.setAttribute("aria-label", "Essayer ce produit virtuellement");
    bubble.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 2 L12 22 M5 9 Q5 6 8 4 L8 22 M19 9 Q19 6 16 4 L16 22"/>' +
      '<circle cx="12" cy="2" r="1.2" fill="currentColor"/>' +
      "</svg>" +
      '<span class="cab-label"><span class="cab-tag">IA</span>' +
      escapeHtml(LABEL) +
      "</span>";
    bubble.addEventListener("click", openModal);
    document.body.appendChild(bubble);
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
