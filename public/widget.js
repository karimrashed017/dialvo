/*
 * Dialvo website chat.
 *
 *   <script src="https://trydialvo.com/widget.js?id=YOUR_WIDGET_ID" async></script>
 *
 * Adds a chat button to the page. Messages go to the Dialvo workspace that
 * owns the id, where the team (and its inbound agent, if switched on) answers.
 * Everything lives in a shadow root, so the host page's styles and this
 * widget's don't touch each other. No cookies; the visitor's chat is
 * remembered in localStorage on this site only. Text from the server is only
 * ever set as text, never as HTML.
 */
(function () {
  "use strict";

  var script =
    document.currentScript ||
    document.querySelector('script[src*="/widget.js?id="]');
  if (!script || !script.src) return;
  var src = new URL(script.src);
  var token = src.searchParams.get("id") || "";
  if (!/^[0-9a-f]{64}$/.test(token)) return;
  var api = src.origin + "/api/chat/" + token;

  // One widget per id per page, however often the tag is pasted.
  window.__dialvoChat = window.__dialvoChat || {};
  if (window.__dialvoChat[token]) return;
  window.__dialvoChat[token] = true;

  var STORE = "dialvo-chat-" + token;
  var MAX = 2000;
  var POLL_MS = 3000;
  // How long the typing dots show before we stop implying a reply is coming.
  var WAIT_MS = 25000;
  var TEAM_SOON = "A team member will reply here shortly.";

  var chat = null; // { c: conversation id, k: visitor key }
  try {
    var saved = JSON.parse(localStorage.getItem(STORE) || "null");
    if (saved && typeof saved.c === "string" && typeof saved.k === "string")
      chat = saved;
  } catch {
    // No storage (private mode, sandboxed frame): the chat lasts for the page.
  }
  function remember() {
    try {
      if (chat) localStorage.setItem(STORE, JSON.stringify(chat));
      else localStorage.removeItem(STORE);
    } catch {
      // Storage is unavailable: nothing to remember.
    }
  }

  function call(path, body) {
    return fetch(api + path, {
      method: body ? "POST" : "GET",
      // text/plain keeps this a "simple" request: no preflight round trip.
      headers: body ? { "content-type": "text/plain" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "omit",
    }).then(function (res) {
      return res
        .json()
        .catch(function () {
          return {};
        })
        .then(function (data) {
          data.status = res.status;
          return data;
        });
    });
  }

  var CSS =
    ":host{all:initial}" +
    "*{box-sizing:border-box;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}" +
    ".launch{position:fixed;right:20px;bottom:20px;z-index:2147483000;width:56px;height:56px;border-radius:50%;border:0;background:#0B0B0C;color:#fff;cursor:pointer;display:grid;place-items:center;box-shadow:0 6px 24px rgba(11,11,12,.22)}" +
    ".launch:hover{background:#000}" +
    ".launch:focus-visible,.x:focus-visible,.send:focus-visible{outline:2px solid #0B0B0C;outline-offset:2px}" +
    ".panel{position:fixed;right:20px;bottom:88px;z-index:2147483000;width:372px;max-width:calc(100vw - 24px);height:540px;max-height:calc(100vh - 108px);max-height:calc(100dvh - 108px);display:none;flex-direction:column;background:#fff;color:#0B0B0C;border:1px solid rgba(11,11,12,.12);border-radius:18px;overflow:hidden;box-shadow:0 18px 60px rgba(11,11,12,.2)}" +
    ".open .panel{display:flex}" +
    ".head{display:flex;align-items:center;gap:10px;padding:12px 12px 12px 14px;border-bottom:1px solid rgba(11,11,12,.08)}" +
    ".mark{width:22px;height:22px;display:block}" +
    ".title{flex:1;min-width:0;font-size:14.5px;font-weight:600;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    ".x{width:30px;height:30px;border-radius:50%;border:0;background:transparent;color:#0B0B0C;cursor:pointer;display:grid;place-items:center}" +
    ".x:hover{background:rgba(11,11,12,.06)}" +
    ".log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:6px}" +
    ".who{font-size:11px;color:rgba(11,11,12,.5);margin:6px 2px 0}" +
    ".msg{max-width:84%;width:fit-content;padding:8px 12px;border-radius:16px;font-size:14px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}" +
    ".them{background:rgba(11,11,12,.06);border-bottom-left-radius:5px}" +
    ".me{align-self:flex-end;background:#0B0B0C;color:#fff;border-bottom-right-radius:5px}" +
    ".me.pending{opacity:.6}" +
    ".note{align-self:center;text-align:center;max-width:90%;font-size:12px;line-height:1.45;color:rgba(11,11,12,.55);margin:6px 0}" +
    ".dots{display:flex;gap:4px;padding:11px 12px}" +
    ".dots i{width:6px;height:6px;border-radius:50%;background:rgba(11,11,12,.45);animation:dv 1.2s infinite ease-in-out}" +
    ".dots i:nth-child(2){animation-delay:.15s}.dots i:nth-child(3){animation-delay:.3s}" +
    "@keyframes dv{0%,80%,100%{opacity:.25}40%{opacity:1}}" +
    "@media (prefers-reduced-motion:reduce){.dots i{animation:none}}" +
    ".form{display:flex;align-items:flex-end;gap:8px;padding:10px;border-top:1px solid rgba(11,11,12,.08)}" +
    ".text{flex:1;min-height:40px;max-height:120px;resize:none;border:1px solid rgba(11,11,12,.16);border-radius:12px;padding:9px 11px;font-size:14px;line-height:1.4;color:#0B0B0C;background:#fff;outline:none}" +
    ".text:focus{border-color:#0B0B0C}" +
    ".text::placeholder{color:rgba(11,11,12,.4)}" +
    ".send{height:40px;padding:0 16px;border:0;border-radius:999px;background:#0B0B0C;color:#fff;font-size:13.5px;font-weight:600;cursor:pointer}" +
    ".send:disabled{opacity:.45;cursor:default}" +
    ".err{padding:0 12px 8px;font-size:12px;color:#B42318;display:none}" +
    ".foot{padding:0 0 9px;text-align:center;font-size:11px;color:rgba(11,11,12,.45)}" +
    ".foot a{color:inherit;text-decoration:none}.foot a:hover{text-decoration:underline}" +
    "@media (max-width:480px){.panel{right:12px;left:12px;width:auto;bottom:84px}.launch{right:14px;bottom:14px}}";

  var ICON_CHAT =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>';
  var ICON_X =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  }

  function mount(info) {
    var host = el("div");
    host.setAttribute("data-dialvo-chat", "");
    var root = host.attachShadow({ mode: "open" });
    var style = el("style");
    style.textContent = CSS;
    var wrap = el("div");

    var launch = el("button", "launch");
    launch.type = "button";
    launch.setAttribute("aria-label", "Open chat");
    launch.setAttribute("aria-expanded", "false");
    launch.innerHTML = ICON_CHAT;

    var panel = el("section", "panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", info.title);
    var head = el("header", "head");
    // The Spark mark, in black.
    var mark = el("img", "mark");
    mark.src = src.origin + "/brand/mark.svg";
    mark.alt = "";
    var title = el("div", "title", info.title);
    var close = el("button", "x");
    close.type = "button";
    close.setAttribute("aria-label", "Close chat");
    close.innerHTML = ICON_X;
    head.append(mark, title, close);

    var log = el("div", "log");
    log.setAttribute("role", "log");
    log.setAttribute("aria-live", "polite");

    var err = el("div", "err");
    err.setAttribute("role", "alert");
    var form = el("form", "form");
    var text = el("textarea", "text");
    text.rows = 1;
    text.maxLength = MAX;
    text.placeholder = "Write a message";
    text.setAttribute("aria-label", "Your message");
    var send = el("button", "send", "Send");
    send.type = "submit";
    form.append(text, send);

    var foot = el("div", "foot");
    var link = el("a", "", "Powered by Dialvo");
    link.href = "https://trydialvo.com";
    link.target = "_blank";
    link.rel = "noopener";
    foot.append(link);

    panel.append(head, log, err, form, foot);
    wrap.append(panel, launch);
    root.append(style, wrap);
    document.body.appendChild(host);

    var messages = []; // from the server
    var pending = []; // typed, not yet confirmed
    var state = "open";
    var notice = ""; // a line from us, e.g. after a message was only saved
    var waitingSince = 0; // when the typing dots started
    var sending = false;
    var timer = 0;

    function lastIndex(from) {
      for (var i = messages.length - 1; i >= 0; i--)
        if ((messages[i].from === "visitor") === (from === "visitor")) return i;
      return -1;
    }

    function note() {
      if (state === "closed")
        return "This chat was closed. Send a message to reopen it.";
      // A reply already came after the visitor's last message: nothing to add.
      var answered = lastIndex("other") > lastIndex("visitor");
      if (state === "team")
        return answered ? "You're talking with a team member." : TEAM_SOON;
      if (state === "review") return TEAM_SOON;
      if (answered) return "";
      return notice;
    }

    function render() {
      var stick = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
      log.textContent = "";
      log.append(el("div", "msg them", info.welcome));
      var last = "";
      messages.forEach(function (m) {
        if (m.from !== "visitor" && m.from !== last)
          log.append(
            el("div", "who", m.from === "team" ? "Team member" : "Assistant"),
          );
        last = m.from;
        log.append(
          el("div", m.from === "visitor" ? "msg me" : "msg them", m.body),
        );
      });
      pending.forEach(function (body) {
        log.append(el("div", "msg me pending", body));
      });
      var answered = lastIndex("other") > lastIndex("visitor");
      var typing =
        waitingSince && !answered && state === "open" && !pending.length;
      if (typing) {
        var dots = el("div", "msg them dots");
        dots.setAttribute("aria-label", "Writing a reply");
        dots.append(el("i"), el("i"), el("i"));
        log.append(dots);
      } else {
        var line = note();
        if (line) log.append(el("div", "note", line));
      }
      if (stick) log.scrollTop = log.scrollHeight;
    }

    function fail(message) {
      err.textContent = message || "";
      err.style.display = message ? "block" : "none";
    }

    function poll() {
      if (!chat || document.hidden) return Promise.resolve();
      return call("/poll", { conversation: chat.c, key: chat.k })
        .then(function (data) {
          if (data.status === 404) {
            // The chat can't be read just now (it was deleted, or the widget
            // is switched off). Stop asking; what is on screen stays, and
            // the next message the visitor sends finds out which it is.
            clearInterval(timer);
          } else if (data.ok) {
            messages = data.messages || [];
            state = data.state || "open";
          }
          if (waitingSince && Date.now() - waitingSince > WAIT_MS) {
            // No reply came. Say what is true: a person will pick it up.
            waitingSince = 0;
            notice = TEAM_SOON;
          }
          render();
        })
        .catch(function () {});
    }

    function schedule() {
      clearInterval(timer);
      if (wrap.classList.contains("open"))
        timer = setInterval(poll, POLL_MS);
    }

    function submit(body, retried) {
      sending = true;
      send.disabled = true;
      fail("");
      pending.push(body);
      render();
      log.scrollTop = log.scrollHeight;
      var payload = { message: body };
      if (chat) {
        payload.conversation = chat.c;
        payload.key = chat.k;
      }
      return call("/messages", payload)
        .then(function (data) {
          pending.pop();
          if (data.status === 404 && chat && !retried) {
            // A remembered chat that no longer exists: start a new one.
            chat = null;
            remember();
            messages = [];
            return submit(body, true);
          }
          if (!data.ok) {
            text.value = body;
            fail(data.message || "That didn't send. Please try again.");
            return;
          }
          if (data.key) {
            chat = { c: data.conversation, k: data.key };
            remember();
          }
          messages.push({
            id: data.message.id,
            from: "visitor",
            body: data.message.body,
          });
          if (state === "closed") state = "open";
          if (data.agent === "replying") {
            waitingSince = Date.now();
            notice = "";
          } else {
            waitingSince = 0;
            notice = "Thanks. " + TEAM_SOON;
          }
        })
        .catch(function () {
          pending.pop();
          text.value = body;
          fail("That didn't send. Check your connection and try again.");
        })
        .then(function () {
          if (retried) return;
          sending = false;
          send.disabled = false;
          render();
          log.scrollTop = log.scrollHeight;
          schedule();
        });
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var body = text.value.trim();
      if (!body || sending) return;
      text.value = "";
      text.style.height = "";
      submit(body.slice(0, MAX));
    });
    text.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        form.requestSubmit();
      }
    });
    text.addEventListener("input", function () {
      text.style.height = "";
      text.style.height = Math.min(text.scrollHeight + 2, 120) + "px";
    });

    function toggle(open) {
      wrap.classList.toggle("open", open);
      launch.setAttribute("aria-expanded", String(open));
      launch.setAttribute("aria-label", open ? "Close chat" : "Open chat");
      launch.innerHTML = open ? ICON_X : ICON_CHAT;
      if (open) {
        render();
        poll();
        text.focus();
      }
      schedule();
    }
    launch.addEventListener("click", function () {
      toggle(!wrap.classList.contains("open"));
    });
    close.addEventListener("click", function () {
      toggle(false);
      launch.focus();
    });
    panel.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        toggle(false);
        launch.focus();
      }
    });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && wrap.classList.contains("open")) poll();
    });

    // For the preview in Dialvo's own settings page.
    window.__dialvoChat[token] = {
      open: function () {
        toggle(true);
      },
      remove: function () {
        clearInterval(timer);
        host.remove();
        delete window.__dialvoChat[token];
      },
    };
    if (script.hasAttribute("data-open")) toggle(true);
  }

  // The install check: tell Dialvo this widget loaded, so the team can see
  // their code works. The request carries nothing but the widget's id; the
  // server reads this site's origin from the browser's own Origin header.
  // No cookie, nothing about the visitor, and it never holds up the chat.
  function seen() {
    try {
      fetch(api + "/seen", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "{}",
        credentials: "omit",
        keepalive: true,
      }).catch(function () {});
    } catch {
      // An old browser without fetch options: the chat still works.
    }
  }

  function start() {
    // The widget only appears if its id is known and switched on.
    call("")
      .then(function (info) {
        if (info.ok && window.__dialvoChat[token] === true) {
          mount({
            title: String(info.title || "Chat with us"),
            welcome: String(info.welcome || "Hi. How can we help?"),
          });
          seen();
        } else if (!info.ok) delete window.__dialvoChat[token];
      })
      .catch(function () {
        delete window.__dialvoChat[token];
      });
  }

  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
})();
