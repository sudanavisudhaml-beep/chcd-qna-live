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
  function getCookie(n) { try { var m = document.cookie.match(new RegExp("(?:^|; )" + n + "=([^;]*)")); return m ? decodeURIComponent(m[1]) : null; } catch (e) { return null; } }
  function setCookie(n, v) { try { document.cookie = n + "=" + encodeURIComponent(v) + ";path=/;max-age=31536000;samesite=lax"; } catch (e) {} }
  function getDeviceId() {
    var id = getCookie("qdev"); if (!id) { try { id = localStorage.getItem("qdev"); } catch (e) {} }
    if (!id) id = (uid() + "").replace(/[^a-z0-9]/gi, "").slice(0, 16);
    setCookie("qdev", id); try { localStorage.setItem("qdev", id); } catch (e) {}
    return id;
  }

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
        if (type === "vote") { doc.options = []; doc.voteCounts = {}; doc.voteRound = uid().slice(0, 10); }
        if (type === "puzzle") { doc.pzCols = 6; doc.pzRows = 4; doc.pzImg1 = "hka1.png"; doc.pzImg2 = "hka2.png"; doc.flips = 0; doc.flipRound = uid().slice(0, 10); }
        return ref.set(doc).then(function () { return code; });
      });
    }
    return attempt(0);
  }
  function saveFieldsDB(code, fields) { return db.collection("events").doc(code).update({ fields: fields }); }
  function saveOptionsDB(code, options) { return db.collection("events").doc(code).update({ options: options }); }
  // Kunci nama/alias jadi key map Firestore yang valid (huruf/angka/underscore)
  function vAliasKey(s) { return String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60); }
  // Rekam vote via TRANSACTION: cek alias di server; kalau sudah ada → tolak (1 nama 1 suara, otoritatif di server, bukan cuma di HP)
  function voteFor(code, oid, dev, round, ak, aname) {
    var ref = db.collection("events").doc(code), ts = Date.now();
    return db.runTransaction(function (tx) {
      return tx.get(ref).then(function (doc) {
        var d = (doc.exists && doc.data()) || {};
        var va = d.voterAlias || {};
        if (ak && va[ak]) { var e = new Error("dup-alias"); e.dupAlias = va[ak]; throw e; }
        var vc = d.voteCounts || {};
        var u = {};
        u["voteCounts." + oid] = (vc[oid] || 0) + 1;  // nilai absolut dari hasil read → idempoten walau transaksi retry (increment bisa dobel saat retry)
        u.lastVote = { oid: oid, ts: ts };
        if (dev) u["voters." + dev] = round;
        if (ak) u["voterAlias." + ak] = { n: aname, o: oid, t: ts };
        tx.update(ref, u);
      });
    });
  }
  // Rekam prediksi bracket (2 duel) via TRANSACTION: 1 nama 1 submit; tiap pilihan +1 (nilai absolut, idempoten)
  function voteForBracket(code, picks, dev, round, ak, aname) {
    var ref = db.collection("events").doc(code), ts = Date.now();
    return db.runTransaction(function (tx) {
      return tx.get(ref).then(function (doc) {
        var d = (doc.exists && doc.data()) || {};
        var va = d.voterAlias || {};
        if (ak && va[ak]) { var e = new Error("dup-alias"); e.dupAlias = va[ak]; throw e; }
        var vc = d.voteCounts || {}, u = {}, seen = {};
        var firstOid = null;
        Object.keys(picks).forEach(function (bid) { var oid = picks[bid]; if (!firstOid) firstOid = oid; if (!seen[oid]) { u["voteCounts." + oid] = (vc[oid] || 0) + 1; seen[oid] = 1; } });
        u.lastVote = { oid: firstOid, ts: ts };
        if (dev) u["voters." + dev] = round;
        if (ak) u["voterAlias." + ak] = { n: aname, p: picks, t: ts };
        tx.update(ref, u);
      });
    });
  }
  function subscribeEvent(code, cb) { return db.collection("events").doc(code).onSnapshot(function (d) { if (d.exists) cb(d.data()); }); }

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
    if ((m = h.match(/^\/r\/([A-Za-z0-9]+)$/))) return renderSession(m[1].toUpperCase(), "results");
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
  // Ring ripple "sonar" dari ikon Q — varian biru untuk halaman berlatar terang
  function qrippleHTML() { return '<span class="qripple qblue"><i></i><i></i><i></i></span>'; }
  function brandHTML() {
    return '<div class="brand"><a href="#/" class="qlogo-wrap">' + qrippleHTML() + '<img src="query-logo.png" alt="QUERY — Suara Insan Astra" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'block\'" />' +
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
        '<div class="seg" id="typeSeg"><button class="active" onclick="QUERY.pickType(\'qna\',this)">💬 Q&amp;A</button><button onclick="QUERY.pickType(\'survey\',this)">📋 Kuesioner</button><button onclick="QUERY.pickType(\'vote\',this)">🗳️ Vote</button><button onclick="QUERY.pickType(\'puzzle\',this)">🧩 Puzzle</button></div>' +
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
        var isSurvey = ev.type === "survey", isVote = ev.type === "vote", isPuzzle = ev.type === "puzzle";
        var typeBadge = isVote
          ? '<span class="badge" style="background:#e7f6ec;color:#0f7a37">🗳️ Vote</span>'
          : isSurvey
          ? '<span class="badge" style="background:#efe7fb;color:#6d34d6">📋 Kuesioner</span>'
          : isPuzzle
          ? '<span class="badge" style="background:#fff3d6;color:#a05a00">🧩 Puzzle HKA</span>'
          : '<span class="badge" style="background:var(--astra-soft);color:var(--astra-dark)">💬 Diskusi Q&amp;A</span>';
        var mainBtns = isVote
          ? '<button class="btn small" onclick="QUERY.go(\'/e/' + ev.code + '\')">📺 Tampilan Live</button>' +
            '<button class="btn ghost small" onclick="QUERY.go(\'/build/' + ev.code + '\')">⚙️ Edit Opsi (' + ((ev.options || []).length) + ')</button>'
          : isSurvey
          ? '<button class="btn small" onclick="QUERY.go(\'/e/' + ev.code + '\')">📊 Lihat Hasil</button>' +
            '<button class="btn ghost small" onclick="QUERY.go(\'/build/' + ev.code + '\')">📝 Edit Pertanyaan (' + ((ev.fields || []).length) + ')</button>'
          : isPuzzle
          ? '<button class="btn small" onclick="QUERY.go(\'/e/' + ev.code + '\')">📺 Tampilan Live</button>' +
            '<button class="btn ghost small" onclick="QUERY.go(\'/build/' + ev.code + '\')">🧩 Atur Puzzle</button>'
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
          shareBoxHTML(ev.code) +
        '</div>';
      }).join("");
    }).catch(function (e) { var el = $("evList"); if (el) el.innerHTML = '<div class="empty">Gagal memuat: ' + esc(e.message) + '</div>'; });
  }
  function sessionURL(code) { return location.origin + location.pathname + "#/e/" + code; }
  function resultsURL(code) { return location.origin + location.pathname + "#/r/" + code; }
  var newType = "qna";
  function pickType(t, btn) {
    newType = t;
    var seg = $("typeSeg"); if (seg) { var bs = seg.getElementsByTagName("button"); for (var i = 0; i < bs.length; i++) bs[i].classList.remove("active"); }
    if (btn) btn.classList.add("active");
    var hint = $("typeHint"); if (hint) hint.textContent = t === "survey" ? "Kuesioner ala MS Forms — Anda susun pertanyaannya, hasil tampil live & bisa diringkas." : (t === "vote" ? "Vote live — audience pilih opsi (mis. negara), bendera membesar seiring vote. Cocok untuk layar/proyektor." : (t === "puzzle" ? "Puzzle Reveal — peserta scan & tulis testimoni, tiap testimoni membuka 1 keping sampai gambar (mis. lokasi acara) terungkap. Cocok untuk layar/proyektor." : "Sesi tanya-jawab live dengan reaksi & balasan."));
  }
  function doCreateEvent() {
    var h = getHost(); if (!h) { go("/"); return; }
    var name = ($("evName").value || "").trim(), materi = ($("evMateri").value || "").trim();
    if (!name) { toast("Isi nama sesi dulu"); return; }
    var t = newType;
    createEvent(h, name, materi, t).then(function (code) {
      toast("Sesi dibuat — kode " + code);
      $("evName").value = ""; $("evMateri").value = "";
      if (t === "survey" || t === "vote" || t === "puzzle") go("/build/" + code); else loadEvents();
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
  function renderSession(code, mode) {
    if (sess && sess.unsub) { try { sess.unsub(); } catch (e) {} }
    view().innerHTML = '<div class="wrap"><div class="empty">Memuat sesi…</div></div>';
    getEvent(code).then(function (ev) {
      if (!ev) { view().innerHTML = '<div class="page"><div class="card center"><h3 class="sec">Event tidak ditemukan</h3><p class="muted" style="margin:8px 0 14px">Kode <b>' + esc(code) + '</b> tidak ada.</p><button class="btn" onclick="QUERY.go(\'/\')">Kembali</button></div></div>'; return; }
      var host = getHost();
      var isOwner = !!(host && host.user === ev.hostUser);
      sess = { code: code, event: ev, isOwner: isOwner, viewResults: (mode === "results"), items: [], sortByTop: true, openReply: {}, openAnswer: {}, host: host,
        reacts: JSON.parse(localStorage.getItem("query_reacts") || "{}"), name: localStorage.getItem("query_name") || (isOwner ? host.name : "") };
      if (ev.type === "survey") { renderSurveySession(); return; }
      if (ev.type === "vote") { renderVoteSession(); return; }
      if (ev.type === "puzzle") { renderPuzzleSession(); return; }
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
        '<div class="logo-card"><span class="qlogo-wrap">' + qrippleHTML() + '<img src="query-logo.png" alt="QUERY" class="query-logo-img" onerror="this.style.display=\'none\'" /></span></div>' +
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
    { v: "matrix", label: "Matriks (baris × kolom, rating 1–5)" },
    { v: "short", label: "Teks singkat" },
    { v: "long", label: "Teks panjang" }
  ];
  function ftypeLabel(v) { for (var i = 0; i < FTYPES.length; i++) if (FTYPES[i].v === v) return FTYPES[i].label; return v; }
  function needsOptions(t) { return t === "single" || t === "multi"; }
  function isEmptyVal(v) { if (v == null || v === "") return true; if (Array.isArray(v)) return !v.length; if (typeof v === "object") return !Object.keys(v).length; return false; }
  function heroHTML(ev, pill) {
    return '<div class="hero">' +
      '<span class="live-pill"><span class="dot"></span> ' + esc(pill || "Kuesioner") + '</span>' +
      '<div class="logo-card"><span class="qlogo-wrap">' + qrippleHTML() + '<img src="query-logo.png" alt="QUERY" class="query-logo-img" onerror="this.style.display=\'none\'" /></span></div>' +
      '<p class="tagline">' + esc(CFG.APP_TAGLINE || "Malu Bertanya, Sesat di Jalan") + '</p>' +
      '<span class="event">' + esc(ev.eventName) + '</span>' +
      (ev.materi ? '<span class="materi">' + esc(ev.materi) + '</span>' : '') + '</div>';
  }
  // QR dibuat lokal di browser (qrcode-generator, MIT, file qrcode.js di situs sendiri): tak bergantung layanan luar.
  // Layanan luar hanya cadangan bila qrcode.js gagal dimuat (mis. cache lama).
  function qrSrc(text) {
    try { var q = qrcode(0, "M"); q.addData(text); q.make(); return q.createDataURL(8); }
    catch (e) { return "https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=10&data=" + encodeURIComponent(text); }
  }
  function shareBoxHTML(code) {
    var link = sessionURL(code);
    return '<div class="share-box" id="share_' + code + '">' +
      '<button class="share-x" title="Tutup (Esc)" onclick="QUERY.share(\'' + code + '\')">✕</button>' +
      '<img alt="QR" src="' + qrSrc(link) + '" />' +
      '<div class="lnk">' + esc(link) + '</div>' +
      '<button class="btn small" style="margin-top:10px" onclick="QUERY.copy(\'' + esc(link) + '\')">📋 Salin Link</button>' +
    '</div>';
  }

  /* ----- Builder ----- */
  var builder = null;
  function renderBuilder(code) {
    var host = getHost();
    view().innerHTML = '<div class="page"><div class="empty">Memuat…</div></div>';
    getEvent(code).then(function (ev) {
      if (!ev) { view().innerHTML = '<div class="page"><div class="card center">Sesi tidak ditemukan.</div></div>'; return; }
      if (!host || host.user !== ev.hostUser) { view().innerHTML = '<div class="page"><div class="card center"><h3 class="sec">Khusus host</h3><p class="muted" style="margin:8px 0 14px">Hanya host pemilik yang bisa mengubah sesi ini.</p><button class="btn" onclick="QUERY.go(\'/\')">Masuk sebagai host</button></div></div>'; return; }
      if (ev.type === "vote") { renderVoteBuilder(ev); return; }
      if (ev.type === "puzzle") { renderPuzzleBuilder(ev); return; }
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
          '<label class="fld">Keterangan / petunjuk (opsional)</label><input type="text" id="nfDesc" maxlength="200" placeholder="mis. skala, cara mengisi..." />' +
          '<div id="nfOptWrap"><label class="fld">Pilihan jawaban (satu per baris)</label><textarea id="nfOpts" placeholder="Opsi A&#10;Opsi B&#10;Opsi C"></textarea></div>' +
          '<div id="nfMtxWrap" style="display:none">' +
            '<label class="fld">Baris / Pernyataan (satu per baris)</label><textarea id="nfRows" placeholder="Pernyataan 1&#10;Pernyataan 2"></textarea>' +
            '<label class="fld">Kolom (mis. daftar vendor, satu per baris)</label><textarea id="nfCols" placeholder="Vendor A&#10;Vendor B"></textarea>' +
          '</div>' +
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
      var opts = (f.type === "matrix")
        ? '<div class="muted" style="font-size:.82rem;margin-top:5px">' + (f.rows || []).length + ' baris × ' + (f.cols || []).length + ' kolom</div>'
        : ((f.options && f.options.length) ? '<div class="muted" style="font-size:.82rem;margin-top:5px">Opsi: ' + f.options.map(esc).join(" · ") + '</div>' : '');
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
  function nfTypeUI() { var t = $("nfType"); if (!t) return; var v = t.value; var w = $("nfOptWrap"); if (w) w.style.display = needsOptions(v) ? "block" : "none"; var m = $("nfMtxWrap"); if (m) m.style.display = (v === "matrix") ? "block" : "none"; }
  function persistBuilder(cb) { saveFieldsDB(builder.code, builder.fields).then(function () { if (cb) cb(); }).catch(function () { toast("Gagal menyimpan"); }); }
  function addField() {
    var type = $("nfType").value, label = ($("nfLabel").value || "").trim();
    if (!label) { toast("Isi pertanyaannya dulu"); return; }
    var field = { fid: uid().slice(0, 8), type: type, label: label, desc: ($("nfDesc").value || "").trim(), options: [], required: $("nfReq").checked };
    if (needsOptions(type)) { field.options = ($("nfOpts").value || "").split("\n").map(function (s) { return s.trim(); }).filter(Boolean); if (field.options.length < 2) { toast("Beri minimal 2 pilihan jawaban"); return; } }
    if (type === "matrix") {
      field.rows = ($("nfRows").value || "").split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
      field.cols = ($("nfCols").value || "").split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
      if (field.rows.length < 1 || field.cols.length < 1) { toast("Matriks perlu minimal 1 baris & 1 kolom"); return; }
    }
    builder.fields.push(field);
    persistBuilder(function () { $("nfLabel").value = ""; $("nfDesc").value = ""; $("nfOpts").value = ""; if ($("nfRows")) $("nfRows").value = ""; if ($("nfCols")) $("nfCols").value = ""; $("nfReq").checked = false; renderBuilderList(); toast("Pertanyaan ditambah ✓"); });
  }
  function delField(fid) { if (!confirm("Hapus pertanyaan ini?")) return; builder.fields = builder.fields.filter(function (f) { return f.fid !== fid; }); persistBuilder(renderBuilderList); }
  function moveField(fid, dir) {
    var i = -1; for (var k = 0; k < builder.fields.length; k++) if (builder.fields[k].fid === fid) i = k;
    if (i < 0) return; var j = i + dir; if (j < 0 || j >= builder.fields.length) return;
    var t = builder.fields[i]; builder.fields[i] = builder.fields[j]; builder.fields[j] = t; persistBuilder(renderBuilderList);
  }

  /* ----- Sesi survei: form (audience) / hasil (host) ----- */
  function renderSurveySession() {
    // Hasil tampil untuk pemilik ATAU siapa pun yang membuka link hasil (#/r/CODE) — read-only.
    if (sess.isOwner || sess.viewResults) renderSurveyResults(!sess.isOwner);
    else renderSurveyForm();
  }

  function renderSurveyForm() {
    var ev = sess.event, fields = ev.fields || [];
    if (localStorage.getItem("query_sub_" + sess.code)) { showThanks(); return; }
    if (!fields.length) { view().innerHTML = '<div class="wrap">' + heroHTML(ev, "Kuesioner") + '<div class="card center">Kuesioner ini belum memiliki pertanyaan.</div></div>'; return; }
    var body = fields.map(function (f, i) { return '<div class="qfield"><div class="qflabel">' + (i + 1) + '. ' + esc(f.label) + (f.required ? ' <span style="color:#e0245e">*</span>' : '') + '</div>' + (f.desc ? '<div class="qfdesc">' + esc(f.desc) + '</div>' : '') + fieldInput(f) + '</div>'; }).join("");
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
    if (f.type === "matrix") {
      var rows = f.rows || [], cols = f.cols || [], other = f.otherOptions || [], slots = f.otherSlots || 0;
      var grp = '<tr><th class="mtx-corner" rowspan="2">Pernyataan</th>';
      if (cols.length) grp += '<th colspan="' + cols.length + '" class="grpA">' + esc(f.groupA || "Listed Travel Agent") + '</th>';
      if (slots) grp += '<th colspan="' + slots + '" class="grpB">' + esc(f.groupB || "Vendor Lainnya") + '</th>';
      grp += '</tr>';
      var ch = '<tr>';
      cols.forEach(function (c) { ch += '<th>' + esc(c) + '</th>'; });
      for (var sl = 0; sl < slots; sl++) { ch += '<th><select id="mo_' + f.fid + '_' + sl + '" class="mo-sel"><option value="">Pilih vendor…</option>' + other.map(function (o) { return '<option>' + esc(o) + '</option>'; }).join("") + '</select></th>'; }
      ch += '</tr>';
      var body = rows.map(function (rw, ri) {
        var tds = cols.map(function (c, ci) { return '<td><select id="m_' + f.fid + '_' + ri + '_' + ci + '">' + ratingOpts() + '</select></td>'; }).join("");
        for (var s2 = 0; s2 < slots; s2++) tds += '<td><select id="mr_' + f.fid + '_' + ri + '_' + s2 + '">' + ratingOpts() + '</select></td>';
        return '<tr><td class="mtx-rowh">' + esc(rw) + '</td>' + tds + '</tr>';
      }).join("");
      var hint = '↔ Geser untuk lihat semua kolom · isi 1–5, kosongkan vendor yang tidak dipakai' + (slots ? ' · untuk vendor non-listed, pilih dari "Vendor Lainnya"' : '');
      return '<div class="mtx-hint">' + hint + '</div><div class="mtx-wrap"><table class="mtx"><thead>' + grp + ch + '</thead><tbody>' + body + '</tbody></table></div>';
    }
    return "";
  }
  function ratingOpts() { return '<option value="">–</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option>'; }
  function pickRate(fid, v) { var row = $("fi_" + fid); if (!row) return; row.setAttribute("data-val", v); var bs = row.getElementsByTagName("button"); for (var i = 0; i < bs.length; i++) bs[i].classList.toggle("on", parseInt(bs[i].getAttribute("data-v"), 10) <= v); }
  function getFieldValue(f) {
    // Matrix TIDAK punya elemen fi_<fid> (sel-selnya ber-id m_/mo_/mr_), jadi harus
    // ditangani SEBELUM guard fi_ — kalau tidak, nilainya selalu terbaca kosong (bug "Lengkapi Bagian A").
    if (f.type === "matrix") {
      var rows = f.rows || [], cols = f.cols || [], slots = f.otherSlots || 0, L = {}, O = [];
      for (var ri = 0; ri < rows.length; ri++) for (var ci = 0; ci < cols.length; ci++) { var s = $("m_" + f.fid + "_" + ri + "_" + ci); if (s && s.value) { if (!L[ri]) L[ri] = {}; L[ri][ci] = parseInt(s.value, 10); } }
      for (var sl = 0; sl < slots; sl++) {
        var vs = $("mo_" + f.fid + "_" + sl); if (!vs || !vs.value) continue;
        var r = {}, any = false;
        for (var rj = 0; rj < rows.length; rj++) { var rs = $("mr_" + f.fid + "_" + rj + "_" + sl); if (rs && rs.value) { r[rj] = parseInt(rs.value, 10); any = true; } }
        if (any) O.push({ v: vs.value, r: r });
      }
      return { L: L, O: O };
    }
    var el = $("fi_" + f.fid); if (!el) return "";
    if (f.type === "short" || f.type === "long") return (el.value || "").trim();
    if (f.type === "rating") { var v = el.getAttribute("data-val"); return v ? parseInt(v, 10) : ""; }
    if (f.type === "single") { var r2 = el.querySelector("input:checked"); return r2 ? r2.value : ""; }
    if (f.type === "multi") { return [].slice.call(el.querySelectorAll("input:checked")).map(function (c) { return c.value; }); }
    return "";
  }
  function matrixEmpty(val) { return !val || (Object.keys(val.L || {}).length === 0 && (val.O || []).length === 0); }
  function respErr(show) { var n = $("respName"), e = $("nameErr"); if (!n) return; if (show) { n.style.setProperty("border-color", "#e0245e", "important"); n.style.setProperty("box-shadow", "0 0 0 4px rgba(224,36,94,.16)", "important"); if (e) e.style.display = "block"; n.focus(); } else { n.style.removeProperty("border-color"); n.style.removeProperty("box-shadow"); if (e) e.style.display = "none"; } }
  function submitSurvey() {
    var ev = sess.event, fields = ev.fields || [], name = ($("respName").value || "").trim();
    if (!name) { respErr(true); toast("Isi nama Anda dulu"); return; }
    var answers = {};
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i], val = getFieldValue(f);
      var empty = f.type === "matrix" ? matrixEmpty(val) : isEmptyVal(val);
      if (f.required && empty) { toast("Lengkapi: " + f.label); var el = $("fi_" + f.fid) || $("m_" + f.fid + "_0_0"); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
      answers[f.fid] = val;
    }
    $("subBtn").disabled = true;
    addResponse(sess.code, name, answers).then(function () { localStorage.setItem("query_name", name); localStorage.setItem("query_sub_" + sess.code, "1"); showThanks(); })
      .catch(function () { toast("Gagal mengirim"); $("subBtn").disabled = false; });
  }
  function showThanks() {
    view().innerHTML = '<div class="wrap">' + heroHTML(sess.event, "Kuesioner") +
      '<div class="card center"><div style="font-size:2.6rem">🙏</div><h3 class="sec" style="margin-top:8px">Terima kasih!</h3>' +
      '<p class="muted" style="margin:8px 0 14px">Jawaban Anda sudah tercatat.</p>' +
      '<button class="btn" onclick="QUERY.fillAgain()">➕ Isi lagi (mis. untuk vendor lain)</button></div></div>';
  }
  function fillAgain() { localStorage.removeItem("query_sub_" + sess.code); sess.name = localStorage.getItem("query_name") || ""; renderSurveyForm(); }

  function resultsShareBoxHTML(code) {
    var link = resultsURL(code);
    return '<div class="share-box rshare" id="rshare_' + code + '">' +
      '<button class="share-x" title="Tutup" onclick="QUERY.shareResults(\'' + code + '\')">✕</button>' +
      '<div class="rshare-note">👁️ Link ini membuka <b>halaman Hasil (read-only)</b> — atasan bisa lihat tanpa login &amp; tanpa masuk form. Siapa pun yang memegang link bisa melihat, jadi bagikan seperlunya.</div>' +
      '<img alt="QR Hasil" src="' + qrSrc(link) + '" />' +
      '<div class="lnk">' + esc(link) + '</div>' +
      '<button class="btn small block" style="margin-top:10px" onclick="QUERY.copy(\'' + link + '\')">📋 Salin Link Hasil</button>' +
    '</div>';
  }
  function shareResults(code) { var b = $("rshare_" + code); if (b) b.classList.toggle("open"); }
  function renderSurveyResults(readonly) {
    var ev = sess.event, banner, actions, extra = "";
    if (readonly) {
      banner = '<div class="banner" style="background:var(--astra-soft);border-color:#bcd6f5;color:var(--astra-dark)">👁️ <b>Tampilan Hasil</b> — ringkasan kuesioner real-time (khusus lihat).</div>';
      actions = '<button class="btn secondary small" onclick="QUERY.exportSurvey()">⬇ Unduh Excel (Rapi)</button>';
    } else {
      banner = '<div class="banner" style="background:var(--ok-soft);border-color:#b7e4c7;color:#0f7a37">✅ <b>Hasil (khusus host)</b> — real-time. <span class="nlink" style="margin-left:6px" onclick="QUERY.go(\'/dashboard\')">← Dashboard</span></div>';
      actions = '<button class="btn ghost small" onclick="QUERY.go(\'/build/' + sess.code + '\')">📝 Edit Pertanyaan</button>' +
        '<button class="btn small" onclick="QUERY.shareResults(\'' + sess.code + '\')">🔗 Bagikan Hasil ke Atasan</button>' +
        '<button class="btn ghost small" onclick="QUERY.share(\'' + sess.code + '\')">QR isi kuesioner</button>' +
        '<button class="btn secondary small" onclick="QUERY.exportSurvey()">⬇ Unduh Excel (Rapi)</button>';
      extra = resultsShareBoxHTML(sess.code);
    }
    view().innerHTML = '<div class="wrap">' + heroHTML(ev, "Hasil Kuesioner") +
      banner +
      '<div class="ev-actions" style="margin-bottom:14px">' + actions + '</div>' + extra +
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
  function mcell(a, ri, ci) { if (!a) return undefined; var ro = a[ri]; if (!ro) return undefined; var v = ro[ci]; return (typeof v === "number") ? v : undefined; }
  function mL(a) { return a ? (a.L || a) : null; } // dukung bentuk lama {ri:{ci}} & baru {L,O}
  function aggregateMatrix(f, resp) {
    var rows = f.rows || [], cols = f.cols || [];
    var colStat = cols.map(function () { return { sum: 0, n: 0, resp: 0 }; });
    var cell = rows.map(function () { return cols.map(function () { return { sum: 0, n: 0 }; }); });
    var otherMap = {};
    resp.forEach(function (r) {
      var a = r.answers ? r.answers[f.fid] : null; if (!a) return;
      var L = mL(a), colHas = cols.map(function () { return false; });
      for (var ri = 0; ri < rows.length; ri++) for (var ci = 0; ci < cols.length; ci++) {
        var v = mcell(L, ri, ci); if (v >= 1 && v <= 5) { colStat[ci].sum += v; colStat[ci].n++; cell[ri][ci].sum += v; cell[ri][ci].n++; colHas[ci] = true; }
      }
      colHas.forEach(function (h, ci) { if (h) colStat[ci].resp++; });
      (a.O || []).forEach(function (ov) {
        if (!ov || !ov.v) return; var nm = ov.v; if (!otherMap[nm]) otherMap[nm] = { sum: 0, n: 0, resp: 0 };
        var rr = ov.r || {}, any = false;
        Object.keys(rr).forEach(function (k) { var vv = rr[k]; if (typeof vv === "number" && vv >= 1 && vv <= 5) { otherMap[nm].sum += vv; otherMap[nm].n++; any = true; } });
        if (any) otherMap[nm].resp++;
      });
    });
    var colAgg = cols.map(function (name, ci) { var s = colStat[ci]; return { name: name, ci: ci, avg: s.n ? s.sum / s.n : 0, n: s.n, resp: s.resp, listed: true }; });
    var otherAgg = Object.keys(otherMap).map(function (name) { var s = otherMap[name]; return { name: name, avg: s.n ? s.sum / s.n : 0, n: s.n, resp: s.resp, listed: false }; });
    var ranked = colAgg.concat(otherAgg).slice().sort(function (a, b) { return b.avg - a.avg; });
    return { rows: rows, cols: cols, colAgg: colAgg, otherAgg: otherAgg, ranked: ranked, cell: cell };
  }
  function respVendorAvg(a, ci, rowCount) { var L = mL(a); if (!L) return ""; var sum = 0, n = 0; for (var ri = 0; ri < rowCount; ri++) { var v = mcell(L, ri, ci); if (typeof v === "number") { sum += v; n++; } } return n ? (sum / n) : ""; }
  function respOthersText(a) { if (!a || !a.O || !a.O.length) return ""; return a.O.map(function (o) { var rr = o.r || {}, sum = 0, n = 0; Object.keys(rr).forEach(function (k) { if (typeof rr[k] === "number") { sum += rr[k]; n++; } }); return o.v + (n ? " (" + (sum / n).toFixed(2) + ")" : ""); }).join("; "); }
  function matrixRespCell(a, f) {
    if (!a) return "—"; var rows = f.rows || [], cols = f.cols || [], L = mL(a), sum = 0, n = 0, vend = {};
    for (var ri = 0; ri < rows.length; ri++) for (var ci = 0; ci < cols.length; ci++) { var v = mcell(L, ri, ci); if (typeof v === "number") { sum += v; n++; vend[ci] = 1; } }
    var ov = 0; (a.O || []).forEach(function (o) { if (!o || !o.v) return; var rr = o.r || {}, got = false; Object.keys(rr).forEach(function (k) { if (typeof rr[k] === "number") { sum += rr[k]; n++; got = true; } }); if (got) ov++; });
    var tot = Object.keys(vend).length + ov;
    return n ? (tot + " vendor · Ø " + (sum / n).toFixed(1)) : "—";
  }
  function summaryHTML(fields, resp) {
    if (!fields.length) return "";
    var lines = fields.map(function (f) {
      if (f.type === "matrix") {
        var am = aggregateMatrix(f, resp), rated = am.ranked.filter(function (v) { return v.n > 0; });
        if (!rated.length) return '<li><b>' + esc(f.label) + ':</b> belum ada penilaian</li>';
        var top = rated[0], low = rated[rated.length - 1];
        return '<li><b>' + esc(f.label) + ':</b> terbaik “<b>' + esc(top.name) + '</b>” (' + top.avg.toFixed(2) + '/5)' + (rated.length > 1 ? ', terendah “' + esc(low.name) + '” (' + low.avg.toFixed(2) + '/5)' : '') + '</li>';
      }
      var a = aggregate(f, resp);
      if (f.type === "rating") return '<li><b>' + esc(f.label) + ':</b> rata-rata <b>' + a.avg.toFixed(2) + '/5</b> (' + a.count + ' respons)</li>';
      if (f.type === "single" || f.type === "multi") { if (!a.top) return '<li><b>' + esc(f.label) + ':</b> belum ada jawaban</li>'; return '<li><b>' + esc(f.label) + ':</b> terbanyak “<b>' + esc(a.top.opt) + '</b>” (' + a.top.pct + '%)</li>'; }
      return '<li><b>' + esc(f.label) + ':</b> ' + a.count + ' jawaban teks</li>';
    }).join("");
    return '<div class="card summary"><h3 class="sec">🧭 Ringkasan — Top Management View</h3><ul class="sumlist">' + lines + '</ul></div>';
  }
  function matrixCardBody(f, resp) {
    var a = aggregateMatrix(f, resp);
    var rated = a.ranked.filter(function (v) { return v.n > 0; });
    var bars = (rated.length ? rated : a.ranked).map(function (v) {
      var pct = Math.round(v.avg / 5 * 100);
      var tag = v.listed ? "" : ' <span class="vtag">lainnya</span>';
      return '<div class="barrow"><span class="blabel">' + esc(v.name) + tag + '</span><div class="bar"><div class="fill" style="width:' + pct + '%"></div></div><span class="bval">' + (v.n ? v.avg.toFixed(2) : "–") + ' · ' + v.resp + ' resp</span></div>';
    }).join("");
    var thead = '<tr><th>Pernyataan</th>' + a.cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join("") + '</tr>';
    var trs = a.rows.map(function (rw, ri) {
      return '<tr><td class="mtx-rowh">' + esc(rw) + '</td>' + a.cols.map(function (c, ci) { var cc = a.cell[ri][ci]; return '<td class="mtx-avg">' + (cc.n ? (cc.sum / cc.n).toFixed(2) : "—") + '</td>'; }).join("") + '</tr>';
    }).join("");
    var others = a.otherAgg.length ? ('<div class="rf-sub" style="margin-top:14px">Vendor Lainnya yang dinilai</div>' + a.otherAgg.sort(function (x, y) { return y.avg - x.avg; }).map(function (v) { return '<div class="oitem"><b>' + esc(v.name) + '</b> · ' + (v.n ? v.avg.toFixed(2) : "–") + '/5 · ' + v.resp + ' resp</div>'; }).join("")) : "";
    return '<div class="rf-sub">🏆 Peringkat vendor (rata-rata 1–5, listed + lainnya)</div>' + bars +
      '<div class="rf-sub" style="margin-top:14px">Rata-rata per pernyataan × vendor listed</div>' +
      '<div class="mtx-wrap"><table class="mtx mtxres"><thead>' + thead + '</thead><tbody>' + trs + '</tbody></table></div>' + others;
  }
  function fieldResultCard(f, resp) {
    var head = '<div class="rf-q">' + esc(f.label) + '</div><div class="badge" style="background:var(--astra-soft);color:var(--astra-dark);margin-bottom:10px">' + esc(ftypeLabel(f.type)) + '</div>';
    if (f.type === "matrix") return '<div class="card rf">' + head + matrixCardBody(f, resp) + '</div>';
    var a = aggregate(f, resp), body = "";
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
      var cells = fields.map(function (f) { var v = r.answers ? r.answers[f.fid] : ""; return '<td>' + (f.type === "matrix" ? esc(matrixRespCell(v, f)) : esc(cellVal(v))) + '</td>'; }).join("");
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
  /* ---------- Export XLSX rapi — tanpa library (stored-zip + CRC32, string inline) ---------- */
  var XLSX_CRC = (function () { var t = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
  function xcrc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = XLSX_CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function xutf8(s) { return new TextEncoder().encode(s); }
  function xzipStore(files) {
    function u16(n) { return [n & 255, (n >> 8) & 255]; }
    function u32(n) { return [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255]; }
    var parts = [], central = [], offset = 0;
    files.forEach(function (f) {
      var nb = xutf8(f.name), data = f.data, crc = xcrc32(data);
      var loc = [80, 75, 3, 4].concat(u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(nb.length), u16(0));
      parts.push(new Uint8Array(loc), nb, data);
      central.push(new Uint8Array([80, 75, 1, 2].concat(u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(nb.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset))), nb);
      offset += loc.length + nb.length + data.length;
    });
    var cSize = 0; central.forEach(function (c) { cSize += c.length; });
    var end = new Uint8Array([80, 75, 5, 6].concat(u16(0), u16(0), u16(files.length), u16(files.length), u32(cSize), u32(offset), u16(0)));
    var all = parts.concat(central); all.push(end);
    var total = 0; all.forEach(function (a) { total += a.length; });
    var out = new Uint8Array(total), p = 0; all.forEach(function (a) { out.set(a, p); p += a.length; });
    return out;
  }
  function xesc(s) { if (s == null) return ""; return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function xcol(n) { var s = ""; n++; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - m) / 26); } return s; }
  function XT(v, s) { return { k: "s", v: v, s: s || 0 }; }
  function XN(v, s) { return { k: "n", v: v, s: s || 0 }; }
  function xcell(ref, c) {
    if (c.k === "n") { return (c.v == null || c.v === "") ? '<c r="' + ref + '" s="' + c.s + '"/>' : '<c r="' + ref + '" s="' + c.s + '"><v>' + c.v + '</v></c>'; }
    return '<c r="' + ref + '" s="' + c.s + '" t="inlineStr"><is><t xml:space="preserve">' + xesc(c.v) + '</t></is></c>';
  }
  function xsheet(rows, opt) {
    opt = opt || {};
    var sd = "";
    for (var r = 0; r < rows.length; r++) { var rr = r + 1, cells = rows[r], s = '<row r="' + rr + '">'; for (var c = 0; c < cells.length; c++) s += xcell(xcol(c) + rr, cells[c]); sd += s + "</row>"; }
    var cols = opt.cols ? '<cols>' + opt.cols.map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join("") + '</cols>' : "";
    var views = '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
    if (opt.freeze) { var fx = opt.freeze.x || 0, fy = opt.freeze.y || 0, ap = (fx && fy) ? "bottomRight" : (fx ? "topRight" : "bottomLeft"); views = '<sheetViews><sheetView workbookViewId="0"><pane ' + (fx ? 'xSplit="' + fx + '" ' : '') + (fy ? 'ySplit="' + fy + '" ' : '') + 'topLeftCell="' + xcol(fx) + (fy + 1) + '" activePane="' + ap + '" state="frozen"/></sheetView></sheetViews>'; }
    var merges = (opt.merges && opt.merges.length) ? '<mergeCells count="' + opt.merges.length + '">' + opt.merges.map(function (m) { return '<mergeCell ref="' + m + '"/>'; }).join("") + '</mergeCells>' : "";
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + views + '<sheetFormatPr defaultRowHeight="15"/>' + cols + '<sheetData>' + sd + '</sheetData>' + merges + '</worksheet>';
  }
  var XLSX_STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.00"/></numFmts><fonts count="6"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="15"/><color rgb="FF00417C"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF65728A"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF00417C"/><name val="Calibri"/></font></fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF005BAA"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFE9A8"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3F8FD"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFC7D0DE"/></left><right style="thin"><color rgb="FFC7D0DE"/></right><top style="thin"><color rgb="FFC7D0DE"/></top><bottom style="thin"><color rgb="FFC7D0DE"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="11"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="164" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="5" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf></cellXfs></styleSheet>';
  function xlsxBlob(defs) {
    var files = [], ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
    var sheetTags = "", relTags = "";
    defs.forEach(function (d, i) { var n = i + 1;
      ct += '<Override PartName="/xl/worksheets/sheet' + n + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
      sheetTags += '<sheet name="' + xesc(d.name) + '" sheetId="' + n + '" r:id="rId' + n + '"/>';
      relTags += '<Relationship Id="rId' + n + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + n + '.xml"/>';
      files.push({ name: "xl/worksheets/sheet" + n + ".xml", data: xutf8(xsheet(d.rows, d.opt)) });
    });
    ct += '</Types>';
    relTags += '<Relationship Id="rId' + (defs.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';
    var wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheetTags + '</sheets></workbook>';
    var wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + relTags + '</Relationships>';
    var rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
    files.unshift({ name: "xl/styles.xml", data: xutf8(XLSX_STYLES) });
    files.unshift({ name: "xl/_rels/workbook.xml.rels", data: xutf8(wbRels) });
    files.unshift({ name: "xl/workbook.xml", data: xutf8(wb) });
    files.unshift({ name: "_rels/.rels", data: xutf8(rootRels) });
    files.unshift({ name: "[Content_Types].xml", data: xutf8(ct) });
    return new Blob([xzipStore(files)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  var DIMNAME = { Q: "Quality", C: "Cost", D: "Delivery", S: "Safety", M: "Morale" };
  function cleanLabel(l) { return String(l || "").replace(/^BAGIAN\s+[A-Z]\s*[—-]\s*/i, "").trim(); }
  function r2(x) { return (x == null) ? null : Math.round(x * 100) / 100; }
  function avgOf(a) { return (a && a.length) ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
  function exportSurvey() {
    var ev = sess.event, fields = ev.fields || [], resp = (sess.responses || []).slice().sort(function (a, b) { return tsOf(a) - tsOf(b); });
    var mf = null; for (var i = 0; i < fields.length; i++) { if (fields[i].type === "matrix") { mf = fields[i]; break; } }
    var sheets = [];

    // ---- SHEET 1: Rekap & Peringkat (bila ada matrix) ----
    if (mf) {
      var mcols = mf.cols || [], mrows = mf.rows || [];
      var rowDim = mrows.map(function (rw) { var m = /^\s*\[([A-Za-z])\]/.exec(rw); return m ? m[1].toUpperCase() : null; });
      var dimsPresent = []; rowDim.forEach(function (d) { if (d && dimsPresent.indexOf(d) < 0) dimsPresent.push(d); });
      var vend = {}, order = [];
      function ven(n, listed) { if (!vend[n]) { vend[n] = { sc: [], byDim: {}, raters: 0, listed: listed }; order.push(n); } return vend[n]; }
      mcols.forEach(function (c) { ven(c, true); });
      resp.forEach(function (rp) {
        var a = rp.answers ? rp.answers[mf.fid] : null; if (!a) return; var L = mL(a);
        mcols.forEach(function (c, ci) { var got = false; for (var ri = 0; ri < mrows.length; ri++) { var v = mcell(L, ri, ci); if (typeof v === "number") { vend[c].sc.push(v); got = true; var d = rowDim[ri]; if (d) (vend[c].byDim[d] = vend[c].byDim[d] || []).push(v); } } if (got) vend[c].raters++; });
        (a.O || []).forEach(function (o) { var vn = ven(o.v, false), rr = o.r || {}, got = false; Object.keys(rr).forEach(function (k) { var v = rr[k]; if (typeof v === "number") { vn.sc.push(v); got = true; var d = rowDim[parseInt(k, 10)]; if (d) (vn.byDim[d] = vn.byDim[d] || []).push(v); } }); if (got) vn.raters++; });
      });
      var rank = order.map(function (n) { var g = vend[n], o = { name: n, listed: g.listed, total: r2(avgOf(g.sc)), raters: g.raters, dim: {} }; dimsPresent.forEach(function (d) { o.dim[d] = r2(avgOf(g.byDim[d])); }); return o; }).filter(function (o) { return o.total != null; });
      rank.sort(function (x, y) { return (y.total || 0) - (x.total || 0); });
      var totalCols = 2 + dimsPresent.length + 2, lastL = xcol(totalCols - 1);
      var rows = [];
      rows.push([XT("REKAP — " + (ev.eventName || "Kuesioner"), 1)]);
      rows.push([XT("Skala 1-5 (makin tinggi makin baik) · " + resp.length + " responden", 8)]);
      rows.push([]);
      var hdr = [XT("Peringkat", 2), XT("Vendor", 2)]; dimsPresent.forEach(function (d) { hdr.push(XT(DIMNAME[d] || d, 2)); }); hdr.push(XT("TOTAL Rata-rata", 2), XT("Jml Penilai", 2));
      rows.push(hdr);
      rank.forEach(function (o, idx) { var top = idx === 0, st = top ? 6 : 5, sn = top ? 7 : 4, stv = top ? 6 : 3; var row = [XT(String(idx + 1), st), XT(o.listed ? o.name : o.name + " (lainnya)", stv)]; dimsPresent.forEach(function (d) { row.push(XN(o.dim[d], sn)); }); row.push(XN(o.total, sn), XN(o.raters, st)); rows.push(row); });
      rows.push([]);
      rows.push([XT('Catatan: "Jml Penilai" = jumlah responden yang menilai vendor tsb. Vendor dgn penilai sedikit kurang mewakili.', 8)]);
      var colW = [10, 24]; dimsPresent.forEach(function () { colW.push(10); }); colW.push(15, 11);
      sheets.push({ name: "Rekap & Peringkat", rows: rows, opt: { cols: colW, freeze: { y: 4 }, merges: ["A1:" + lastL + "1", "A2:" + lastL + "2"] } });
    }

    // ---- SHEET 2: Detail per Responden ----
    var shortFs = fields.filter(function (f) { return f.type !== "matrix" && f.type !== "long"; });
    var longFs = fields.filter(function (f) { return f.type === "long"; });
    var others = [];
    if (mf) resp.forEach(function (rp) { var a = rp.answers ? rp.answers[mf.fid] : null; if (a && a.O) a.O.forEach(function (o) { if (others.indexOf(o.v) < 0) others.push(o.v); }); });
    var d = [];
    d.push([XT("DETAIL PER RESPONDEN" + (mf ? " (skor rata-rata per vendor)" : ""), 1)]);
    d.push([]);
    var dh = [XT("No", 2), XT("Nama", 2), XT("Waktu", 2)];
    shortFs.forEach(function (f) { dh.push(XT(cleanLabel(f.label), 2)); });
    if (mf) { (mf.cols || []).forEach(function (c) { dh.push(XT(c, 2)); }); others.forEach(function (n) { dh.push(XT(n + " (lainnya)", 2)); }); }
    d.push(dh);
    resp.forEach(function (rp, idx) {
      var row = [XN(idx + 1, 5), XT(rp.name || "Anonim", 3), XT(tsOf(rp) ? new Date(tsOf(rp)).toLocaleString("id-ID") : "", 5)];
      shortFs.forEach(function (f) { var v = rp.answers ? rp.answers[f.fid] : ""; if (f.type === "rating") row.push(XN(typeof v === "number" ? v : null, 4)); else row.push(XT(Array.isArray(v) ? v.join(" | ") : (v == null ? "" : String(v)), 3)); });
      if (mf) { var a = rp.answers ? rp.answers[mf.fid] : null, rc = (mf.rows || []).length;
        (mf.cols || []).forEach(function (c, ci) { var av = respVendorAvg(a, ci, rc); row.push(XN(av === "" ? null : r2(av), 4)); });
        others.forEach(function (n) { var found = null; if (a && a.O) a.O.forEach(function (o) { if (o.v === n) { var rr = o.r || {}, s = 0, cnt = 0; Object.keys(rr).forEach(function (k) { if (typeof rr[k] === "number") { s += rr[k]; cnt++; } }); found = cnt ? r2(s / cnt) : null; } }); row.push(XN(found, 4)); });
      }
      d.push(row);
    });
    var dCols = [5, 22, 18]; shortFs.forEach(function () { dCols.push(16); }); if (mf) { (mf.cols || []).forEach(function () { dCols.push(13); }); others.forEach(function () { dCols.push(15); }); }
    sheets.push({ name: "Detail per Responden", rows: d, opt: { cols: dCols, freeze: { x: 2, y: 3 }, merges: ["A1:" + xcol(dh.length - 1) + "1"] } });

    // ---- SHEET 3: Masukan Kualitatif (jawaban teks panjang) ----
    if (longFs.length) {
      var t = []; t.push([XT("MASUKAN / JAWABAN TEKS", 1)]); t.push([]);
      var th = [XT("No", 2), XT("Nama", 2)]; longFs.forEach(function (f) { th.push(XT(cleanLabel(f.label), 2)); }); t.push(th);
      resp.forEach(function (rp, idx) { var row = [XN(idx + 1, 5), XT(rp.name || "Anonim", 3)]; longFs.forEach(function (f) { var v = rp.answers ? rp.answers[f.fid] : ""; row.push(XT(v == null ? "" : String(v), 3)); }); t.push(row); });
      var tCols = [5, 20]; longFs.forEach(function () { tCols.push(44); });
      sheets.push({ name: "Masukan Kualitatif", rows: t, opt: { cols: tCols, freeze: { y: 3 }, merges: ["A1:" + xcol(th.length - 1) + "1"] } });
    }

    if (!sheets.length) { toast("Belum ada data untuk diekspor"); return; }
    try {
      var blob = xlsxBlob(sheets), a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "Hasil " + String(ev.eventName || "Kuesioner").replace(/[^\w\s-]/g, "").replace(/\s+/g, " ").trim() + ".xlsx";
      a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
      toast("File Excel rapi terunduh 📊");
    } catch (e) { toast("Gagal membuat Excel: " + (e && e.message)); }
  }

  /* ============================================================
     VOTE — pilih opsi (mis. negara), bendera membesar seiring vote
     ============================================================ */
  function flagUrl(code) { return "https://flagcdn.com/w320/" + String(code || "").trim().toLowerCase() + ".png"; }
  // <img> QR: ev.qrImg = file statis di situs sendiri (tak bergantung layanan luar saat hari-H); layanan luar jadi cadangan
  function qrImgTag(ev, cls) { return '<img class="' + cls + '" src="' + qrSrc(sessionURL(ev.code)) + '" alt="QR" />'; }
  function voteQrHTML(ev, title) {
    return '<div class="vqr">' +
      '<div class="vqr-arrow">👇</div>' +
      '<div class="vqr-card">' +
        '<div class="vqr-title">' + (title || 'SCAN &amp; VOTE!') + '</div>' +
        qrImgTag(ev, "vqr-img") +
        '<div class="vqr-sub">Arahkan kamera HP<br/>Kode <b>' + esc(ev.code) + '</b></div>' +
      '</div></div>';
  }
  // Emblem World Cup: pakai worldcup.png bila ada di repo, kalau tidak tampilkan emblem buatan
  function wcBadgeHTML() {
    return '<div class="wc-badge">' +
      '<div class="wc-logo">' +
        '<img class="wc-img" src="worldcup.png?v=30" alt="World Cup 2026" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'" />' +
        '<div class="wc-fb"><span class="wc-ico">🏆</span><span class="wc-t1">WORLD CUP</span><span class="wc-t2">2026</span></div>' +
      '</div>' +
      '<div class="wc-date">⚽ 11 Juni – 19 Juli 2026</div>' +
    '</div>';
  }

  /* ----- Efek: suara "ting", confetti, popup notif ----- */
  var audioCtx = null;
  function ensureAudio() { try { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx && audioCtx.state === "suspended") audioCtx.resume(); } catch (e) {} }
  function playTing() {
    ensureAudio(); if (!audioCtx) return; var t = audioCtx.currentTime;
    function bell(freq, dur, vol) { var o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.type = "sine"; o.frequency.setValueAtTime(freq, t); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t + dur + 0.02); }
    bell(1568, 0.5, 0.32); bell(2350, 0.35, 0.12); bell(3136, 0.28, 0.06);
  }
  var CONF_COLORS = ["#ff5a5c", "#2f8ad6", "#16a34a", "#f5a623", "#8b5cf6", "#e0245e", "#005BAA", "#ffd166"];
  function confettiBurst() {
    var wrap = document.createElement("div"); wrap.className = "confetti";
    for (var i = 0; i < 60; i++) { var d = document.createElement("i"); d.style.left = (Math.random() * 100) + "%"; d.style.background = CONF_COLORS[i % CONF_COLORS.length]; d.style.animationDelay = (Math.random() * 0.25).toFixed(2) + "s"; d.style.setProperty("--x", (Math.random() * 240 - 120).toFixed(0) + "px"); d.style.setProperty("--r", (Math.random() * 720 - 360).toFixed(0) + "deg"); wrap.appendChild(d); }
    document.body.appendChild(wrap); setTimeout(function () { wrap.remove(); }, 2600);
  }
  function votePopup(team) {
    var p = document.createElement("div"); p.className = "vpop"; p.innerHTML = '<span class="vpop-em">🎉</span><b>1 Vote</b> untuk <b>' + esc(team) + '</b>!';
    document.body.appendChild(p); requestAnimationFrame(function () { p.classList.add("show"); });
    setTimeout(function () { p.classList.remove("show"); setTimeout(function () { p.remove(); }, 400); }, 2400);
  }
  function teamName(oid) { var opts = (sess.event && sess.event.options) || []; for (var i = 0; i < opts.length; i++) if (opts[i].oid === oid) return opts[i].name; return "Tim"; }
  function handleLastVote(lv) {
    if (!lv || !lv.ts || lv.ts === sess.lastVoteSeen) return;
    sess.lastVoteSeen = lv.ts;
    playTing(); confettiBurst(); votePopup(teamName(lv.oid));
  }

  var builderVote = null;
  function renderVoteBuilder(ev) {
    builderVote = { code: ev.code, options: (ev.options || []).slice() };
    view().innerHTML =
      '<div class="page">' +
      '<button class="back-link" onclick="QUERY.go(\'/dashboard\')">← Dashboard</button>' +
      '<h3 class="sec">🗳️ Susun Opsi Vote</h3>' +
      '<p class="muted" style="margin:2px 0 14px">' + esc(ev.eventName) + '</p>' +
      '<div id="teamList"></div>' +
      '<div class="card" style="margin-top:14px">' +
        '<h3 class="sec" style="font-size:.98rem">➕ Tambah Opsi / Tim</h3>' +
        '<label class="fld">Nama (mis. negara)</label><input type="text" id="tName" maxlength="40" placeholder="mis. Argentina" />' +
        '<label class="fld">Kode bendera (ISO)</label><input type="text" id="tCode" maxlength="6" placeholder="ar · fr · es · gb-eng" oninput="QUERY.flagPrev()" />' +
        '<div class="hintline">Kode negara 2 huruf (ar, fr, es, br, id...). Inggris=gb-eng, Skotlandia=gb-sct, Wales=gb-wls.</div>' +
        '<div id="flagPrev" style="margin-top:10px"></div>' +
        '<button class="btn block" style="margin-top:12px" onclick="QUERY.addTeam()">+ Tambah</button>' +
      '</div>' +
      '<div class="ev-actions" style="margin-top:16px">' +
        '<button class="btn" onclick="QUERY.go(\'/e/' + ev.code + '\')">📺 Tampilan Live</button>' +
        '<button class="btn ghost" onclick="QUERY.share(\'' + ev.code + '\')">QR & Link (untuk pemilih)</button>' +
      '</div>' + shareBoxHTML(ev.code) + '<div style="height:24px"></div></div>';
    renderTeamList();
  }
  function renderTeamList() {
    var el = $("teamList"); if (!el) return;
    if (!builderVote.options.length) { el.innerHTML = '<div class="empty" style="padding:22px">Belum ada opsi. Tambah tim di bawah 👇</div>'; return; }
    el.innerHTML = builderVote.options.map(function (o) {
      return '<div class="ev-card"><div style="display:flex;gap:12px;align-items:center">' +
        '<img class="flag-sm" src="' + flagUrl(o.code) + '" alt="" onerror="this.style.visibility=\'hidden\'" />' +
        '<div style="flex:1"><div class="en" style="font-size:1rem">' + esc(o.name) + '</div><div class="muted" style="font-size:.8rem">' + esc(o.code) + '</div></div>' +
        '<div style="display:flex;flex-direction:column;gap:5px">' +
          '<button class="btn ghost small" onclick="QUERY.moveTeam(\'' + o.oid + '\',-1)">↑</button>' +
          '<button class="btn ghost small" onclick="QUERY.moveTeam(\'' + o.oid + '\',1)">↓</button>' +
          '<button class="btn ghost small danger" onclick="QUERY.delTeam(\'' + o.oid + '\')">✕</button>' +
        '</div></div></div>';
    }).join("");
  }
  function flagPrev() { var c = ($("tCode").value || "").trim(); var el = $("flagPrev"); if (!el) return; el.innerHTML = c ? '<img class="flag-sm" src="' + flagUrl(c) + '" onerror="this.style.display=\'none\'" />' : ''; }
  function persistVote(cb) { saveOptionsDB(builderVote.code, builderVote.options).then(function () { if (cb) cb(); }).catch(function () { toast("Gagal menyimpan"); }); }
  function addTeam() {
    var name = ($("tName").value || "").trim(), code = ($("tCode").value || "").trim().toLowerCase();
    if (!name) { toast("Isi nama"); return; } if (!code) { toast("Isi kode bendera"); return; }
    builderVote.options.push({ oid: uid().slice(0, 6), name: name, code: code });
    persistVote(function () { $("tName").value = ""; $("tCode").value = ""; flagPrev(); renderTeamList(); toast("Ditambah ✓"); });
  }
  function delTeam(oid) { builderVote.options = builderVote.options.filter(function (o) { return o.oid !== oid; }); persistVote(renderTeamList); }
  function moveTeam(oid, dir) {
    var i = -1; for (var k = 0; k < builderVote.options.length; k++) if (builderVote.options[k].oid === oid) i = k;
    if (i < 0) return; var j = i + dir; if (j < 0 || j >= builderVote.options.length) return;
    var t = builderVote.options[i]; builderVote.options[i] = builderVote.options[j]; builderVote.options[j] = t; persistVote(renderTeamList);
  }

  // ---- Mode bracket (dua duel: Final + Perebutan Juara 3) ----
  function evBrackets() { return (sess.event && sess.event.brackets) || []; }
  function isBracket() { return evBrackets().length > 0; }
  function optById(oid) { var opts = (sess.event && sess.event.options) || []; for (var i = 0; i < opts.length; i++) if (opts[i].oid === oid) return opts[i]; return null; }
  var formPicks = {};

  // Vote orang/perangkat ini — dicek dari server (voterAlias + voters map) + fallback lokal. Hangus saat host reset.
  // Return: {round, oid?, p?:{bid:oid}, alias?} bila sudah vote, atau null.
  function getMyVote() {
    var round = (sess.event && sess.event.voteRound) || "";
    var voters = (sess.event && sess.event.voters) || {};
    var va = (sess.event && sess.event.voterAlias) || {};
    var dev = getDeviceId();
    function fromLocal() {
      var raw = null; try { raw = localStorage.getItem("query_vote_" + sess.code); } catch (e) {} if (!raw) raw = getCookie("qv_" + sess.code);
      if (raw) { try { var v = JSON.parse(raw); if (v && typeof v === "object") return v; } catch (e) {} }
      return null;
    }
    // 1) Dikenali lewat nama/alias tersimpan (paling otoritatif — record ada di server)
    var ak = ""; try { ak = vAliasKey(localStorage.getItem("query_alias_" + sess.code)); } catch (e) {}
    if (ak && va[ak]) { var r = va[ak]; return { round: round, alias: ak, oid: r.o || null, p: r.p || null }; }
    // 2) Perangkat ini terkunci babak ini
    if (round && voters[dev] === round) { var lv = fromLocal() || {}; return { round: round, oid: lv.oid || null, p: lv.p || null, alias: lv.alias }; }
    // 3) Catatan lokal babak ini
    var lv2 = fromLocal();
    if (lv2) { if (round && lv2.round !== round) { try { localStorage.removeItem("query_vote_" + sess.code); } catch (e) {} return null; } return lv2; }
    return null;
  }
  function renderVoteSession() {
    var my = getMyVote();
    if (sess.isOwner || my) { buildVoteLiveShell(my || null); sess.unsub = subscribeEvent(sess.code, function (d) { sess.event = d; updateVoteLive(d.voteCounts || {}); handleLastVote(d.lastVote); }); }
    else renderVoteForm();
  }
  function resetVote() {
    if (!sess.isOwner) return;
    if (!confirm("Reset semua vote ke 0 dan mulai babak baru? Semua orang bisa vote lagi.")) return;
    var u = { lastVote: FV().delete(), voteRound: uid().slice(0, 10), voters: {}, voterAlias: {} };
    (sess.event.options || []).forEach(function (o) { u["voteCounts." + o.oid] = 0; });
    db.collection("events").doc(sess.code).update(u).then(function () { toast("Vote di-reset — mulai dari awal ✓"); }).catch(function () { toast("Gagal reset"); });
  }
  function aliasCardHTML(savedAlias) {
    return '<div class="card" style="margin-bottom:14px">' +
      '<label class="fld">Nama / Alias Anda <span style="color:#e0245e">*</span></label>' +
      '<input type="text" id="vAlias" maxlength="40" autocomplete="off" placeholder="mis. Budi · SVI · Meja 3" value="' + esc(savedAlias) + '" oninput="var e=document.getElementById(\'vAliasErr\');if(e)e.style.display=\'none\';this.style.borderColor=\'\'" />' +
      '<div id="vAliasErr" style="display:none;color:#e0245e;font-size:.82rem;font-weight:700;margin-top:6px">Silahkan isi Nama/Alias Anda dulu</div>' +
      '<div class="hintline" style="margin-top:8px">1 nama = 1 kali submit. Nama yang sudah vote tidak bisa vote lagi.</div>' +
    '</div>';
  }
  // Form bracket: tebak pemenang tiap duel (Final + Perebutan Juara 3)
  function renderBracketForm() {
    var ev = sess.event, brs = evBrackets();
    var savedAlias = ""; try { savedAlias = localStorage.getItem("query_alias_" + sess.code) || ""; } catch (e) {}
    formPicks = {};
    var groups = brs.map(function (b) {
      var teams = [optById(b.a), optById(b.b)].filter(Boolean);
      var cards = teams.map(function (o) {
        return '<button class="bteam" id="bt_' + b.bid + '_' + o.oid + '" onclick="QUERY.pickBracket(\'' + b.bid + '\',\'' + o.oid + '\')">' +
          '<img class="bteam-flag" src="' + flagUrl(o.code) + '" onerror="this.style.visibility=\'hidden\'" />' +
          '<span class="bteam-name">' + esc(o.name) + '</span><span class="bteam-tick">✓</span></button>';
      }).join('<span class="bvs">VS</span>');
      return '<div class="card bform" id="bform_' + b.bid + '"><div class="bform-head">' + esc(b.title) +
        (b.sub ? ' <span class="bform-sub">' + esc(b.sub) + '</span>' : '') + '</div>' +
        '<div class="bteam-row">' + cards + '</div></div>';
    }).join("");
    view().innerHTML = '<div class="wrap">' + heroHTML(ev, "Tebak Juara — 2 Duel") +
      aliasCardHTML(savedAlias) + groups +
      '<button class="btn block" style="margin-top:6px;font-size:1.05rem;padding:15px" onclick="QUERY.submitBracket()">🎉 Kirim Prediksi</button>' +
      '<p class="muted center" style="margin-top:12px;font-size:.85rem">Pilih pemenang di <b>kedua</b> duel, lalu kirim. Cukup sekali.</p></div>';
  }
  function pickBracket(bid, oid) {
    formPicks[bid] = oid;
    var box = $("bform_" + bid); if (box) { box.classList.remove("err"); [].slice.call(box.querySelectorAll(".bteam")).forEach(function (b) { b.classList.remove("sel"); }); }
    var el = $("bt_" + bid + "_" + oid); if (el) el.classList.add("sel");
  }
  function submitBracket() {
    if (sess._voting) return;
    var inp = $("vAlias"), aliasRaw = ((inp && inp.value) || "").trim(), ak = vAliasKey(aliasRaw);
    if (!ak) { var er = $("vAliasErr"); if (er) er.style.display = "block"; if (inp) { inp.style.borderColor = "#e0245e"; inp.focus(); } toast("Isi Nama/Alias Anda dulu ✍️"); return; }
    var brs = evBrackets(), picks = {}, missing = null;
    brs.forEach(function (b) { if (formPicks[b.bid]) picks[b.bid] = formPicks[b.bid]; else if (!missing) missing = b; });
    if (missing) { var mb = $("bform_" + missing.bid); if (mb) { mb.classList.add("err"); mb.scrollIntoView({ behavior: "smooth", block: "center" }); } toast("Pilih pemenang " + missing.title + " dulu"); return; }
    var round = (sess.event && sess.event.voteRound) || "";
    if (getMyVote()) { toast("Perangkat ini sudah vote 🙌"); renderVoteSession(); return; }
    sess._voting = true; ensureAudio();
    var dev = getDeviceId();
    try { localStorage.setItem("query_alias_" + sess.code, aliasRaw); } catch (e) {}
    voteForBracket(sess.code, picks, dev, round, ak, aliasRaw).then(function () {
      var rec = JSON.stringify({ p: picks, round: round, alias: ak });
      try { localStorage.setItem("query_vote_" + sess.code, rec); } catch (e) {} setCookie("qv_" + sess.code, rec);
      toast("Prediksi terkirim! 🎉"); renderVoteSession();
    }).catch(function (err) {
      sess._voting = false;
      if (err && err.message === "dup-alias") {
        var prev = err.dupAlias || {}; var rec = JSON.stringify({ p: prev.p || picks, round: round, alias: ak });
        try { localStorage.setItem("query_vote_" + sess.code, rec); } catch (e) {} setCookie("qv_" + sess.code, rec);
        toast("Nama \"" + aliasRaw + "\" sudah vote 🙌 — tidak bisa 2×"); renderVoteSession();
      } else { toast("Gagal kirim, coba lagi"); }
    });
  }
  function renderVoteForm() {
    var ev = sess.event, opts = ev.options || [];
    if (!opts.length) { view().innerHTML = '<div class="wrap">' + heroHTML(ev, "Vote") + '<div class="card center">Belum ada opsi untuk dipilih.</div></div>'; return; }
    if (isBracket()) { renderBracketForm(); return; }
    var savedAlias = ""; try { savedAlias = localStorage.getItem("query_alias_" + sess.code) || ""; } catch (e) {}
    view().innerHTML = '<div class="wrap">' + heroHTML(ev, "Vote — Pilih Tim Anda") +
      '<div class="card" style="margin-bottom:14px">' +
        '<label class="fld">Nama / Alias Anda <span style="color:#e0245e">*</span></label>' +
        '<input type="text" id="vAlias" maxlength="40" autocomplete="off" placeholder="mis. Budi · SVI · Meja 3" value="' + esc(savedAlias) + '" oninput="var e=document.getElementById(\'vAliasErr\');if(e)e.style.display=\'none\';this.style.borderColor=\'\'" />' +
        '<div id="vAliasErr" style="display:none;color:#e0245e;font-size:.82rem;font-weight:700;margin-top:6px">Silahkan isi Nama/Alias Anda dulu</div>' +
        '<div class="hintline" style="margin-top:8px">1 nama = 1 suara. Nama yang sudah vote tidak bisa vote lagi.</div>' +
      '</div>' +
      '<div class="vote-grid">' + opts.map(function (o) { return '<button class="vote-card" onclick="QUERY.vote(\'' + o.oid + '\')"><img class="flag-md" src="' + flagUrl(o.code) + '" onerror="this.style.display=\'none\'" /><div class="vc-name">' + esc(o.name) + '</div></button>'; }).join("") + '</div>' +
      '<p class="muted center" style="margin-top:14px;font-size:.85rem">Isi nama, lalu ketuk tim jagoanmu 🎉 — cukup sekali, langsung tercatat</p></div>';
  }
  function doVote(oid) {
    if (sess._voting) return;
    var inp = $("vAlias"), aliasRaw = ((inp && inp.value) || "").trim(), ak = vAliasKey(aliasRaw);
    if (!ak) { var er = $("vAliasErr"); if (er) er.style.display = "block"; if (inp) { inp.style.borderColor = "#e0245e"; inp.focus(); } toast("Isi Nama/Alias Anda dulu ✍️"); return; }
    var round = (sess.event && sess.event.voteRound) || "";
    if (getMyVote()) { toast("Perangkat ini sudah vote 🙌"); renderVoteSession(); return; }
    sess._voting = true; ensureAudio();
    var dev = getDeviceId();
    try { localStorage.setItem("query_alias_" + sess.code, aliasRaw); } catch (e) {}
    voteFor(sess.code, oid, dev, round, ak, aliasRaw).then(function () {
      var rec = JSON.stringify({ oid: oid, round: round, alias: ak });
      try { localStorage.setItem("query_vote_" + sess.code, rec); } catch (e) {} setCookie("qv_" + sess.code, rec);
      toast("Vote terkirim! 🎉"); renderVoteSession();
    }).catch(function (err) {
      sess._voting = false;
      if (err && err.message === "dup-alias") {
        var prev = err.dupAlias || {}; var rec = JSON.stringify({ oid: prev.o || oid, round: round, alias: ak });
        try { localStorage.setItem("query_vote_" + sess.code, rec); } catch (e) {} setCookie("qv_" + sess.code, rec);
        toast("Nama \"" + aliasRaw + "\" sudah vote 🙌 — tidak bisa 2×"); renderVoteSession();
      } else { toast("Gagal vote, coba lagi"); }
    });
  }
  function downloadCSV(rows, fname) {
    var csv = "﻿" + rows.map(function (r) { return r.map(function (c) { return '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"'; }).join(","); }).join("\r\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = fname; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
    toast("Hasil diunduh 📥");
  }
  // Unduh hasil vote (nama/alias + pilihan + waktu) sebagai CSV — untuk host
  function exportVotes() {
    var ev = sess.event, va = (ev && ev.voterAlias) || {}, opts = (ev && ev.options) || [];
    var nameOf = {}; opts.forEach(function (o) { nameOf[o.oid] = o.name; });
    var arr = Object.keys(va).map(function (k) { return va[k]; }).sort(function (a, b) { return (a.t || 0) - (b.t || 0); });
    if (isBracket()) {
      var brs = evBrackets(), counts = ev.voteCounts || {};
      var rows = [["No", "Nama/Alias"].concat(brs.map(function (b) { return "Prediksi: " + b.title; })).concat(["Waktu"])];
      arr.forEach(function (r, i) {
        var row = [i + 1, r.n || ""]; brs.forEach(function (b) { row.push(nameOf[(r.p || {})[b.bid]] || ""); }); row.push(r.t ? new Date(r.t).toLocaleString("id-ID") : ""); rows.push(row);
      });
      rows.push([""]); rows.push(["REKAP TIAP DUEL"]);
      brs.forEach(function (b) {
        var ca = counts[b.a] || 0, cb = counts[b.b] || 0;
        rows.push([b.title, nameOf[b.a] + ": " + ca, nameOf[b.b] + ": " + cb, (ca === cb ? "SERI" : "Unggul: " + nameOf[ca > cb ? b.a : b.b])]);
      });
      rows.push([""]); rows.push(["HASIL SEMENTARA"]);
      var f = brs[0], t = brs[1];
      if (f) { var fa = counts[f.a] || 0, fb = counts[f.b] || 0; if (fa !== fb) { rows.push(["Juara 1", nameOf[fa > fb ? f.a : f.b]]); rows.push(["Juara 2", nameOf[fa > fb ? f.b : f.a]]); } }
      if (t) { var ta = counts[t.a] || 0, tb = counts[t.b] || 0; if (ta !== tb) rows.push(["Juara 3", nameOf[ta > tb ? t.a : t.b]]); }
      rows.push(["Total Pemilih", arr.length]);
      downloadCSV(rows, "hasil-prediksi-" + ev.code + ".csv"); return;
    }
    var rows2 = [["No", "Nama/Alias", "Pilihan", "Waktu"]];
    arr.forEach(function (r, i) { rows2.push([i + 1, r.n || "", nameOf[r.o] || r.o || "", r.t ? new Date(r.t).toLocaleString("id-ID") : ""]); });
    rows2.push([""]); rows2.push(["REKAP SUARA", "", "", ""]);
    opts.forEach(function (o) { rows2.push(["", o.name, ((ev.voteCounts || {})[o.oid]) || 0, ""]); });
    rows2.push(["", "TOTAL PEMILIH", arr.length, ""]);
    downloadCSV(rows2, "hasil-vote-" + ev.code + ".csv");
  }
  // Grid pixel: 100 sel (10×10), urutan reveal acak-deterministik
  var PXN = 100;
  var PXRANK = (function () {
    var a = []; for (var i = 0; i < PXN; i++) a.push(i);
    var s = 987654321;
    for (var k = PXN - 1; k > 0; k--) { s = (s * 1103515245 + 12345) & 0x7fffffff; var j = s % (k + 1); var t = a[k]; a[k] = a[j]; a[j] = t; }
    var r = new Array(PXN); for (var m = 0; m < PXN; m++) r[a[m]] = m; return r; // r[cellIndex] = urutan reveal
  })();
  function pxGridHTML(oid, flag) {
    var cells = "", cols = 10, rows = 10;
    for (var i = 0; i < PXN; i++) { var col = i % cols, row = Math.floor(i / cols); var px = (col / (cols - 1) * 100).toFixed(2), py = (row / (rows - 1) * 100).toFixed(2); cells += '<div class="px"><i class="pxfill" style="background-image:url(' + flag + ');background-position:' + px + '% ' + py + '%"></i></div>'; }
    return '<div class="pxflag" id="pff_' + oid + '"><div class="pxgrid" id="pf_' + oid + '">' + cells + '</div></div>';
  }
  var TEAM_COLORS = ["#f43f5e", "#3b82f6", "#f59e0b", "#22c55e", "#a855f7", "#06b6d4"];
  function pmRowHTML(o, col) {
    return '<div class="pm-row" id="vq_' + o.oid + '" style="--tc:' + col + '">' +
      '<div class="pm-rank" id="prk_' + o.oid + '">·</div>' +
      '<div class="pm-flag">' + pxGridHTML(o.oid, flagUrl(o.code)) + '</div>' +
      '<div class="pm-info"><div class="pm-name">' + esc(o.name) + ' <span class="vlead" id="vld_' + o.oid + '">🏆</span></div>' +
      '<div class="pm-bar"><div class="pm-fill" id="vpf_' + o.oid + '"><i class="vprog-wipe"></i></div></div></div>' +
      '<div class="pm-pct"><div class="pm-numrow"><span class="pm-trend" id="ptr_' + o.oid + '">•</span><span class="pm-num" id="vcn_' + o.oid + '">0%</span></div><div class="pm-votes" id="pv_' + o.oid + '">0 vote</div></div>' +
      '</div>';
  }
  // Kartu tim untuk tampilan Match (kuadran): bendera pixel besar, nama+badge, bar pendek, %
  function mCellHTML(o, col) {
    return '<div class="mcell" id="vq_' + o.oid + '" style="--tc:' + col + '">' +
      '<div class="mflag">' + pxGridHTML(o.oid, flagUrl(o.code)) + '</div>' +
      '<div class="mname"><span class="mname-t">' + esc(o.name) + '</span><span class="vlead" id="vld_' + o.oid + '">🏆</span></div>' +
      '<div class="mbar"><div class="pm-fill" id="vpf_' + o.oid + '"><i class="vprog-wipe"></i></div></div>' +
      '<div class="mstat"><span class="pm-trend" id="ptr_' + o.oid + '">•</span><span class="mnum" id="vcn_' + o.oid + '">0%</span><span class="mvotes" id="pv_' + o.oid + '">0 suara</span></div>' +
      '</div>';
  }
  function buildVoteLiveShell(my) {
    var ev = sess.event, opts = ev.options || [], bracket = isBracket();
    var pill;
    if (sess.isOwner) pill = '<span class="live-pill vs-pill"><span class="dot"></span> Live</span>';
    else if (bracket) {
      var picks = (my && my.p) || {};
      var names = evBrackets().map(function (b) { var o = optById(picks[b.bid]); return o ? esc(o.name) : null; }).filter(Boolean);
      pill = names.length ? '<span class="live-pill vs-pill">✅ Prediksi Anda: ' + names.join(" · ") + '</span>' : '';
    } else {
      var mine = (my && my.oid) ? optById(my.oid) : null;
      pill = mine ? '<span class="live-pill vs-pill">✅ Pilihan Anda: ' + esc(mine.name) + '</span>' : '';
    }
    var bodyInner;
    if (bracket) {
      bodyInner = '<div class="mgrid">' + evBrackets().map(function (b, bi) {
        var teams = [optById(b.a), optById(b.b)].filter(Boolean);
        var cells = teams.map(function (o, ti) { return mCellHTML(o, TEAM_COLORS[(bi * 2 + ti) % TEAM_COLORS.length]); }).join('<div class="mvs">VS</div>');
        return '<div class="mrow bkt-' + esc(b.bid) + '"><div class="mhead"><span class="bkt-title">' + esc(b.title) + '</span>' +
          (b.sub ? '<span class="bkt-sub">' + esc(b.sub) + '</span>' : '') + '</div>' +
          '<div class="mcells">' + cells + '</div></div>';
      }).join("") + '</div>';
    } else {
      bodyInner = '<div class="pm-list">' + opts.map(function (o, i) { return pmRowHTML(o, TEAM_COLORS[i % TEAM_COLORS.length]); }).join("") + '</div>';
    }
    var ctrls = '<button class="vs-btn" title="Aktifkan suara" onclick="QUERY.enableSound()">🔔</button>' +
      (sess.isOwner ? '<button class="vs-btn" title="QR & Link" onclick="QUERY.share(\'' + sess.code + '\')">🔗</button>' +
        '<button class="vs-btn" title="Unduh hasil (CSV: nama + pilihan)" onclick="QUERY.exportVotes()">📥</button>' +
        '<button class="vs-btn" title="Reset vote (babak baru)" onclick="QUERY.resetVote()">🔄</button>' : '') +
      '<button class="vs-btn" title="Keluar" onclick="QUERY.go(\'' + (sess.isOwner ? '/dashboard' : '/e/' + sess.code) + '\')">✕</button>';
    view().innerHTML =
      '<div class="vote-screen vs-pm">' +
        '<div class="pm-orbs"><i class="o1"></i><i class="o2"></i><i class="o3"></i><i class="o4"></i></div>' +
        '<div class="vs-top">' +
          '<span class="vs-logobox"><span class="qripple"><i></i><i></i><i></i></span>' +
            '<img class="vs-logo" src="query-logo-white.png?v=43" alt="QUERY" onerror="this.style.display=\'none\'" /></span>' +
          '<div class="vs-mid"><div class="vs-title">' + esc(ev.eventName) + '</div><div class="vs-chips">' + pill + '</div></div>' +
          '<div class="vs-right"><div class="vs-total"><span id="vtotal">0</span> ' + (bracket ? 'pemilih' : 'vote') + '</div><div class="vs-ctrls">' + ctrls + '</div></div>' +
        '</div>' +
        '<div class="vs-body">' +
          bodyInner +
          (sess.isOwner ? '<aside class="vs-side"><div class="vs-slot">' + voteQrHTML(ev) + '</div><div class="vs-slot vs-slot-wc">' + wcBadgeHTML() + '</div></aside>' : '') +
        '</div>' +
        '<div class="vs-foot">' + wcBadgeHTML() + '</div>' +
        '<div class="vs-copy">System Development — GA Dept · © 2026 PT Astra International Tbk <span class="vtag">QUERY v' + appVersion() + '</span></div>' +
        shareBoxHTML(sess.code) +
      '</div>';
    sess.pxCells = {};
    opts.forEach(function (o) { var g = $("pf_" + o.oid); if (g) sess.pxCells[o.oid] = [].slice.call(g.children); });
    sess.lastVoteSeen = (ev.lastVote && ev.lastVote.ts) || 0;
    sess.prevPct = {}; sess.trend = {}; sess.orderKey = "";
    requestAnimationFrame(sizeVoteFlags); setTimeout(sizeVoteFlags, 200);
    if (!window.__vresize) { window.__vresize = true; window.addEventListener("resize", function () { if (document.querySelector(".vote-screen")) sizeVoteFlags(); }); }
    updateVoteLive(ev.voteCounts || {});
  }
  function sizeVoteFlags() {
    var opts = (sess.event && sess.event.options) || [];
    opts.forEach(function (o) { var pff = $("pff_" + o.oid); if (!pff) return; var wrap = pff.parentNode; var cw = wrap.clientWidth, ch = wrap.clientHeight; if (!cw || !ch) return; var w = Math.min(cw, ch * 1.5), h = w / 1.5; pff.style.width = Math.floor(w) + "px"; pff.style.height = Math.floor(h) + "px"; });
  }
  function reorderRows(sorted) {
    var list = document.querySelector(".pm-list"); if (!list) return;
    var els = sorted.map(function (o) { return $("vq_" + o.oid); }).filter(Boolean);
    var oldTop = {}; els.forEach(function (el) { oldTop[el.id] = el.getBoundingClientRect().top; });
    els.forEach(function (el) { list.appendChild(el); });
    els.forEach(function (el) {
      var dy = oldTop[el.id] - el.getBoundingClientRect().top;
      if (dy) { el.style.transition = "none"; el.style.transform = "translateY(" + dy + "px)"; requestAnimationFrame(function () { el.style.transition = "transform .6s cubic-bezier(.2,.8,.2,1)"; el.style.transform = ""; }); }
    });
  }
  function updateVoteLive(counts) {
    counts = counts || {};
    if (isBracket()) return updateBracketLive(counts);
    var opts = (sess.event && sess.event.options) || [], total = 0, maxC = 0;
    var idx = {}; opts.forEach(function (o, i) { idx[o.oid] = i; });
    opts.forEach(function (o) { var c = counts[o.oid] || 0; total += c; if (c > maxC) maxC = c; });
    sess.prevPct = sess.prevPct || {}; sess.trend = sess.trend || {};
    opts.forEach(function (o) {
      var c = counts[o.oid] || 0, N = Math.min(PXN, c), pct = total ? Math.round(c / total * 100) : 0;
      var cells = sess.pxCells && sess.pxCells[o.oid];
      if (cells) for (var i = 0; i < cells.length; i++) cells[i].classList.toggle("on", PXRANK[i] < N);
      var pf = $("vpf_" + o.oid); if (pf) pf.style.width = pct + "%";
      var ce = $("vcn_" + o.oid); if (ce) ce.textContent = pct + "%";
      var pv = $("pv_" + o.oid); if (pv) pv.textContent = c + " vote";
      var prev = sess.prevPct[o.oid];
      if (prev !== undefined && pct !== prev) sess.trend[o.oid] = pct > prev ? "up" : "down";
      sess.prevPct[o.oid] = pct;
      var tr = $("ptr_" + o.oid); if (tr) { var t = sess.trend[o.oid] || ""; tr.className = "pm-trend " + t; tr.textContent = t === "up" ? "▲" : t === "down" ? "▼" : "•"; }
      var isLead = c > 0 && c === maxC;
      var ld = $("vld_" + o.oid); if (ld) ld.style.display = isLead ? "inline-block" : "none";
      var vq = $("vq_" + o.oid); if (vq) vq.classList.toggle("leader", isLead);
    });
    var sorted = opts.slice().sort(function (a, b) { var d = (counts[b.oid] || 0) - (counts[a.oid] || 0); return d !== 0 ? d : idx[a.oid] - idx[b.oid]; });
    sorted.forEach(function (o, i) { var rk = $("prk_" + o.oid); if (rk) { rk.textContent = (i + 1); rk.className = "pm-rank r" + (i + 1); } });
    var orderKey = sorted.map(function (o) { return o.oid; }).join(",");
    if (orderKey !== sess.orderKey) { sess.orderKey = orderKey; reorderRows(sorted); }
    var vt = $("vtotal"); if (vt) vt.textContent = total;
  }
  // Live untuk mode bracket: % per duel, badge Juara 1/2/3, tanpa reorder (tim tetap di duelnya)
  function updateBracketLive(counts) {
    var brs = evBrackets();
    sess.prevPct = sess.prevPct || {}; sess.trend = sess.trend || {};
    brs.forEach(function (b, bi) {
      var ca = counts[b.a] || 0, cb = counts[b.b] || 0, tot = ca + cb;
      [b.a, b.b].forEach(function (oid) {
        var c = counts[oid] || 0, other = (oid === b.a) ? cb : ca;
        var pct = tot ? Math.round(c / tot * 100) : 0, N = Math.min(PXN, c);
        var cells = sess.pxCells && sess.pxCells[oid];
        if (cells) for (var i = 0; i < cells.length; i++) cells[i].classList.toggle("on", PXRANK[i] < N);
        var pf = $("vpf_" + oid); if (pf) pf.style.width = pct + "%";
        var ce = $("vcn_" + oid); if (ce) ce.textContent = pct + "%";
        var pv = $("pv_" + oid); if (pv) pv.textContent = c + " suara";
        var prev = sess.prevPct[oid];
        if (prev !== undefined && pct !== prev) sess.trend[oid] = pct > prev ? "up" : "down";
        sess.prevPct[oid] = pct;
        var tr = $("ptr_" + oid); if (tr) { var t = sess.trend[oid] || ""; tr.className = "pm-trend " + t; tr.textContent = t === "up" ? "▲" : t === "down" ? "▼" : "•"; }
        var isLead = tot > 0 && c > other, isTie = tot > 0 && c === other;
        var badge = "";
        if (bi === 0) badge = isTie ? "SERI" : (isLead ? "🏆 JUARA 1" : "🥈 JUARA 2");
        else badge = isTie ? "SERI" : (isLead ? "🥉 JUARA 3" : "");
        var ld = $("vld_" + oid);
        if (ld) { if (tot > 0 && badge) { ld.textContent = badge; ld.className = "vlead vlead-badge" + (isLead ? " win" : ""); ld.style.display = "inline-block"; } else { ld.style.display = "none"; } }
        var vq = $("vq_" + oid); if (vq) vq.classList.toggle("leader", isLead);
        var rk = $("prk_" + oid); if (rk) rk.style.display = "none";
      });
    });
    var vt = $("vtotal"); if (vt) vt.textContent = Object.keys((sess.event && sess.event.voterAlias) || {}).length;
  }

  /* ============================================================
     PUZZLE REVEAL — testimoni membuka keping, HKA-1 → HKA-2 (lokasi tersembunyi)
     ============================================================ */
  var puzzleB = null;
  function pzTotal(ev) { ev = ev || (sess && sess.event) || {}; return (ev.pzCols || 6) * (ev.pzRows || 4); }
  function pzImg(ev, which) { ev = ev || sess.event; return which === 2 ? (ev.pzImg2 || "hka2.png") : (ev.pzImg1 || "hka1.png"); }
  // Urutan buka keping acak-deterministik: keping ke-k terbuka saat jumlah buka mencapai PZRANK-nya
  function pzRankOrder(total) {
    var a = []; for (var i = 0; i < total; i++) a.push(i);
    var s = 1985229328;
    for (var k = total - 1; k > 0; k--) { s = (s * 1103515245 + 12345) & 0x7fffffff; var j = s % (k + 1); var t = a[k]; a[k] = a[j]; a[j] = t; }
    var r = new Array(total); for (var m = 0; m < total; m++) r[a[m]] = m; return r; // r[cellIndex] = urutan buka
  }
  // Sudah buka keping di HP ini? (kunci server voters/voterAlias + fallback lokal)
  function getMyFlip() {
    var round = (sess.event && sess.event.flipRound) || "", dev = getDeviceId();
    var voters = (sess.event && sess.event.voters) || {}, va = (sess.event && sess.event.voterAlias) || {};
    if (round && (voters[dev] === round || va[dev])) return true;
    var raw = null; try { raw = localStorage.getItem("query_flip_" + sess.code); } catch (e) {} if (!raw) raw = getCookie("qf_" + sess.code);
    return !!(raw && round && raw === round);
  }
  // Rekam via TRANSACTION: 1 HP 1 keping; flips absolut (idempoten walau retry)
  function flipPuzzle(code, dev, round, name, comment) {
    var ref = db.collection("events").doc(code), ts = Date.now();
    return db.runTransaction(function (tx) {
      return tx.get(ref).then(function (doc) {
        var d = (doc.exists && doc.data()) || {}, va = d.voterAlias || {};
        if (dev && va[dev]) throw new Error("already-flipped");
        var total = pzTotal(d), cur = d.flips || 0, u = {};
        if (cur < total) u.flips = cur + 1;
        u.lastFlip = { n: name, c: comment, ts: ts };
        if (dev) { u["voters." + dev] = round; u["voterAlias." + dev] = { n: name, c: comment, t: ts }; }
        tx.update(ref, u);
      });
    });
  }
  function resetPuzzle() {
    if (!sess.isOwner) return;
    if (!confirm("Reset puzzle ke gambar awal & hapus semua testimoni? Semua orang bisa buka keping lagi.")) return;
    db.collection("events").doc(sess.code).update({ flips: 0, lastFlip: FV().delete(), flipRound: uid().slice(0, 10), voters: {}, voterAlias: {} })
      .then(function () { toast("Puzzle di-reset ✓"); }).catch(function () { toast("Gagal reset"); });
  }
  function revealAll() {
    if (!sess.isOwner) return;
    if (!confirm("Ungkap SEMUA keping sekarang (tampilkan lokasi HKA di layar)?")) return;
    db.collection("events").doc(sess.code).update({ flips: pzTotal() }).then(function () { toast("Lokasi terungkap! 🎉"); }).catch(function () { toast("Gagal"); });
  }
  function renderPuzzleSession() {
    if (sess.isOwner || getMyFlip()) { buildPuzzleLive(); sess.unsub = subscribeEvent(sess.code, function (d) { sess.event = d; updatePuzzleLive(d); }); }
    else renderPuzzleForm();
  }
  // Pertanyaan untuk peserta disimpan per event (pzPrompt), bukan ditulis mati di kode
  function pzPrompt(ev) { ev = ev || sess.event || {}; return String(ev.pzPrompt || "Tulis pesan Anda").trim(); }
  function renderPuzzleForm() {
    var ev = sess.event, savedName = ""; try { savedName = localStorage.getItem("query_name") || ""; } catch (e) {}
    var clr = 'oninput="this.style.borderColor=\'\';var e=document.getElementById(\'pzErr\');if(e)e.style.display=\'none\'"';
    view().innerHTML = '<div class="wrap">' + heroHTML(ev, "Buka Keping") +
      '<div class="card" style="margin-bottom:14px">' +
        '<div class="pz-q">' + esc(pzPrompt(ev)) + '</div>' +
        '<div class="pz-lead muted center" style="font-weight:600;font-size:.9rem">Setiap jawaban membuka 1 keping puzzle. Bersama-sama kita ungkap lokasinya!</div>' +
        '<label class="fld" style="margin-top:14px">Jawaban Anda <span style="color:#e0245e">*</span></label>' +
        '<input type="text" id="pzComment" maxlength="60" autocomplete="off" placeholder="mis. Juara · Keluarga · Inspiratif" ' + clr + ' />' +
        '<label class="fld" style="margin-top:12px">Nama Anda <span style="color:#e0245e">*</span></label>' +
        '<input type="text" id="pzName" maxlength="40" autocomplete="off" placeholder="mis. Budi / Keluarga Santoso" value="' + esc(savedName) + '" ' + clr + ' />' +
        '<div id="pzErr" style="display:none;color:#e0245e;font-size:.82rem;font-weight:700;margin-top:8px"></div>' +
      '</div>' +
      '<button class="btn block" style="font-size:1.05rem;padding:15px" onclick="QUERY.submitPuzzle()">🧩 Kirim &amp; Buka Keping</button>' +
      '<p class="muted center" style="margin-top:12px;font-size:.85rem">1 HP membuka 1 keping. Jawabanmu akan melintas sekejap di layar utama 💫</p></div>';
  }
  function submitPuzzle() {
    if (sess._flipping) return;
    var ni = $("pzName"), ci = $("pzComment"), er = $("pzErr");
    var name = ((ni && ni.value) || "").trim(), comment = ((ci && ci.value) || "").trim();
    function fail(el, msg) { if (el) { el.style.borderColor = "#e0245e"; el.focus(); } if (er) { er.textContent = msg; er.style.display = "block"; } }
    if (!comment) { fail(ci, "Isi jawaban Anda dulu ✍️"); return; }
    if (!name) { fail(ni, "Isi nama Anda dulu ✍️"); return; }
    if (getMyFlip()) { toast("HP ini sudah membuka keping 🙌"); renderPuzzleSession(); return; }
    sess._flipping = true; ensureAudio();
    var dev = getDeviceId(), round = (sess.event && sess.event.flipRound) || "";
    try { localStorage.setItem("query_name", name); localStorage.setItem("query_flip_" + sess.code, round); } catch (e) {} setCookie("qf_" + sess.code, round);
    flipPuzzle(sess.code, dev, round, name, comment).then(function () { toast("Keping terbuka! Terima kasih 💙"); renderPuzzleSession(); })
      .catch(function (e2) { sess._flipping = false;
        if (e2 && e2.message === "already-flipped") { toast("HP ini sudah membuka keping 🙌"); renderPuzzleSession(); }
        else { try { localStorage.removeItem("query_flip_" + sess.code); } catch (e) {} toast("Gagal, coba lagi"); }
      });
  }
  function pzBoardHTML(ev) {
    var cols = ev.pzCols || 6, rows = ev.pzRows || 4, total = cols * rows, i1 = pzImg(ev, 1), i2 = pzImg(ev, 2), bs = (cols * 100) + "% " + (rows * 100) + "%", cells = "";
    for (var i = 0; i < total; i++) {
      var col = i % cols, row = Math.floor(i / cols);
      var px = (cols > 1 ? col / (cols - 1) * 100 : 0).toFixed(3), py = (rows > 1 ? row / (rows - 1) * 100 : 0).toFixed(3);
      cells += '<div class="pztile" id="pzt_' + i + '"><div class="pzflip">' +
        '<div class="pzface pzfront" style="background-image:url(' + esc(i1) + ');background-size:' + bs + ';background-position:' + px + '% ' + py + '%"></div>' +
        '<div class="pzface pzback" style="background-image:url(' + esc(i2) + ');background-size:' + bs + ';background-position:' + px + '% ' + py + '%"></div>' +
        '</div></div>';
    }
    // Jarak kisi mengecil saat keping banyak (3px di 400 keping = jaring putih yang menutupi gambar)
    var gp = cols >= 16 ? 1 : (cols >= 10 ? 2 : 3);
    return '<div class="pzboard' + (cols >= 16 ? ' dense' : '') + '" style="gap:' + gp + 'px;padding:' + gp + 'px;grid-template-columns:repeat(' + cols + ',1fr);grid-template-rows:repeat(' + rows + ',1fr)">' + cells + '</div>';
  }
  function buildPuzzleLive() {
    var ev = sess.event;
    var ctrls = '<button class="vs-btn" title="Layar penuh" onclick="QUERY.pzFullscreen()">⛶</button>' +
      '<button class="vs-btn" title="Aktifkan suara" onclick="QUERY.enableSound()">🔔</button>' +
      (sess.isOwner ? '<button class="vs-btn" title="QR & Link" onclick="QUERY.share(\'' + sess.code + '\')">🔗</button>' +
        '<button class="vs-btn" title="Unduh jawaban (Excel)" onclick="QUERY.exportPuzzle()">📥</button>' +
        '<button class="vs-btn pz-revealbtn" title="Ungkap SEMUA keping" onclick="QUERY.revealAll()">🔓</button>' +
        '<button class="vs-btn" title="Reset puzzle" onclick="QUERY.resetPuzzle()">🔄</button>' : '') +
      '<button class="vs-btn" title="Keluar" onclick="QUERY.go(\'' + (sess.isOwner ? '/dashboard' : '/e/' + sess.code) + '\')">✕</button>';
    // Tata letak layar penuh: 90% gambar puzzle, 10% kolom kanan (logo, penghitung, QR, tombol)
    view().innerHTML =
      '<div class="vote-screen vs-pm pz-screen pz-full">' +
        '<div class="pm-orbs"><i class="o1"></i><i class="o2"></i><i class="o3"></i><i class="o4"></i></div>' +
        '<div class="pz-layout">' +
          '<div class="pz-stage">' + pzBoardHTML(ev) + '<div class="pz-done" id="pzDone"><span>📍 Lokasi Hari Keluarga Astra Terungkap!</span></div></div>' +
          '<aside class="pz-rail">' +
            '<div class="pz-rail-top">' +
              '<span class="qlogo-wrap pz-logo"><span class="qripple"><i></i><i></i><i></i></span><img src="query-logo-white.png?v=43" alt="QUERY" onerror="this.style.display=\'none\'" /></span>' +
              '<div class="pz-count"><b id="pzcount">0</b><span>/' + pzTotal(ev) + ' keping</span></div>' +
              (sess.isOwner ? '' : '<div class="pz-mine">✅ Keping Anda terbuka</div>') +
            '</div>' +
            (sess.isOwner ? '<div class="pz-qr"><div class="pz-qr-t">SCAN &amp; JAWAB</div><div class="pz-qr-q">' + esc(pzPrompt(ev)) + '</div>' + qrImgTag(ev, "pz-qr-img") + '</div>' : '') +
            '<div class="pz-rail-bot"><div class="pz-ctrls">' + ctrls + '</div><span class="vtag">QUERY v' + appVersion() + '</span></div>' +
          '</aside>' +
        '</div>' +
        shareBoxHTML(sess.code) +
        '<div class="pz-pops" id="pzPops"></div>' +
      '</div>';
    sess.pzRank = pzRankOrder(pzTotal(ev)); sess.lastFlipSeen = (ev.lastFlip && ev.lastFlip.ts) || 0; sess.pzCelebrated = false;
    updatePuzzleLive(ev);
  }
  // Layar penuh browser (sembunyikan tab & address bar di proyektor). Butuh klik pengguna, jadi lewat tombol.
  function pzFullscreen() {
    var d = document, el = d.documentElement;
    try {
      if (!(d.fullscreenElement || d.webkitFullscreenElement)) { (el.requestFullscreen || el.webkitRequestFullscreen).call(el); }
      else { (d.exitFullscreen || d.webkitExitFullscreen).call(d); }
    } catch (e) { toast("Tekan F11 untuk layar penuh"); }
  }
  function updatePuzzleLive(ev) {
    var total = pzTotal(ev), flips = Math.min(total, ev.flips || 0), rank = sess.pzRank || (sess.pzRank = pzRankOrder(total));
    for (var i = 0; i < total; i++) { var t = $("pzt_" + i); if (t) t.classList.toggle("on", rank[i] < flips); }
    var cnt = $("pzcount"); if (cnt) cnt.textContent = flips;
    var done = $("pzDone");
    if (total > 0 && flips >= total) { if (done) done.classList.add("show"); if (!sess.pzCelebrated) { sess.pzCelebrated = true; try { confettiBurst(); } catch (e) {} try { playTing(); } catch (e) {} } }
    else { if (done) done.classList.remove("show"); sess.pzCelebrated = false; }
    handleFlipPopup(ev.lastFlip);
  }
  function handleFlipPopup(lf) {
    if (!lf || !lf.ts || lf.ts === sess.lastFlipSeen) return;
    sess.lastFlipSeen = lf.ts; ensureAudio(); try { playTing(); } catch (e) {}
    var wrap = $("pzPops"); if (!wrap) return;
    var p = document.createElement("div"); p.className = "pz-pop" + (String(lf.c || "").length <= 24 ? " short" : "");
    p.innerHTML = '<div class="pz-pop-c">“' + esc(lf.c || "") + '”</div><div class="pz-pop-n">— ' + esc(lf.n || "Anonim") + '</div>';
    p.style.left = (8 + Math.random() * 52).toFixed(1) + "%";
    wrap.appendChild(p);
    requestAnimationFrame(function () { p.classList.add("show"); });
    setTimeout(function () { p.classList.add("fall"); }, 1900);
    setTimeout(function () { if (p.parentNode) p.remove(); }, 4400);
  }
  function exportPuzzle() {
    var ev = sess.event, va = (ev && ev.voterAlias) || {};
    var arr = Object.keys(va).map(function (k) { return va[k]; }).sort(function (a, b) { return (a.t || 0) - (b.t || 0); });
    var rows = [[XT("JAWABAN PESERTA — " + (ev.eventName || "Hari Keluarga Astra"), 1)],
      [XT("Pertanyaan: " + pzPrompt(ev) + " · " + arr.length + " jawaban · keping terbuka " + Math.min(pzTotal(ev), ev.flips || 0) + "/" + pzTotal(ev), 8)], [],
      [XT("No", 2), XT("Nama", 2), XT(pzPrompt(ev), 2), XT("Waktu", 2)]];
    arr.forEach(function (r, i) { rows.push([XN(i + 1, 5), XT(r.n || "", 3), XT(r.c || "", 3), XT(r.t ? new Date(r.t).toLocaleString("id-ID") : "", 5)]); });
    try {
      var blob = xlsxBlob([{ name: "Testimoni HKA", rows: rows, opt: { cols: [5, 24, 62, 18], freeze: { y: 4 }, merges: ["A1:D1", "A2:D2"] } }]);
      var a = document.createElement("a"); a.href = URL.createObjectURL(blob);
      a.download = "Testimoni " + String(ev.eventName || "HKA").replace(/[^\w\s-]/g, "").replace(/\s+/g, " ").trim() + ".xlsx"; a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500); toast("Testimoni terunduh 📥");
    } catch (e) { toast("Gagal membuat Excel"); }
  }
  function renderPuzzleBuilder(ev) {
    puzzleB = { code: ev.code, cols: ev.pzCols || 6, rows: ev.pzRows || 4 };
    var grids = [[6, 4], [10, 8], [16, 12], [25, 16]];
    view().innerHTML = '<div class="page">' +
      '<button class="back-link" onclick="QUERY.go(\'/dashboard\')">← Dashboard</button>' +
      '<h3 class="sec">🧩 Atur Puzzle Reveal</h3>' +
      '<p class="muted" style="margin:2px 0 14px">' + esc(ev.eventName) + '</p>' +
      '<div class="card">' +
        '<label class="fld">Pertanyaan untuk peserta (muncul saat scan QR)</label><input type="text" id="pzQ" maxlength="80" value="' + esc(pzPrompt(ev)) + '" placeholder="mis. 1 Kata Untuk Astra" />' +
        '<label class="fld" style="margin-top:12px">Gambar AWAL (HKA-1) — nama file / URL</label><input type="text" id="pzI1" maxlength="200" value="' + esc(ev.pzImg1 || "hka1.png") + '" placeholder="hka1.png" />' +
        '<label class="fld" style="margin-top:12px">Gambar REVEAL (HKA-2, berisi lokasi) — nama file / URL</label><input type="text" id="pzI2" maxlength="200" value="' + esc(ev.pzImg2 || "hka2.png") + '" placeholder="hka2.png" />' +
        '<div class="hintline" style="margin-top:6px">Taruh kedua gambar di folder web (rasio SAMA, mis. 1600×900) lalu tulis nama filenya, atau tempel URL penuh.</div>' +
        '<label class="fld" style="margin-top:14px">Jumlah keping — pilih cepat atau isi manual</label>' +
        '<div class="seg" id="pzGrid" style="flex-wrap:wrap">' + grids.map(function (g) { var act = (g[0] === puzzleB.cols && g[1] === puzzleB.rows) ? " active" : ""; return '<button class="' + act.trim() + '" onclick="QUERY.pzGrid(' + g[0] + ',' + g[1] + ',this)">' + (g[0] * g[1]) + '</button>'; }).join("") + '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap">' +
          '<input type="number" id="pzC" min="2" max="40" value="' + puzzleB.cols + '" oninput="QUERY.pzCustom()" style="width:74px;text-align:center" /> <span class="muted">kolom</span>' +
          '<span class="muted" style="font-weight:800">×</span>' +
          '<input type="number" id="pzR" min="2" max="40" value="' + puzzleB.rows + '" oninput="QUERY.pzCustom()" style="width:74px;text-align:center" /> <span class="muted">baris</span>' +
          '<span class="muted" style="margin-left:auto;font-weight:700">= <b id="pzTot" style="color:var(--astra-dark);font-size:1.05rem">' + (puzzleB.cols * puzzleB.rows) + '</b> keping</span>' +
        '</div>' +
        '<div class="hintline" id="pzGridHint" style="margin-top:8px"></div>' +
        '<button class="btn block" style="margin-top:16px" onclick="QUERY.savePuzzle()">💾 Simpan</button>' +
      '</div>' +
      '<div class="ev-actions" style="margin-top:16px">' +
        '<button class="btn" onclick="QUERY.go(\'/e/' + ev.code + '\')">📺 Tampilan Live (layar)</button>' +
        '<button class="btn ghost" onclick="QUERY.share(\'' + ev.code + '\')">QR & Link (untuk peserta)</button>' +
      '</div>' + shareBoxHTML(ev.code) + '<div style="height:24px"></div></div>';
    pzUpdTot();
  }
  function pzClamp(n) { n = parseInt(n, 10); if (!(n >= 2)) n = 2; if (n > 40) n = 40; return n; }
  function pzUpdTot() {
    var t = puzzleB.cols * puzzleB.rows, el = $("pzTot"); if (el) el.textContent = t;
    var h = $("pzGridHint"); if (h) h.innerHTML = t > 150
      ? "⚠️ " + t + " keping itu banyak: butuh ~" + t + " peserta agar penuh sendiri — pakai tombol <b>🔓 Ungkap Semua</b> untuk klimaks. Layar/HP mungkin sedikit lebih berat."
      : "Tiap peserta membuka 1 keping. Total " + t + " keping.";
  }
  function pzSyncInputs() { var c = $("pzC"), r = $("pzR"); if (c) c.value = puzzleB.cols; if (r) r.value = puzzleB.rows; }
  function pzGrid(c, r, btn) { puzzleB.cols = c; puzzleB.rows = r; var seg = $("pzGrid"); if (seg) { var bs = seg.getElementsByTagName("button"); for (var i = 0; i < bs.length; i++) bs[i].classList.remove("active"); } if (btn) btn.classList.add("active"); pzSyncInputs(); pzUpdTot(); }
  function pzCustom() {
    puzzleB.cols = pzClamp($("pzC").value); puzzleB.rows = pzClamp($("pzR").value);
    var seg = $("pzGrid"); if (seg) { var bs = seg.getElementsByTagName("button"); for (var i = 0; i < bs.length; i++) bs[i].classList.remove("active"); }
    pzUpdTot();
  }
  function savePuzzle() {
    var u = { pzPrompt: (($("pzQ").value || "").trim() || "Tulis pesan Anda"), pzCols: puzzleB.cols, pzRows: puzzleB.rows, pzImg1: (($("pzI1").value || "").trim() || "hka1.png"), pzImg2: (($("pzI2").value || "").trim() || "hka2.png") };
    db.collection("events").doc(puzzleB.code).update(u).then(function () { toast("Tersimpan ✓"); }).catch(function () { toast("Gagal simpan"); });
  }

  /* ---------- API global untuk markup onclick ---------- */
  window.QUERY = {
    go: go, seg: seg, logout: function () { clearHost(); setNav(); toast("Keluar"); go("/"); },
    login: doLogin, register: doRegister, join: doJoin,
    createEvent: doCreateEvent, share: doShare, shareResults: shareResults, copy: doCopy, delEvent: doDelEvent,
    react: react, toggleReply: toggleReply, sendReply: sendReply, openAnswer: openAnswer, saveAnswer: saveAnswer, unanswer: unanswer, delQ: delQ,
    fmt: fmt, fmtKey: fmtKey,
    pickType: pickType, nfType: nfTypeUI, addField: addField, delField: delField, moveField: moveField,
    pickRate: pickRate, submitSurvey: submitSurvey, exportSurvey: exportSurvey, fillAgain: fillAgain,
    flagPrev: flagPrev, addTeam: addTeam, delTeam: delTeam, moveTeam: moveTeam, vote: doVote, resetVote: resetVote, exportVotes: exportVotes,
    pickBracket: pickBracket, submitBracket: submitBracket,
    submitPuzzle: submitPuzzle, resetPuzzle: resetPuzzle, revealAll: revealAll, exportPuzzle: exportPuzzle, pzGrid: pzGrid, pzCustom: pzCustom, savePuzzle: savePuzzle, pzFullscreen: pzFullscreen,
    enableSound: function () { ensureAudio(); playTing(); toast("🔔 Suara aktif"); }
  };

  function appVersion() { return (window.APP && window.APP.APP_VERSION) || "?"; }
  function paintVersion() { var el = $("appVer"); if (el) el.textContent = "QUERY v" + appVersion(); }
  function boot() {
    paintVersion(); window.addEventListener("hashchange", route);
    // Esc menutup popup QR & Link yang sedang terbuka
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") [].forEach.call(document.querySelectorAll(".share-box.open"), function (b) { b.classList.remove("open"); }); });
    route();
  }
  window.App = { boot: boot };
})();
