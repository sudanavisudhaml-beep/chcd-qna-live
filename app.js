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
  function createEvent(host, eventName, materi) {
    function attempt(tries) {
      var code = genCode(), ref = db.collection("events").doc(code);
      return ref.get().then(function (d) {
        if (d.exists) { if (tries > 5) throw new Error("Gagal membuat kode"); return attempt(tries + 1); }
        return ref.set({ code: code, hostUser: host.user, hostName: host.name, eventName: eventName.trim(), materi: (materi || "").trim(), createdAt: FV().serverTimestamp() }).then(function () { return code; });
      });
    }
    return attempt(0);
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
        '<h3 class="sec">➕ Buat Event Baru</h3>' +
        '<label class="fld">Nama Event / Forum</label><input type="text" id="evName" maxlength="60" placeholder="mis. Kopdar CHCD" />' +
        '<label class="fld">Nama Materi / Agenda</label><input type="text" id="evMateri" maxlength="100" placeholder="mis. Sosialisasi Juklak Pengadaan Barang dan Jasa" />' +
        '<button class="btn block" style="margin-top:16px" onclick="QUERY.createEvent()">Buat Event</button>' +
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
        return '<div class="ev-card">' +
          '<div class="en">' + esc(ev.eventName) + '</div>' +
          (ev.materi ? '<div class="em">' + esc(ev.materi) + '</div>' : '') +
          '<div class="ev-code">Kode: ' + esc(ev.code) + '</div>' +
          '<div class="ev-actions">' +
            '<button class="btn small" onclick="QUERY.go(\'/e/' + ev.code + '\')">Buka Sesi</button>' +
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
  function doCreateEvent() {
    var h = getHost(); if (!h) { go("/"); return; }
    var name = ($("evName").value || "").trim(), materi = ($("evMateri").value || "").trim();
    if (!name) { toast("Isi nama event dulu"); return; }
    createEvent(h, name, materi).then(function (code) { toast("Event dibuat — kode " + code); loadEvents(); $("evName").value = ""; $("evMateri").value = ""; })
      .catch(function (e) { toast(e.message || "Gagal membuat event"); });
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
          '<textarea id="qinput" maxlength="500" placeholder="Tulis pertanyaan / komentar untuk pemateri..."></textarea>' +
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
        '<div class="ctext">' + esc(rp.text) + '</div></div></div>';
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
      return '<div class="answer-edit"><textarea id="ans_' + q.id + '" placeholder="Ketik jawaban yang akan tampil ke semua audience...">' + esc(q.answer || "") + '</textarea>' +
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
        '<div class="qtext">' + esc(q.text) + '</div>' +
        (q.answered && q.answer ? '<div class="answerbox"><div class="lbl">📌 Jawaban pemateri ' + vcheck() + '</div><div class="txt">' + esc(q.answer) + '</div></div>' : "") +
        reactBtns(q) + adminBlock(q) + repliesBlock(q) + '</div>';
    }).join("");

    Object.keys(drafts).forEach(function (id) { if (id.indexOf("ans_") === 0 || id.indexOf("ri_") === 0) { var el = $(id); if (el) el.value = drafts[id]; } });
    if (focusId) { var fe = $(focusId); if (fe) { fe.focus(); if (caret != null && fe.setSelectionRange) { try { fe.setSelectionRange(caret, caret); } catch (e) {} } } }
  }

  /* ---------- API global untuk markup onclick ---------- */
  window.QUERY = {
    go: go, seg: seg, logout: function () { clearHost(); setNav(); toast("Keluar"); go("/"); },
    login: doLogin, register: doRegister, join: doJoin,
    createEvent: doCreateEvent, share: doShare, copy: doCopy, delEvent: doDelEvent,
    react: react, toggleReply: toggleReply, sendReply: sendReply, openAnswer: openAnswer, saveAnswer: saveAnswer, unanswer: unanswer, delQ: delQ
  };

  function boot() { window.addEventListener("hashchange", route); route(); }
  window.App = { boot: boot };
})();
