/* ============================================================
   QUERY — platform Q&A multi-host / multi-event.
   Routing berbasis #hash, data di Firebase Firestore.
     #/                -> Landing (login/daftar host + gabung via kode)
     #/dashboard       -> Dashboard host (kelola event)
     #/e/CODE          -> Sesi diskusi sebuah event
   ============================================================ */
(function () {
  "use strict";
  var CFG = window.APP || {};
  var fb = window.firebase;
  var configured = CFG.firebaseConfig && String(CFG.firebaseConfig.apiKey).indexOf("GANTI") !== 0;
  var db = null;
  if (configured && fb) { fb.initializeApp(CFG.firebaseConfig); db = fb.firestore(); }
  function FV() { return fb.firestore.FieldValue; }
  function uid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : "r" + Date.now() + Math.floor(Math.random() * 1e6); }

  /* ---------- Util ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var view = function () { return $("view"); };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  // Format ringan: **tebal** dan *miring* (aman: escape dulu, baru format)
  function mdInline(s) {
    var h = esc(s);
    h = h.replace(/\*\*([^\n]+?)\*\*/g, "<strong>$1</strong>");
    h = h.replace(/\*([^\n]+?)\*/g, "<em>$1</em>");
    return h;
  }
  // Bungkus teks terpilih di textarea dengan penanda bold/italic
  function fmt(id, type) {
    var ta = document.getElementById(id); if (!ta) return;
    var s = ta.selectionStart, e = ta.selectionEnd, v = ta.value, mark = (type === "bold" ? "**" : "*");
    var body = v.slice(s, e) || (type === "bold" ? "teks tebal" : "teks miring");
    ta.value = v.slice(0, s) + mark + body + mark + v.slice(e);
    ta.focus();
    ta.selectionStart = s + mark.length; ta.selectionEnd = s + mark.length + body.length;
    ta.dispatchEvent(new Event("input"));
  }
  function fmtKey(e, id) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      var k = (e.key || "").toLowerCase();
      if (k === "b") { e.preventDefault(); fmt(id, "bold"); }
      else if (k === "i") { e.preventDefault(); fmt(id, "italic"); }
    }
  }
  var fmtBar = function (id) {
    return '<div class="fmt-bar">' +
      '<button type="button" class="fmt" title="Tebal (Ctrl+B)" onmousedown="event.preventDefault()" onclick="QUERY.fmt(\'' + id + '\',\'bold\')"><b>B</b></button>' +
      '<button type="button" class="fmt" title="Miring (Ctrl+I)" onmousedown="event.preventDefault()" onclick="QUERY.fmt(\'' + id + '\',\'italic\')"><i>I</i></button>' +
      '<span class="fmt-hint">**tebal** · *miring*</span></div>';
  };
  function initial(name) { var n = (name || "A").trim(); return n ? n[0].toUpperCase() : "A"; }
  function tsOf(q) { return q.createdAt && q.createdAt.seconds ? q.createdAt.seconds * 1000 : 0; }
  function slug(s) { return String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
  var PAL = [["#2f6bff", "#1f4fd0"], ["#e0245e", "#b01244"], ["#16a34a", "#0f7a37"], ["#f59e0b", "#c87c06"], ["#8b5cf6", "#6d34d6"], ["#0ea5e9", "#0876ab"], ["#ef4444", "#b91c1c"]];
  function avColor(name) { var s = 0, str = name || "A"; for (var i = 0; i < str.length; i++) s = (s + str.charCodeAt(i)) % PAL.length; var p = PAL[s]; return "linear-gradient(135deg," + p[0] + "," + p[1] + ")"; }
  function vcheck() { return '<span class="verified" title="Presenter">✓</span>'; }
  function avatarHTML(name, sm, presenter) {
    var cls = "avatar" + (sm ? " sm" : "");
    var bg = presenter ? "linear-gradient(135deg,#005BAA,#2f8ad6)" : avColor(name);
    var inner = '<div class="' + cls + '" style="background:' + bg + '">' + esc(initial(name)) + '</div>';
    return presenter ? '<div class="av-wrap">' + inner + '<span class="av-check">✓</span></div>' : inner;
  }
  function ago(ms) {
    if (!ms) return "baru saja";
    var s = Math.floor((Date.now() - ms) / 1000);
    if (s < 60) return "baru saja";
    var m = Math.floor(s / 60); if (m < 60) return m + " mnt lalu";
    var h = Math.floor(m / 60); if (h < 24) return h + " jam lalu";
    return Math.floor(h / 24) + " hr lalu";
  }
  function toast(msg) { var t = $("toast"); if (!t) return; t.textContent = msg; t.classList.add("show"); setTimeout(function () { t.classList.remove("show"); }, 2200); }
  function go(hash) { location.hash = hash; }

  /* ---------- Sesi host (localStorage) ---------- */
  var SKEY = "query_host";
  function getHost() { try { return JSON.parse(localStorage.getItem(SKEY) || "null"); } catch (e) { return null; } }
  function setHost(h) { localStorage.setItem(SKEY, JSON.stringify(h)); }
  function clearHost() { localStorage.removeItem(SKEY); }

  /* ---------- DB: hosts ---------- */
  function registerHost(username, name, pin) {
    var u = slug(username);
    if (u.length < 3) return Promise.reject(new Error("Username minimal 3 huruf/angka"));
    if (!name.trim()) return Promise.reject(new Error("Nama wajib diisi"));
    if (!/^\d{4,8}$/.test(String(pin))) return Promise.reject(new Error("PIN harus 4–8 angka"));
    var ref = db.collection("hosts").doc(u);
    return ref.get().then(function (d) {
      if (d.exists) throw new Error("Username '" + u + "' sudah dipakai");
      return ref.set({ username: u, name: name.trim(), pin: String(pin), createdAt: FV().serverTimestamp() });
    }).then(function () { return { user: u, name: name.trim(), pin: String(pin) }; });
  }
  function loginHost(username, pin) {
    var u = slug(username);
    return db.collection("hosts").doc(u).get().then(function (d) {
      if (!d.exists) throw new Error("Username tidak ditemukan");
      var data = d.data();
      if (String(data.pin) !== String(pin)) throw new Error("PIN salah");
      return { user: u, name: data.name, pin: String(data.pin) };
    });
  }

  /* ---------- DB: events ---------- */
  function genCode() { var c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", s = ""; for (var i = 0; i < 6; i++) s += c[Math.floor(Math.random() * c.length)]; return s; }
  function createEvent(host, eventName, materi, type) {
    function attempt(tries) {
      var code = genCode(), ref = db.collection("events").doc(code);
      return ref.get().then(function (d) {
        if (d.exists) { if (tries > 5) throw new Error("Gagal membuat kode"); return attempt(tries + 1); }
        var doc = { code: code, hostUser: host.user, hostName: host.name, eventName: eventName.trim(), materi: (materi || "").trim(), type: (type || "qna"), createdAt: FV().serverTimestamp() };
        if (type === "survey") doc.fields = [];
        return ref.set(doc).then(function () { return code; });
      });
    }
    return attempt(0);
  }
  function saveFieldsDB(code, fields) { return db.collection("events").doc(code).update({ fields: fields }); }

  /* ---------- DB: responses (subkoleksi survei per event) ---------- */
  function rcol(code) { return db.collection("events").doc(code).collection("responses"); }
  function addResponse(code, name, answers) { return rcol(code).add({ name: (name || "").trim() || "Anonim", answers: answers, createdAt: FV().serverTimestamp() }); }
  function subscribeResponses(code, cb) {
    return rcol(code).orderBy("createdAt", "asc").onSnapshot(function (snap) {
      var arr = []; snap.forEach(function (d) { var x = d.data(); arr.push({ id: d.id, name: x.name, answers: x.answers || {}, createdAt: x.createdAt }); });
      cb(arr);
    });
  }
  function listEvents(hostUser) {
    return db.collection("events").where("hostUser", "==", hostUser).get().then(function (snap) {
      var arr = []; snap.forEach(function (d) { arr.push(d.data()); });
      arr.sort(function (a, b) { return (b.createdAt && b.createdAt.seconds || 0) - (a.createdAt && a.createdAt.seconds || 0); });
      return arr;
    });
  }
  function getEvent(code) { return db.collection("events").doc(code).get().then(function (d) { return d.exists ? d.data() : null; }); }
  function deleteEvent(code) { return db.collection("events").doc(code).delete(); }

  /* ---------- DB: questions (subkoleksi per event) ---------- */
  function qcol(code) { return db.collection("events").doc(code).collection("questions"); }
  function addQuestion(code, text, name) { return qcol(code).add({ text: String(text).trim(), name: (name || "").trim() || "Anonim", reactions: { like: 0 }, replies: [], answered: false, answer: "", createdAt: FV().serverTimestamp() }); }
  function subscribeQ(code, cb) {
    return qcol(code).orderBy("createdAt", "asc").onSnapshot(function (snap) {
      var items = []; snap.forEach(function (d) { var x = d.data(); items.push({ id: d.id, text: x.text, name: x.name, reactions: x.reactions || { like: 0 }, replies: x.replies || [], answered: !!x.answered, answer: x.answer || "", createdAt: x.createdAt }); });
      cb(items);
    });
  }
  function reactQ(code, id, delta) { return qcol(code).doc(id).update({ "reactions.like": FV().increment(delta) }); }
  function replyQ(code, id, text, name, presenter) { return qcol(code).doc(id).update({ replies: FV().arrayUnion({ rid: uid(), text: String(text).trim(), name: (name || "").trim() || "Anonim", ts: Date.now(), presenter: !!presenter }) }); }
  function answerQ(code, id, answer, answered) { return qcol(code).doc(id).update({ answer: answer, answered: !!answered }); }
  function removeQ(code, id) { return qcol(code).doc(id).delete(); }

  /* ---------- Navbar kanan ---------- */
  function setNav() {
    var nr = $("navRight"); if (!nr) return;
    var h = getHost();
    if (h) nr.innerHTML = '<span class="nlink" onclick="QUERY.go(\'/dashboard\')">📋 ' + esc(h.name) + '</span>';
    else nr.innerHTML = '<span class="nlink" onclick="QUERY.go(\'/\')">Host masuk</span>';
  }

  /* ============================================================
     ROUTER
     ============================================================ */
  function route() {
    if (!configured) { view().innerHTML = '<div class="page"><div class="card center">⚠️ Firebase belum dikonfigurasi (isi <code>config.js</code>).</div></div>'; return; }
    var h = (location.hash || "").replace(/^#/, "") || "/";
    setNav();
    var m;
    if (h === "/" || h === "") return renderLanding();
    if (h === "/dashboard") return renderDashboard();
    if ((m = h.match(/^\/build\/([A-Za-z0-9]+)$/))) return renderBuilder(m[1].toUpperCase());
    if ((m = h.match(/^\/e\/([A-Za-z0-9]+)$/))) return renderSession(m[1].toUpperCase());
    return renderLanding();
  }

  /* ============================================================
     LANDING — gabung event + login/daftar host
     ============================================================ */
  function renderLanding() {
    var h = getHost();
    var brand = brandHTML();
    var hostBox = h
      ? '<div class="card center"><h3 class="sec">Halo, ' + esc(h.name) + ' 👋</h3>' +
        '<p class="muted" style="margin:6px 0 14px">Anda sudah masuk sebagai host.</p>' +
        '<button class="btn block" onclick="QUERY.go(\'/dashboard\')">Buka Dashboard Saya</button>' +
        '<div style="margin-top:10px"><button class="btn ghost small" onclick="QUERY.logout()">Keluar</button></div></div>'
      : '<div class="card">' +
        '<div class="seg"><button id="segLogin" class="active" onclick="QUERY.seg(\'login\')">Masuk</button><button id="segReg" onclick="QUERY.seg(\'reg\')">Daftar Host</button></div>' +
        '<div id="authBody"></div></div>';

    view().innerHTML =
      '<div class="page">' + brand +
      '<div class="card" style="margin-bottom:16px">' +
        '<h3 class="sec center">Gabung Diskusi</h3>' +
        '<p class="muted center" style="margin:6px 0 12px;font-size:.88rem">Punya kode dari pemateri? Masukkan di sini.</p>' +
        '<div class="code-input"><input type="text" id="joinCode" maxlength="6" placeholder="KODE" /></div>' +
        '<button class="btn block" style="margin-top:12px" onclick="QUERY.join()">Gabung</button>' +
      '</div>' +
      '<div class="divider">atau sebagai pemateri</div>' +
      hostBox +
      '</div>';

    if (!h) { seg("login"); }
    var jc = $("joinCode"); if (jc) jc.addEventListener("keydown", function (e) { if (e.key === "Enter") join(); });
  }
  function brandHTML() {
    return '<div class="brand"><a href="#/"><img src="query-logo.png" alt="QUERY — Suara Insan Astra" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'block\'" />' +
      '<span class="bfallback">QUERY</span></a><div class="bsub">' + esc(CFG.APP_TAGLINE || "Malu Bertanya, Sesat di Jalan") + '</div></div>';
  }
  function seg(which) {
    var sl = $("segLogin"), sr = $("segReg"), body = $("authBody"); if (!body) return;
    if (which === "reg") { sr.classList.add("active"); sl.classList.remove("active"); body.innerHTML = regForm(); $("regUser").focus(); }
    else { sl.classList.add("active"); sr.classList.remove("active"); body.innerHTML = loginForm(); $("logUser").focus(); }
  }
  function loginForm() {
    return '<label class="fld">Username</label><input type="text" id="logUser" placeholder="username Anda" />' +
      '<label class="fld">PIN</label><input type="password" id="logPin" inputmode="numeric" placeholder="PIN" onkeydown="if(event.key===\'Enter\')QUERY.login()" />' +
      '<button class="btn block" style="margin-top:16px" onclick="QUERY.login()">Masuk</button>';
  }
  function regForm() {
    return '<label class="fld">Nama lengkap (tampil ke audience)</label><input type="text" id="regName" maxlength="40" placeholder="mis. Sudana — CHCD" />' +
      '<label class="fld">Username (untuk login)</label><input type="text" id="regUser" maxlength="20" placeholder="huruf/angka, tanpa spasi" />' +
      '<label class="fld">Buat PIN (4–8 angka)</label><input type="password" id="regPin" inputmode="numeric" value="1234" />' +
      '<div class="hintline">PIN dipakai untuk masuk & menjawab di sesi Anda. Default 1234 — sebaiknya ganti.</div>' +
      '<button class="btn block" style="margin-top:16px" onclick="QUERY.register()">Daftar & Masuk</button>';
  }
  function doLogin() {
    var u = $("logUser").value, p = $("logPin").value;
    if (!u.trim() || !p.trim()) { toast("Isi username & PIN"); return; }
    loginHost(u, p).then(function (host) { setHost(host); toast("Selamat datang, " + host.name); go("/dashboard"); })
      .catch(function (e) { toast(e.message || "Gagal masuk"); });
  }
  function doRegister() {
    var name = $("regName").value, u = $("regUser").value, p = $("regPin").value;
    registerHost(u, name, p).then(function (host) { setHost(host); toast("Akun host dibuat 🎉"); go("/dashboard"); })
      .catch(function (e) { toast(e.message || "Gagal daftar"); });
  }
  function doJoin() {
    var c = ($("joinCode").value || "").trim().toUpperCase();
    if (c.length < 4) { toast("Masukkan kode event"); return; }
    go("/e/" + c);
  }

  /* ============================================================
     DASHBOARD — kelola event
     ============================================================ */
  function renderDashboard() {
    var h = getHost();
    if (!h) { go("/"); return; }
    view().innerHTML =
      '<div class="page">' +
      '<div class="dash-head"><div class="hi">Dashboard<small>Host: ' + esc(h.name) + ' (@' + esc(h.user) + ')</small></div>' +
      '<button class="btn ghost small" onclick="QUERY.logout()">Keluar</button></div>' +
      '<div class="card" style="margin-bottom:18px">' +
        '<h3 class="sec">➕ Buat Sesi Baru</h3>' +
        '<label class="fld">Jenis Sesi</label>' +
        '<div class="seg" id="typeSeg"><button class="active" onclick="QUERY.pickType(\'qna\',this)">💬 Diskusi Q&amp;A</button><button onclick="QUERY.pickType(\'survey\',this)">📋 Kuesioner</button></div>' +
        '<label class="fld">Nama Event / Forum</label><input type="text" id="evName" maxlength="60" placeholder="mis. Kopdar CHCD" />' +
        '<label class="fld">Nama Materi / Agenda</label><input type="text" id="evMateri" maxlength="100" placeholder="mis. Sosialisasi Juklak Pengadaan Barang dan Jasa" />' +
        '<div class="hintline" id="typeHint">Sesi tanya-jawab live dengan reaksi & balasan.</div>' +
        '<button class="btn block" style="margin-top:16px" onclick="QUERY.createEvent()">Buat Sesi</button>' +
      '</div>' +
      '<h3 class="sec" style="margin:4px 2px 12px">Event Saya</h3>' +
      '<div id="evList"><div class="empty">Memuat…</div></div>' +
      '</div>';
    loadEvents();
  }
  function loadEvents() {
    var h = getHost(); if (!h) return;
    listEvents(h.user).then(function (events) {
      var el = $("evList"); if (!el) return;
      if (!events.length) { el.innerHTML = '<div class="empty">Belum ada event. Buat event pertama Anda di atas 👆</div>'; return; }
      el.innerHTML = events.map(function (ev) {
        var link = sessionURL(ev.code);
        var qr = "https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=10&data=" + encodeURIComponent(link);
        var isSurvey = ev.type === "survey";
        var typeBadge = isSurvey
          ? '<span class="badge" style="background:#efe7fb;color:#6d34d6">📋 Kuesioner</span>'
          : '<span class="badge" style="background:var(--astra-soft);color:var(--astra-dark)">💬 Diskusi Q&amp;A</span>';
        var mainBtns = isSurvey
          ? '<button class="btn small" onclick="QUERY.go(\'/e/' + ev.code + '\')">📊 Lihat Hasil</button>' +
            '<button class="btn ghost small" onclick="QUERY.go(\'/build/' + ev.code + '\')">📝 Edit Pertanyaan (' + ((ev.fields || []).length) + ')</button>'
          : '<button class="btn small" onclick="QUERY.go(\'/e/' + ev.code + '\')">Buka Sesi</button>';
        return '<div class="ev-card">' +
          '<div style="margin-bottom:6px">' + typeBadge + '</div>' +
          '<div class="en">' + esc(ev.eventName) + '</div>' +
          (ev.materi ? '<div class="em">' + esc(ev.materi) + '</div>' : '') +
          '<div class="ev-code">Kode: ' + esc(ev.code) + '</div>' +
          '<div class="ev-actions">' +
            mainBtns +
            '<button class="btn ghost small" onclick="QUERY.share(\'' + ev.code + '\')">QR & Link</button>' +
            '<button class="btn ghost small" onclick="QUERY.copy(\'' + esc(link) + '\')">Salin Link</button>' +
            '<button class="btn ghost small danger" onclick="QUERY.delEvent(\'' + ev.code + '\')">Hapus</button>' +
          '</div>' +
          '<div class="share-box" id="share_' + ev.code + '"><img alt="QR" src="' + qr + '" /><div class="lnk">' + esc(link) + '</div></div>' +
        '</div>';
      }).join("");
    }).catch(function (e) { var el = $("evList"); if (el) el.innerHTML = '<div class="empty">Gagal memuat: ' + esc(e.message) + '</div>'; });
  }
  function sessionURL(code) { return location.origin + location.pathname + "#/e/" + code; }
  var newType = "qna";
  function pickType(t, btn) {
    newType = t;
    var seg = $("typeSeg"); if (seg) { var bs = seg.getElementsByTagName("button"); for (var i = 0; i < bs.length; i++) bs[i].classList.remove("active"); }
    if (btn) btn.classList.add("active");
    var hint = $("typeHint"); if (hint) hint.textContent = t === "survey" ? "Kuesioner ala MS Forms — Anda susun pertanyaannya, hasil tampil live & bisa diringkas." : "Sesi tanya-jawab live dengan reaksi & balasan.";
  }
  function doCreateEvent() {
    var h = getHost(); if (!h) { go("/"); return; }
    var name = ($("evName").value || "").trim(), materi = ($("evMateri").value || "").trim();
    if (!name) { toast("Isi nama sesi dulu"); return; }
    var t = newType;
    createEvent(h, name, materi, t).then(function (code) {
      toast("Sesi dibuat — kode " + code);
      $("evName").value = ""; $("evMateri").value = "";
      if (t === "survey") go("/build/" + code); else loadEvents();
    }).catch(function (e) { toast(e.message || "Gagal membuat sesi"); });
  }
  function doShare(code) { var b = $("share_" + code); if (b) b.classList.toggle("open"); }
  function doCopy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast("Link disalin ✓"); }, function () { toast(text); });
    else { toast(text); }
  }
  function doDelEvent(code) {
    if (!confirm("Hapus event " + code + " beserta semua pertanyaannya? Tindakan ini permanen.")) return;
    deleteEvent(code).then(function () { toast("Event dihapus"); loadEvents(); }).catch(function () { toast("Gagal hapus"); });
  }

  /* ============================================================
     SESSION — papan diskusi sebuah event
     ============================================================ */
  var sess = null; // { code, event, isOwner, items, unsub, sortByTop, openReply, openAnswer, reacts }
  function renderSession(code) {
    if (sess && sess.unsub) { try { sess.unsub(); } catch (e) {} }
    view().innerHTML = '<div class="wrap"><div class="empty">Memuat sesi…</div></div>';
    getEvent(code).then(function (ev) {
      if (!ev) { view().innerHTML = '<div class="page"><div class="card center"><h3 class="sec">Event tidak ditemukan</h3><p class="muted" style="margin:8px 0 14px">Kode <b>' + esc(code) + '</b> tidak ada.</p><button class="btn" onclick="QUERY.go(\'/\')">Kembali</button></div></div>'; return; }
      var host = getHost();
      var isOwner = !!(host && host.user === ev.hostUser);
      sess = { code: code, event: ev, isOwner: isOwner, items: [], sortByTop: true, openReply: {}, openAnswer: {}, host: host,
        reacts: JSON.parse(localStorage.getItem("query_reacts") || "{}"), name: localStorage.getItem("query_name") || (isOwner ? host.name : "") };
      if (ev.type === "survey") { renderSurveySession(); return; }
      buildSessionDOM();
      sess.unsub = subscribeQ(code, function (data) { sess.items = data; renderFeed(); });
    }).catch(function (e) { view().innerHTML = '<div class="page"><div class="card center">Gagal memuat: ' + esc(e.message) + '</div></div>'; });
  }

  function buildSessionDOM() {
    var ev = sess.event, link = sessionURL(sess.code);
    var ownerBar = sess.isOwner
      ? '<div class="banner" style="background:var(--ok-soft);border-color:#b7e4c7;color:#0f7a37">✅ <b>Mode Presenter aktif</b> — Anda pemilik event ini, bisa menjawab langsung. ' +
        '<span class="nlink" style="margin-left:6px" onclick="QUERY.go(\'/dashboard\')">← Dashboard</span></div>'
      : '';
    view().innerHTML =
      '<div class="wrap">' +
      '<div class="hero">' +
        '<span class="live-pill"><span class="dot"></span> Live Q&amp;A</span>' +
        '<div class="logo-card"><img src="query-logo.png" alt="QUERY" class="query-logo-img" onerror="this.style.display=\'none\'" /></div>' +
        '<p class="tagline">' + esc(CFG.APP_TAGLINE || "Malu Bertanya, Sesat di Jalan") + '</p>' +
        '<span class="event">' + esc(ev.eventName) + '</span>' +
        (ev.materi ? '<span class="materi">' + esc(ev.materi) + '</span>' : '') +
      '</div>' +
      ownerBar +
      '<div class="card composer">' +
        '<div class="avatar" id="meAvatar" style="background:linear-gradient(135deg,#005BAA,#2f8ad6)">?</div>' +
        '<div style="flex:1">' +
          '<textarea id="qinput" maxlength="500" placeholder="Tulis pertanyaan / komentar untuk pemateri..." onkeydown="QUERY.fmtKey(event,\'qinput\')"></textarea>' +
          fmtBar("qinput") +
          '<div class="composer-foot">' +
            '<input type="text" id="ninput" maxlength="40" placeholder="Nama / inisial Anda *" />' +
            '<span class="counter" id="counter">0/500</span>' +
            '<button class="btn" id="sendBtn">Kirim</button>' +
          '</div>' +
          '<div class="field-err" id="nameErr">Silahkan isi Nama Anda</div>' +
        '</div>' +
      '</div>' +
      '<div class="bar"><h2>Diskusi</h2><span class="cnt" id="liveCount"></span><div class="grow"></div>' +
        '<button class="btn ghost small" id="sortBtn">Urutkan: Teratas</button></div>' +
      '<div id="list"></div>' +
      '</div>';

    $("ninput").value = sess.name || "";
    refreshAvatar();
    $("ninput").addEventListener("input", function () { sess.name = $("ninput").value; localStorage.setItem("query_name", sess.name); refreshAvatar(); nameError(false); });
    $("qinput").addEventListener("input", function (e) { $("counter").textContent = e.target.value.length + "/500"; });
    $("sendBtn").addEventListener("click", sendQuestion);
    $("sortBtn").addEventListener("click", function () { sess.sortByTop = !sess.sortByTop; $("sortBtn").textContent = "Urutkan: " + (sess.sortByTop ? "Teratas" : "Terbaru"); renderFeed(); });
  }
  function refreshAvatar() { var n = ($("ninput").value || "").trim(); var a = $("meAvatar"); if (a) { a.textContent = n ? n[0].toUpperCase() : "?"; a.style.background = avColor(n || "?"); } }
  function nameError(show) {
    var n = $("ninput"), e = $("nameErr"); if (!n) return;
    if (show) { n.style.setProperty("border-color", "#e0245e", "important"); n.style.setProperty("box-shadow", "0 0 0 4px rgba(224,36,94,.16)", "important"); n.style.setProperty("background", "#fff5f8", "important"); if (e) e.style.display = "block"; n.focus(); }
    else { n.style.removeProperty("border-color"); n.style.removeProperty("box-shadow"); n.style.removeProperty("background"); if (e) e.style.display = "none"; }
  }
  function sendQuestion() {
    var text = $("qinput").value.trim();
    if (!$("ninput").value.trim()) { nameError(true); toast("Isi nama Anda dulu"); return; }
    if (!text) { toast("Tulis sesuatu dulu ya"); return; }
    $("sendBtn").disabled = true;
    addQuestion(sess.code, text, $("ninput").value).then(function () { $("qinput").value = ""; $("counter").textContent = "0/500"; toast("Terkirim! 🙌"); })
      .catch(function () { toast("Gagal mengirim"); }).then(function () { $("sendBtn").disabled = false; });
  }

  /* ----- aksi feed (global via QUERY.*) ----- */
  function react(id) {
    sess.reacts[sess.code] = sess.reacts[sess.code] || {};
    var active = sess.reacts[sess.code][id];
    sess.reacts[sess.code][id] = !active; localStorage.setItem("query_reacts", JSON.stringify(sess.reacts)); renderFeed();
    reactQ(sess.code, id, active ? -1 : 1).catch(function () { sess.reacts[sess.code][id] = active; localStorage.setItem("query_reacts", JSON.stringify(sess.reacts)); renderFeed(); toast("Gagal"); });
  }
  function toggleReply(id) { sess.openReply[id] = !sess.openReply[id]; renderFeed(); var el = $("ri_" + id); if (el) el.focus(); }
  function sendReply(id) {
    var inp = $("ri_" + id), text = inp.value.trim();
    if (!text) { toast("Tulis balasan dulu"); return; }
    if (!$("ninput").value.trim()) { nameError(true); toast("Isi nama Anda dulu"); return; }
    inp.disabled = true;
    replyQ(sess.code, id, text, $("ninput").value, sess.isOwner).then(function () { var i2 = $("ri_" + id); if (i2) i2.value = ""; toast(sess.isOwner ? "Balasan presenter terkirim ✓" : "Balasan terkirim"); })
      .catch(function () { toast("Gagal membalas"); }).then(function () { var i2 = $("ri_" + id); if (i2) i2.disabled = false; });
  }
  function openAnswer(id) { sess.openAnswer[id] = !sess.openAnswer[id]; renderFeed(); var el = $("ans_" + id); if (el) { el.focus(); el.selectionStart = el.value.length; } }
  function saveAnswer(id) {
    var ta = $("ans_" + id), text = ta.value.trim();
    if (!text) { toast("Tulis jawaban dulu"); return; }
    sess.openAnswer[id] = false;
    answerQ(sess.code, id, text, true).then(function () { toast("Jawaban tampil ke semua ✓"); }).catch(function () { toast("Gagal menyimpan"); });
    renderFeed();
  }
  function unanswer(id) { sess.openAnswer[id] = false; answerQ(sess.code, id, "", false).then(function () { toast("Ditandai belum dijawab"); }).catch(function () { toast("Gagal"); }); renderFeed(); }
  function delQ(id) { if (!confirm("Hapus pertanyaan ini?")) return; removeQ(sess.code, id).then(function () { toast("Dihapus"); }).catch(function () { toast("Gagal hapus"); }); }

  function reactBtns(q) {
    var on = sess.reacts[sess.code] && sess.reacts[sess.code][q.id];
    var like = q.reactions.like || 0, rep = (q.replies || []).length;
    return '<div class="actions">' +
      '<button class="act ' + (on ? "on like" : "") + '" onclick="QUERY.react(\'' + q.id + '\')">👍 <b>' + like + '</b></button>' +
      '<button class="act" onclick="QUERY.toggleReply(\'' + q.id + '\')">💬 <b>' + (rep || "") + '</b> Balas</button>' +
      '</div>';
  }
  function repliesBlock(q) {
    var list = (q.replies || []).slice().sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
    var html = list.map(function (rp) {
      return '<div class="reply">' + avatarHTML(rp.name, true, rp.presenter) +
        '<div class="reply-body"><span class="cname">' + esc(rp.name || "Anonim") + '</span>' + (rp.presenter ? vcheck() : "") + ' <span class="ctime">' + ago(rp.ts) + '</span>' +
        '<div class="ctext">' + mdInline(rp.text) + '</div></div></div>';
    }).join("");
    var comp = sess.openReply[q.id] ? '<div class="reply-composer">' + avatarHTML($("ninput") ? $("ninput").value : "", true, sess.isOwner) +
      '<input type="text" id="ri_' + q.id + '" maxlength="300" placeholder="Tulis balasan..." onkeydown="if(event.key===\'Enter\')QUERY.sendReply(\'' + q.id + '\')" />' +
      '<button class="btn small" onclick="QUERY.sendReply(\'' + q.id + '\')">Kirim</button></div>' : "";
    if (!html && !comp) return "";
    return '<div class="replies">' + html + comp + '</div>';
  }
  function adminBlock(q) {
    if (!sess.isOwner) return "";
    if (sess.openAnswer[q.id]) {
      return '<div class="answer-edit"><textarea id="ans_' + q.id + '" placeholder="Ketik jawaban yang akan tampil ke semua audience..." onkeydown="QUERY.fmtKey(event,\'ans_' + q.id + '\')">' + esc(q.answer || "") + '</textarea>' +
        fmtBar("ans_" + q.id) +
        '<div class="row-actions"><button class="btn small" onclick="QUERY.saveAnswer(\'' + q.id + '\')">Simpan &amp; tampilkan</button>' +
        '<button class="btn ghost small" onclick="QUERY.openAnswer(\'' + q.id + '\')">Batal</button>' +
        (q.answered ? '<button class="btn ghost small danger" onclick="QUERY.unanswer(\'' + q.id + '\')">Tandai belum</button>' : '') + '</div></div>';
    }
    return '<div class="row-actions">' +
      '<button class="act admin" onclick="QUERY.openAnswer(\'' + q.id + '\')">' + (q.answered ? "✏️ Edit jawaban" : "✍️ Jawab") + '</button>' +
      '<button class="act admin danger" onclick="QUERY.delQ(\'' + q.id + '\')">🗑️ Hapus</button></div>';
  }
  function score(q) { return (q.reactions && q.reactions.like || 0); }
  function renderFeed() {
    var list = $("list"); if (!list) return;
    var lc = $("liveCount"); if (lc) lc.textContent = sess.items.length ? "(" + sess.items.length + ")" : "";
    if (!sess.items.length) { list.innerHTML = '<div class="empty">Belum ada diskusi. Jadilah yang pertama! 👆</div>'; return; }

    var focusId = document.activeElement && document.activeElement.id ? document.activeElement.id : null, caret = null, drafts = {};
    var fields = list.querySelectorAll("textarea, input");
    for (var i = 0; i < fields.length; i++) { if (fields[i].id) drafts[fields[i].id] = fields[i].value; }
    if (focusId && document.activeElement.selectionStart != null) caret = document.activeElement.selectionStart;

    var sorted = sess.items.slice().sort(function (a, b) { return sess.sortByTop ? (score(b) - score(a)) || (tsOf(b) - tsOf(a)) : (tsOf(b) - tsOf(a)); });
    list.innerHTML = sorted.map(function (q) {
      return '<div class="post"><div class="post-head"><div class="avatar" style="background:' + avColor(q.name) + '">' + esc(initial(q.name)) + '</div>' +
        '<div><span class="cname">' + esc(q.name || "Anonim") + '</span> <span class="ctime">' + ago(tsOf(q)) + '</span>' +
        (q.answered ? ' <span class="badge answered">Dijawab pemateri</span>' : "") + '</div></div>' +
        '<div class="qtext">' + mdInline(q.text) + '</div>' +
        (q.answered && q.answer ? '<div class="answerbox"><div class="lbl">📌 Jawaban pemateri ' + vcheck() + '</div><div class="txt">' + mdInline(q.answer) + '</div></div>' : "") +
        reactBtns(q) + adminBlock(q) + repliesBlock(q) + '</div>';
    }).join("");

    Object.keys(drafts).forEach(function (id) { if (id.indexOf("ans_") === 0 || id.indexOf("ri_") === 0) { var el = $(id); if (el) el.value = drafts[id]; } });
    if (focusId) { var fe = $(focusId); if (fe) { fe.focus(); if (caret != null && fe.setSelectionRange) { try { fe.setSelectionRange(caret, caret); } catch (e) {} } } }
  }

  /* ============================================================
     KUESIONER (survey): builder, form, hasil live
     ============================================================ */
  var FTYPES = [
    { v: "single", label: "Pilihan ganda (1 jawaban)" },
    { v: "multi", label: "Kotak centang (banyak jawaban)" },
    { v: "rating", label: "Skala / Rating 1–5" },
    { v: "short", label: "Teks singkat" },
    { v: "long", label: "Teks panjang" }
  ];
  function ftypeLabel(v) { for (var i = 0; i < FTYPES.length; i++) if (FTYPES[i].v === v) return FTYPES[i].label; return v; }
  function needsOptions(t) { return t === "single" || t === "multi"; }
  function heroHTML(ev, pill) {
    return '<div class="hero">' +
      '<span class="live-pill"><span class="dot"></span> ' + esc(pill || "Kuesioner") + '</span>' +
      '<div class="logo-card"><img src="query-logo.png" alt="QUERY" class="query-logo-img" onerror="this.style.display=\'none\'" /></div>' +
      '<p class="tagline">' + esc(CFG.APP_TAGLINE || "Malu Bertanya, Sesat di Jalan") + '</p>' +
      '<span class="event">' + esc(ev.eventName) + '</span>' +
      (ev.materi ? '<span class="materi">' + esc(ev.materi) + '</span>' : '') + '</div>';
  }
  function shareBoxHTML(code) {
    var link = sessionURL(code), qr = "https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=10&data=" + encodeURIComponent(link);
    return '<div class="share-box" id="share_' + code + '"><img alt="QR" src="' + qr + '" /><div class="lnk">' + esc(link) + '</div></div>';
  }

  /* ----- Builder ----- */
  var builder = null;
  function renderBuilder(code) {
    var host = getHost();
    view().innerHTML = '<div class="page"><div class="empty">Memuat…</div></div>';
    getEvent(code).then(function (ev) {
      if (!ev) { view().innerHTML = '<div class="page"><div class="card center">Sesi tidak ditemukan.</div></div>'; return; }
      if (!host || host.user !== ev.hostUser) { view().innerHTML = '<div class="page"><div class="card center"><h3 class="sec">Khusus host</h3><p class="muted" style="margin:8px 0 14px">Hanya host pemilik yang bisa menyusun pertanyaan.</p><button class="btn" onclick="QUERY.go(\'/\')">Masuk sebagai host</button></div></div>'; return; }
      builder = { code: code, event: ev, fields: (ev.fields || []).slice() };
      view().innerHTML =
        '<div class="page">' +
        '<button class="back-link" onclick="QUERY.go(\'/dashboard\')">← Dashboard</button>' +
        '<h3 class="sec">📝 Susun Pertanyaan</h3>' +
        '<p class="muted" style="margin:2px 0 14px">' + esc(ev.eventName) + '</p>' +
        '<div id="fieldList"></div>' +
        '<div class="card" style="margin-top:14px">' +
          '<h3 class="sec" style="font-size:.98rem">➕ Tambah Pertanyaan</h3>' +
          '<label class="fld">Jenis</label>' +
          '<select id="nfType" onchange="QUERY.nfType()">' + FTYPES.map(function (t) { return '<option value="' + t.v + '">' + esc(t.label) + '</option>'; }).join("") + '</select>' +
          '<label class="fld">Pertanyaan</label><input type="text" id="nfLabel" maxlength="120" placeholder="Tulis pertanyaan..." />' +
          '<div id="nfOptWrap"><label class="fld">Pilihan jawaban (satu per baris)</label><textarea id="nfOpts" placeholder="Opsi A&#10;Opsi B&#10;Opsi C"></textarea></div>' +
          '<label class="chk"><input type="checkbox" id="nfReq" /> Wajib diisi</label>' +
          '<button class="btn block" style="margin-top:14px" onclick="QUERY.addField()">+ Tambah</button>' +
        '</div>' +
        '<div class="ev-actions" style="margin-top:16px">' +
          '<button class="btn" onclick="QUERY.go(\'/e/' + code + '\')">📊 Lihat Hasil</button>' +
          '<button class="btn ghost" onclick="QUERY.share(\'' + code + '\')">QR & Link (bagikan ke responden)</button>' +
        '</div>' + shareBoxHTML(code) +
        '<div style="height:24px"></div></div>';
      renderBuilderList(); nfTypeUI();
    }).catch(function (e) { view().innerHTML = '<div class="page"><div class="card center">Gagal memuat: ' + esc(e.message) + '</div></div>'; });
  }
  function renderBuilderList() {
    var el = $("fieldList"); if (!el) return;
    if (!builder.fields.length) { el.innerHTML = '<div class="empty" style="padding:22px">Belum ada pertanyaan. Tambah di bawah 👇</div>'; return; }
    el.innerHTML = builder.fields.map(function (f, i) {
      var opts = (f.options && f.options.length) ? '<div class="muted" style="font-size:.82rem;margin-top:5px">Opsi: ' + f.options.map(esc).join(" · ") + '</div>' : '';
      return '<div class="ev-card"><div style="display:flex;gap:10px;align-items:flex-start">' +
        '<div style="flex:1"><div class="en" style="font-size:.98rem">' + (i + 1) + '. ' + esc(f.label) + (f.required ? ' <span style="color:#e0245e">*</span>' : '') + '</div>' +
        '<div class="badge" style="margin-top:6px;background:var(--astra-soft);color:var(--astra-dark)">' + esc(ftypeLabel(f.type)) + '</div>' + opts + '</div>' +
        '<div style="display:flex;flex-direction:column;gap:5px">' +
          '<button class="btn ghost small" onclick="QUERY.moveField(\'' + f.fid + '\',-1)">↑</button>' +
          '<button class="btn ghost small" onclick="QUERY.moveField(\'' + f.fid + '\',1)">↓</button>' +
          '<button class="btn ghost small danger" onclick="QUERY.delField(\'' + f.fid + '\')">✕</button>' +
        '</div></div></div>';
    }).join("");
  }
  function nfTypeUI() { var t = $("nfType"); if (!t) return; var w = $("nfOptWrap"); if (w) w.style.display = needsOptions(t.value) ? "block" : "none"; }
  function persistBuilder(cb) { saveFieldsDB(builder.code, builder.fields).then(function () { if (cb) cb(); }).catch(function () { toast("Gagal menyimpan"); }); }
  function addField() {
    var type = $("nfType").value, label = ($("nfLabel").value || "").trim();
    if (!label) { toast("Isi pertanyaannya dulu"); return; }
    var options = [];
    if (needsOptions(type)) { options = ($("nfOpts").value || "").split("\n").map(function (s) { return s.trim(); }).filter(Boolean); if (options.length < 2) { toast("Beri minimal 2 pilihan jawaban"); return; } }
    builder.fields.push({ fid: uid().slice(0, 8), type: type, label: label, options: options, required: $("nfReq").checked });
    persistBuilder(function () { $("nfLabel").value = ""; $("nfOpts").value = ""; $("nfReq").checked = false; renderBuilderList(); toast("Pertanyaan ditambah ✓"); });
  }
  function delField(fid) { if (!confirm("Hapus pertanyaan ini?")) return; builder.fields = builder.fields.filter(function (f) { return f.fid !== fid; }); persistBuilder(renderBuilderList); }
  function moveField(fid, dir) {
    var i = -1; for (var k = 0; k < builder.fields.length; k++) if (builder.fields[k].fid === fid) i = k;
    if (i < 0) return; var j = i + dir; if (j < 0 || j >= builder.fields.length) return;
    var t = builder.fields[i]; builder.fields[i] = builder.fields[j]; builder.fields[j] = t; persistBuilder(renderBuilderList);
  }

  /* ----- Sesi survei: form (audience) / hasil (host) ----- */
  function renderSurveySession() { if (sess.isOwner) renderSurveyResults(); else renderSurveyForm(); }

  function renderSurveyForm() {
    var ev = sess.event, fields = ev.fields || [];
    if (localStorage.getItem("query_sub_" + sess.code)) { showThanks(); return; }
    if (!fields.length) { view().innerHTML = '<div class="wrap">' + heroHTML(ev, "Kuesioner") + '<div class="card center">Kuesioner ini belum memiliki pertanyaan.</div></div>'; return; }
    var body = fields.map(function (f, i) { return '<div class="qfield"><div class="qflabel">' + (i + 1) + '. ' + esc(f.label) + (f.required ? ' <span style="color:#e0245e">*</span>' : '') + '</div>' + fieldInput(f) + '</div>'; }).join("");
    view().innerHTML = '<div class="wrap">' + heroHTML(ev, "Kuesioner") +
      '<div class="card"><label class="fld">Nama / inisial Anda *</label><input type="text" id="respName" maxlength="40" placeholder="Nama Anda" />' +
      '<div class="field-err" id="nameErr">Silahkan isi Nama Anda</div></div>' +
      '<div class="card">' + body + '</div>' +
      '<button class="btn block" id="subBtn" onclick="QUERY.submitSurvey()">Kirim Jawaban</button><div style="height:30px"></div></div>';
    $("respName").value = sess.name || "";
    $("respName").addEventListener("input", function () { respErr(false); });
  }
  function fieldInput(f) {
    if (f.type === "short") return '<input type="text" id="fi_' + f.fid + '" maxlength="150" placeholder="Jawaban singkat" />';
    if (f.type === "long") return '<textarea id="fi_' + f.fid + '" maxlength="600" placeholder="Jawaban Anda"></textarea>';
    if (f.type === "rating") { var r = ""; for (var n = 1; n <= 5; n++) r += '<button type="button" class="rate" data-v="' + n + '" onclick="QUERY.pickRate(\'' + f.fid + '\',' + n + ')">' + n + '</button>'; return '<div class="rate-row" id="fi_' + f.fid + '">' + r + '</div>'; }
    if (f.type === "single" || f.type === "multi") { var t = f.type === "single" ? "radio" : "checkbox"; return '<div class="opts" id="fi_' + f.fid + '">' + f.options.map(function (o) { return '<label class="opt"><input type="' + t + '" name="fi_' + f.fid + '" value="' + esc(o) + '" /> <span>' + esc(o) + '</span></label>'; }).join("") + '</div>'; }
    return "";
  }
  function pickRate(fid, v) { var row = $("fi_" + fid); if (!row) return; row.setAttribute("data-val", v); var bs = row.getElementsByTagName("button"); for (var i = 0; i < bs.length; i++) bs[i].classList.toggle("on", parseInt(bs[i].getAttribute("data-v"), 10) <= v); }
  function getFieldValue(f) {
    var el = $("fi_" + f.fid); if (!el) return "";
    if (f.type === "short" || f.type === "long") return (el.value || "").trim();
    if (f.type === "rating") { var v = el.getAttribute("data-val"); return v ? parseInt(v, 10) : ""; }
    if (f.type === "single") { var r = el.querySelector("input:checked"); return r ? r.value : ""; }
    if (f.type === "multi") { return [].slice.call(el.querySelectorAll("input:checked")).map(function (c) { return c.value; }); }
    return "";
  }
  function respErr(show) { var n = $("respName"), e = $("nameErr"); if (!n) return; if (show) { n.style.setProperty("border-color", "#e0245e", "important"); n.style.setProperty("box-shadow", "0 0 0 4px rgba(224,36,94,.16)", "important"); if (e) e.style.display = "block"; n.focus(); } else { n.style.removeProperty("border-color"); n.style.removeProperty("box-shadow"); if (e) e.style.display = "none"; } }
  function submitSurvey() {
    var ev = sess.event, fields = ev.fields || [], name = ($("respName").value || "").trim();
    if (!name) { respErr(true); toast("Isi nama Anda dulu"); return; }
    var answers = {};
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i], val = getFieldValue(f);
      if (f.required && (val === "" || val == null || (Array.isArray(val) && !val.length))) { toast("Lengkapi: " + f.label); var el = $("fi_" + f.fid); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
      answers[f.fid] = val;
    }
    $("subBtn").disabled = true;
    addResponse(sess.code, name, answers).then(function () { localStorage.setItem("query_name", name); localStorage.setItem("query_sub_" + sess.code, "1"); showThanks(); })
      .catch(function () { toast("Gagal mengirim"); $("subBtn").disabled = false; });
  }
  function showThanks() {
    view().innerHTML = '<div class="wrap">' + heroHTML(sess.event, "Kuesioner") +
      '<div class="card center"><div style="font-size:2.6rem">🙏</div><h3 class="sec" style="margin-top:8px">Terima kasih!</h3>' +
      '<p class="muted" style="margin:8px 0 0">Jawaban Anda sudah tercatat.</p></div></div>';
  }

  function renderSurveyResults() {
    var ev = sess.event;
    view().innerHTML = '<div class="wrap">' + heroHTML(ev, "Hasil Kuesioner") +
      '<div class="banner" style="background:var(--ok-soft);border-color:#b7e4c7;color:#0f7a37">✅ <b>Hasil (khusus host)</b> — real-time. <span class="nlink" style="margin-left:6px" onclick="QUERY.go(\'/dashboard\')">← Dashboard</span></div>' +
      '<div class="ev-actions" style="margin-bottom:14px">' +
        '<button class="btn ghost small" onclick="QUERY.go(\'/build/' + sess.code + '\')">📝 Edit Pertanyaan</button>' +
        '<button class="btn ghost small" onclick="QUERY.share(\'' + sess.code + '\')">QR & Link</button>' +
        '<button class="btn secondary small" onclick="QUERY.exportSurvey()">⬇ Export CSV</button>' +
      '</div>' + shareBoxHTML(sess.code) +
      '<div id="results"><div class="empty">Menunggu respons…</div></div></div>';
    sess.unsub = subscribeResponses(sess.code, function (resp) { sess.responses = resp; renderResults(); });
  }
  function aggregate(f, resp) {
    var vals = resp.map(function (r) { return r.answers ? r.answers[f.fid] : undefined; });
    if (f.type === "rating") {
      var nums = vals.filter(function (v) { return typeof v === "number" && v > 0; });
      var sum = nums.reduce(function (a, b) { return a + b; }, 0), dist = [0, 0, 0, 0, 0];
      nums.forEach(function (v) { if (v >= 1 && v <= 5) dist[v - 1]++; });
      return { count: nums.length, avg: nums.length ? sum / nums.length : 0, dist: dist };
    }
    if (f.type === "single" || f.type === "multi") {
      var counts = {}; (f.options || []).forEach(function (o) { counts[o] = 0; });
      var respCount = 0;
      vals.forEach(function (v) {
        if (v == null || v === "" || (Array.isArray(v) && !v.length)) return; respCount++;
        if (Array.isArray(v)) v.forEach(function (o) { counts[o] = (counts[o] || 0) + 1; });
        else counts[v] = (counts[v] || 0) + 1;
      });
      var arr = Object.keys(counts).map(function (o) { return { opt: o, n: counts[o], pct: respCount ? Math.round(counts[o] / respCount * 100) : 0 }; });
      arr.sort(function (a, b) { return b.n - a.n; });
      return { counts: arr, respCount: respCount, top: (arr[0] && arr[0].n > 0) ? arr[0] : null };
    }
    var texts = vals.filter(function (v) { return typeof v === "string" && v.trim(); });
    return { count: texts.length, texts: texts };
  }
  function barRow(label, n, pct) { return '<div class="barrow"><span class="blabel">' + esc(label) + '</span><div class="bar"><div class="fill" style="width:' + pct + '%"></div></div><span class="bval">' + n + ' (' + pct + '%)</span></div>'; }
  function summaryHTML(fields, resp) {
    if (!fields.length) return "";
    var lines = fields.map(function (f) {
      var a = aggregate(f, resp);
      if (f.type === "rating") return '<li><b>' + esc(f.label) + ':</b> rata-rata <b>' + a.avg.toFixed(2) + '/5</b> (' + a.count + ' respons)</li>';
      if (f.type === "single" || f.type === "multi") { if (!a.top) return '<li><b>' + esc(f.label) + ':</b> belum ada jawaban</li>'; return '<li><b>' + esc(f.label) + ':</b> terbanyak “<b>' + esc(a.top.opt) + '</b>” (' + a.top.pct + '%)</li>'; }
      return '<li><b>' + esc(f.label) + ':</b> ' + a.count + ' jawaban teks</li>';
    }).join("");
    return '<div class="card summary"><h3 class="sec">🧭 Ringkasan — Top Management View</h3><ul class="sumlist">' + lines + '</ul></div>';
  }
  function fieldResultCard(f, resp) {
    var a = aggregate(f, resp), body = "";
    var head = '<div class="rf-q">' + esc(f.label) + '</div><div class="badge" style="background:var(--astra-soft);color:var(--astra-dark);margin-bottom:10px">' + esc(ftypeLabel(f.type)) + '</div>';
    if (f.type === "rating") {
      body = '<div class="rf-avg">' + a.avg.toFixed(2) + ' <span>/5</span> <span class="muted" style="font-size:.8rem;font-weight:600">(' + a.count + ' respons)</span></div>';
      for (var n = 5; n >= 1; n--) { var p = a.count ? Math.round(a.dist[n - 1] / a.count * 100) : 0; body += barRow(n + " ★", a.dist[n - 1], p); }
    } else if (f.type === "single" || f.type === "multi") {
      body = a.respCount ? a.counts.map(function (x) { return barRow(x.opt, x.n, x.pct); }).join("") : '<div class="muted">Belum ada jawaban</div>';
    } else {
      body = a.texts.length ? '<div class="txtlist">' + a.texts.slice(0, 60).map(function (t) { return '<div class="txtitem">' + esc(t) + '</div>'; }).join("") + '</div>' : '<div class="muted">Belum ada jawaban</div>';
    }
    return '<div class="card rf">' + head + body + '</div>';
  }
  function cellVal(v) { if (v == null) return "—"; if (Array.isArray(v)) return v.length ? v.join(", ") : "—"; if (v === "") return "—"; return String(v); }
  function tableHTML(fields, resp) {
    var thead = '<tr><th>Responden</th><th>Waktu</th>' + fields.map(function (f) { return '<th>' + esc(f.label) + '</th>'; }).join("") + '</tr>';
    var rows = resp.slice().sort(function (a, b) { return tsOf(b) - tsOf(a); }).map(function (r) {
      var cells = fields.map(function (f) { return '<td>' + esc(cellVal(r.answers ? r.answers[f.fid] : "")) + '</td>'; }).join("");
      return '<tr><td class="rname">' + esc(r.name || "Anonim") + '</td><td class="rtime">' + ago(tsOf(r)) + '</td>' + cells + '</tr>';
    }).join("");
    return '<div class="card"><h3 class="sec">📋 Tabel Respons</h3><div class="tbl-wrap"><table class="rtbl"><thead>' + thead + '</thead><tbody>' + rows + '</tbody></table></div></div>';
  }
  function renderResults() {
    var ev = sess.event, fields = ev.fields || [], resp = sess.responses || [], el = $("results"); if (!el) return;
    var head = '<div class="stats" style="margin-bottom:14px"><div class="stat"><div class="n">' + resp.length + '</div><div class="l">Responden</div></div><div class="stat"><div class="n">' + fields.length + '</div><div class="l">Pertanyaan</div></div></div>';
    if (!fields.length) { el.innerHTML = head + '<div class="empty">Belum ada pertanyaan. <span class="nlink" onclick="QUERY.go(\'/build/' + sess.code + '\')">Susun dulu →</span></div>'; return; }
    if (!resp.length) { el.innerHTML = head + '<div class="empty">Belum ada yang mengisi. Bagikan QR/link-nya 👆</div>'; return; }
    el.innerHTML = head + summaryHTML(fields, resp) + fields.map(function (f) { return fieldResultCard(f, resp); }).join("") + tableHTML(fields, resp);
  }
  function exportSurvey() {
    var ev = sess.event, fields = ev.fields || [], resp = sess.responses || [];
    var rows = [["Nama", "Waktu"].concat(fields.map(function (f) { return f.label; }))];
    resp.slice().sort(function (a, b) { return tsOf(a) - tsOf(b); }).forEach(function (r) {
      var row = [r.name || "Anonim", tsOf(r) ? new Date(tsOf(r)).toLocaleString("id-ID") : ""];
      fields.forEach(function (f) { var v = r.answers ? r.answers[f.fid] : ""; row.push(Array.isArray(v) ? v.join(" | ") : (v == null ? "" : String(v))); });
      rows.push(row);
    });
    var csv = "﻿" + rows.map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(","); }).join("\r\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "hasil-kuesioner-" + ev.code + ".csv"; a.click(); URL.revokeObjectURL(a.href);
  }

  /* ---------- API global untuk markup onclick ---------- */
  window.QUERY = {
    go: go, seg: seg, logout: function () { clearHost(); setNav(); toast("Keluar"); go("/"); },
    login: doLogin, register: doRegister, join: doJoin,
    createEvent: doCreateEvent, share: doShare, copy: doCopy, delEvent: doDelEvent,
    react: react, toggleReply: toggleReply, sendReply: sendReply, openAnswer: openAnswer, saveAnswer: saveAnswer, unanswer: unanswer, delQ: delQ,
    fmt: fmt, fmtKey: fmtKey,
    pickType: pickType, nfType: nfTypeUI, addField: addField, delField: delField, moveField: moveField,
    pickRate: pickRate, submitSurvey: submitSurvey, exportSurvey: exportSurvey
  };

  function boot() { window.addEventListener("hashchange", route); route(); }
  window.App = { boot: boot };
})();
