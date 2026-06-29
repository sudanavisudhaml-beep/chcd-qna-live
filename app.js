/* ============================================================
   Logika aplikasi Q&A Live (script biasa — jalan walau dobel-klik).
   Dipakai oleh index.html (audience) & presenter.html (presenter).
   ============================================================ */
(function () {
  "use strict";
  var CFG = window.APP || {};
  var fb = window.firebase;
  var configured = CFG.firebaseConfig && String(CFG.firebaseConfig.apiKey).indexOf("GANTI") !== 0;

  var db = null;
  if (configured && fb) {
    fb.initializeApp(CFG.firebaseConfig);
    db = fb.firestore();
  }
  var COL = "questions";
  function FV() { return fb.firestore.FieldValue; }
  function uid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : "r" + Date.now() + Math.floor(Math.random() * 1e6); }

  /* ---------- MODE DEMO (tanpa Firebase): data contoh interaktif ---------- */
  var demo = {
    subs: [],
    items: [
      { id: "d1", name: "Rina (Procurement)", text: "Untuk pengadaan di bawah Rp50 juta, apakah tetap wajib 3 penawaran atau bisa penunjukan langsung?",
        reactions: { like: 7, love: 2 }, answered: false, answer: "",
        replies: [{ rid: "x1", name: "Budi", text: "Setuju, ini sering jadi pertanyaan di unit kami.", ts: Date.now() - 3 * 60000 }],
        createdAt: { seconds: Math.floor((Date.now() - 12 * 60000) / 1000) } },
      { id: "d2", name: "Anonim", text: "Berapa lama SLA approval dari user request sampai PO terbit?",
        reactions: { like: 4, love: 5 }, answered: true, answer: "Target SLA 5 hari kerja untuk pengadaan reguler; akan dibahas di slide berikutnya.",
        replies: [], createdAt: { seconds: Math.floor((Date.now() - 25 * 60000) / 1000) } },
    ],
    emit: function () { var snap = this.items.map(function (x) { return JSON.parse(JSON.stringify(x)); }); this.subs.forEach(function (cb) { cb(snap); }); },
    find: function (id) { return this.items.filter(function (x) { return x.id === id; })[0]; },
  };

  /* ---------- API data (otomatis pilih Firebase / demo) ---------- */
  var DB = {
    configured: function () { return configured; },
    add: function (text, name) {
      var t = String(text).trim(), n = (name || "").trim() || "Anonim";
      if (!db) { demo.items.push({ id: uid(), text: t, name: n, reactions: { like: 0, love: 0 }, replies: [], answered: false, answer: "", createdAt: { seconds: Math.floor(Date.now() / 1000) } }); demo.emit(); return Promise.resolve(); }
      return db.collection(COL).add({ text: t, name: n, reactions: { like: 0, love: 0 }, replies: [], answered: false, answer: "", createdAt: FV().serverTimestamp() });
    },
    subscribe: function (cb) {
      if (!db) { demo.subs.push(cb); demo.emit(); return function () {}; }
      return db.collection(COL).orderBy("createdAt", "asc").onSnapshot(function (snap) {
        var items = []; snap.forEach(function (d) { var x = d.data(); items.push({ id: d.id, text: x.text, name: x.name, reactions: x.reactions || { like: 0, love: 0 }, replies: x.replies || [], answered: !!x.answered, answer: x.answer || "", createdAt: x.createdAt }); });
        cb(items);
      });
    },
    react: function (id, type, delta) {
      if (!db) { var q = demo.find(id); if (q) { q.reactions[type] = (q.reactions[type] || 0) + delta; demo.emit(); } return Promise.resolve(); }
      var u = {}; u["reactions." + type] = FV().increment(delta); return db.collection(COL).doc(id).update(u);
    },
    reply: function (id, text, name, presenter) {
      var r = { rid: uid(), text: String(text).trim(), name: (name || "").trim() || "Anonim", ts: Date.now(), presenter: !!presenter };
      if (!db) { var q = demo.find(id); if (q) { q.replies.push(r); demo.emit(); } return Promise.resolve(); }
      return db.collection(COL).doc(id).update({ replies: FV().arrayUnion(r) });
    },
    answer: function (id, answer, answered) {
      if (!db) { var q = demo.find(id); if (q) { q.answer = answer; q.answered = !!answered; demo.emit(); } return Promise.resolve(); }
      return db.collection(COL).doc(id).update({ answer: answer, answered: !!answered });
    },
    remove: function (id) {
      if (!db) { demo.items = demo.items.filter(function (x) { return x.id !== id; }); demo.emit(); return Promise.resolve(); }
      return db.collection(COL).doc(id).delete();
    },
  };

  /* ---------- Util ---------- */
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function initial(name) { var n = (name || "A").trim(); return n ? n[0].toUpperCase() : "A"; }
  function tsOf(q) { return q.createdAt && q.createdAt.seconds ? q.createdAt.seconds * 1000 : 0; }
  function score(q) { return (q.reactions && q.reactions.like || 0) + (q.reactions && q.reactions.love || 0) * 2; }
  function reactCount(q) { return (q.reactions && q.reactions.like || 0) + (q.reactions && q.reactions.love || 0); }
  // Warna avatar konsisten per nama
  var PAL = [["#2f6bff", "#1f4fd0"], ["#e0245e", "#b01244"], ["#16a34a", "#0f7a37"], ["#f59e0b", "#c87c06"], ["#8b5cf6", "#6d34d6"], ["#0ea5e9", "#0876ab"], ["#ef4444", "#b91c1c"]];
  function avColor(name) { var s = 0, str = name || "A"; for (var i = 0; i < str.length; i++) s = (s + str.charCodeAt(i)) % PAL.length; var p = PAL[s]; return "linear-gradient(135deg," + p[0] + "," + p[1] + ")"; }
  // Centang biru penanda presenter (membedakan dari user lain)
  function vcheck() { return '<span class="verified" title="Presenter">✓</span>'; }
  // Avatar; jika presenter -> warna Astra + badge centang biru di pojok
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
  function toast(msg) { var t = $("toast"); if (!t) return; t.textContent = msg; t.classList.add("show"); setTimeout(function () { t.classList.remove("show"); }, 2000); }

  /* ============================================================
     HALAMAN AUDIENCE
     ============================================================ */
  function setText(id, val) { var e = $(id); if (e) e.textContent = val; }

  function initAudience() {
    var NAME = CFG.APP_NAME || "QUERY";
    setText("appName", NAME);
    setText("tagline", CFG.APP_TAGLINE || "");
    setText("event", CFG.APP_EVENT || "");
    setText("materi", CFG.APP_MATERI || "");
    document.title = NAME + (CFG.APP_EVENT ? " — " + CFG.APP_EVENT : "");

    var items = [], sortByTop = true;
    var openReply = {}, openAnswer = {};
    var admin = sessionStorage.getItem("chcd_admin") === "1";
    var reacts = JSON.parse(localStorage.getItem("chcd_reacts") || "{}");
    var saveReacts = function () { localStorage.setItem("chcd_reacts", JSON.stringify(reacts)); };

    // ----- Mode presenter (menjawab langsung di halaman ini) -----
    function setAdminUI() {
      var b = $("adminBtn");
      if (admin) { b.textContent = "✅ Mode Presenter — keluar"; b.classList.add("on"); }
      else { b.textContent = "🔑 Presenter"; b.classList.remove("on"); }
    }
    $("adminBtn").addEventListener("click", function () {
      if (admin) { admin = false; sessionStorage.removeItem("chcd_admin"); toast("Keluar mode presenter"); }
      else {
        var p = prompt("Masukkan PIN Presenter untuk bisa menjawab di halaman ini:");
        if (p === null) return;
        if (p !== String(CFG.PRESENTER_PIN)) { toast("PIN salah"); return; }
        admin = true; sessionStorage.setItem("chcd_admin", "1"); toast("Mode presenter aktif — Anda bisa menjawab langsung");
      }
      setAdminUI(); render();
    });
    setAdminUI();

    window.__openAnswer = function (id) { openAnswer[id] = !openAnswer[id]; render(); var el = $("ans_" + id); if (el) { el.focus(); el.selectionStart = el.value.length; } };
    window.__saveAnswer = function (id) {
      var ta = $("ans_" + id), text = ta.value.trim();
      if (!text) { toast("Tulis jawaban dulu"); return; }
      openAnswer[id] = false;
      DB.answer(id, text, true).then(function () { toast("Jawaban tampil ke semua ✓"); }).catch(function () { toast("Gagal menyimpan"); });
      render();
    };
    window.__unanswer = function (id) { openAnswer[id] = false; DB.answer(id, "", false).then(function () { toast("Ditandai belum dijawab"); }).catch(function () { toast("Gagal"); }); render(); };
    window.__delQ = function (id) { if (!confirm("Hapus pertanyaan ini beserta balasannya?")) return; DB.remove(id).then(function () { toast("Dihapus"); }).catch(function () { toast("Gagal hapus"); }); };

    $("ninput").value = localStorage.getItem("chcd_name") || "";
    refreshAvatar();
    $("ninput").addEventListener("input", function () { localStorage.setItem("chcd_name", $("ninput").value); refreshAvatar(); nameError(false); });
    function nameError(show) {
      var n = $("ninput"), e = $("nameErr");
      if (show) {
        n.style.setProperty("border-color", "#e0245e", "important");
        n.style.setProperty("box-shadow", "0 0 0 4px rgba(224,36,94,.16)", "important");
        n.style.setProperty("background", "#fff5f8", "important");
        if (e) e.style.display = "block";
        n.focus();
      } else {
        n.style.removeProperty("border-color");
        n.style.removeProperty("box-shadow");
        n.style.removeProperty("background");
        if (e) e.style.display = "none";
      }
    }
    function refreshAvatar() { var n = ($("ninput").value || "").trim(); $("meAvatar").textContent = n ? n[0].toUpperCase() : "?"; $("meAvatar").style.background = avColor(n || "?"); }

    if (!DB.configured()) {
      $("warn").innerHTML = '<div class="banner"><b>Mode demo</b> — Firebase belum dikonfigurasi, jadi ini data contoh (boleh diklik). Isi <code>config.js</code> agar diskusi tersimpan &amp; live. Lihat <b>README.md</b>.</div>';
    }

    $("qinput").addEventListener("input", function (e) { $("counter").textContent = e.target.value.length + "/500"; });
    $("sendBtn").addEventListener("click", function () {
      var text = $("qinput").value.trim();
      if (!$("ninput").value.trim()) { nameError(true); toast("Isi nama Anda dulu"); return; }
      if (!text) { toast("Tulis sesuatu dulu ya"); return; }
      $("sendBtn").disabled = true;
      DB.add(text, $("ninput").value).then(function () { $("qinput").value = ""; $("counter").textContent = "0/500"; toast("Terkirim! 🙌"); })
        .catch(function () { toast("Gagal mengirim. Cek koneksi/konfigurasi."); })
        .then(function () { $("sendBtn").disabled = false; });
    });
    $("sortBtn").addEventListener("click", function () { sortByTop = !sortByTop; $("sortBtn").textContent = "Urutkan: " + (sortByTop ? "Teratas" : "Terbaru"); render(); });

    window.__react = function (id, type) {
      reacts[id] = reacts[id] || { like: false, love: false };
      var active = reacts[id][type]; reacts[id][type] = !active; saveReacts(); render();
      DB.react(id, type, active ? -1 : 1).catch(function () { reacts[id][type] = active; saveReacts(); render(); toast("Gagal"); });
    };
    window.__toggleReply = function (id) { openReply[id] = !openReply[id]; render(); var el = $("ri_" + id); if (el) el.focus(); };
    window.__sendReply = function (id) {
      var inp = $("ri_" + id), text = inp.value.trim();
      if (!text) { toast("Tulis balasan dulu"); return; }
      if (!$("ninput").value.trim()) { nameError(true); toast("Isi nama Anda dulu"); return; }
      inp.disabled = true;
      DB.reply(id, text, $("ninput").value, admin).then(function () { inp.value = ""; toast(admin ? "Balasan presenter terkirim ✓" : "Balasan terkirim"); })
        .catch(function () { toast("Gagal membalas"); }).then(function () { var i2 = $("ri_" + id); if (i2) i2.disabled = false; });
    };

    function reactBtns(q) {
      var r = reacts[q.id] || {}, like = q.reactions.like || 0, rep = (q.replies || []).length;
      return '<div class="actions">' +
        '<button class="act ' + (r.like ? "on like" : "") + '" onclick="__react(\'' + q.id + '\',\'like\')">👍 <b>' + like + '</b></button>' +
        '<button class="act" onclick="__toggleReply(\'' + q.id + '\')">💬 <b>' + (rep || "") + '</b> Balas</button>' +
        '</div>';
    }
    function repliesBlock(q) {
      var list = (q.replies || []).slice().sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
      var html = list.map(function (rp) {
        return '<div class="reply">' + avatarHTML(rp.name, true, rp.presenter) +
          '<div class="reply-body"><span class="cname">' + esc(rp.name || "Anonim") + '</span>' + (rp.presenter ? vcheck() : "") + ' <span class="ctime">' + ago(rp.ts) + '</span>' +
          '<div class="ctext">' + esc(rp.text) + '</div></div></div>';
      }).join("");
      var comp = openReply[q.id] ? '<div class="reply-composer"><div class="avatar sm" style="background:' + avColor($("ninput").value) + '">' + esc($("meAvatar").textContent) + '</div>' +
        '<input type="text" id="ri_' + q.id + '" maxlength="300" placeholder="Tulis balasan..." onkeydown="if(event.key===\'Enter\')__sendReply(\'' + q.id + '\')" />' +
        '<button class="btn small" onclick="__sendReply(\'' + q.id + '\')">Kirim</button></div>' : "";
      if (!html && !comp) return "";
      return '<div class="replies">' + html + comp + '</div>';
    }
    function adminBlock(q) {
      if (!admin) return "";
      if (openAnswer[q.id]) {
        return '<div class="answer-edit"><textarea id="ans_' + q.id + '" placeholder="Ketik jawaban yang akan tampil ke semua audience...">' + esc(q.answer || "") + '</textarea>' +
          '<div class="row-actions"><button class="btn small" onclick="__saveAnswer(\'' + q.id + '\')">Simpan &amp; tampilkan</button>' +
          '<button class="btn ghost small" onclick="__openAnswer(\'' + q.id + '\')">Batal</button>' +
          (q.answered ? '<button class="btn ghost small danger" onclick="__unanswer(\'' + q.id + '\')">Tandai belum</button>' : '') + '</div></div>';
      }
      return '<div class="row-actions">' +
        '<button class="act admin" onclick="__openAnswer(\'' + q.id + '\')">' + (q.answered ? "✏️ Edit jawaban" : "✍️ Jawab") + '</button>' +
        '<button class="act admin danger" onclick="__delQ(\'' + q.id + '\')">🗑️ Hapus</button></div>';
    }
    function render() {
      $("liveCount").textContent = items.length ? "(" + items.length + ")" : "";
      var list = $("list");
      if (!items.length) { list.innerHTML = '<div class="empty">Belum ada diskusi. Jadilah yang pertama! 👆</div>'; return; }

      // Simpan teks & fokus yang sedang diketik (jawaban/balasan) agar tidak hilang saat feed diperbarui live
      var focusId = document.activeElement && document.activeElement.id ? document.activeElement.id : null;
      var caret = null, drafts = {};
      var fields = list.querySelectorAll("textarea, input");
      for (var i = 0; i < fields.length; i++) { if (fields[i].id) drafts[fields[i].id] = fields[i].value; }
      if (focusId && document.activeElement.selectionStart != null) caret = document.activeElement.selectionStart;

      var sorted = items.slice().sort(function (a, b) { return sortByTop ? (score(b) - score(a)) || (tsOf(b) - tsOf(a)) : (tsOf(b) - tsOf(a)); });
      list.innerHTML = sorted.map(function (q) {
        return '<div class="post"><div class="post-head"><div class="avatar" style="background:' + avColor(q.name) + '">' + esc(initial(q.name)) + '</div>' +
          '<div><span class="cname">' + esc(q.name || "Anonim") + '</span> <span class="ctime">' + ago(tsOf(q)) + '</span>' +
          (q.answered ? ' <span class="badge answered">Dijawab pemateri</span>' : "") + '</div></div>' +
          '<div class="qtext">' + esc(q.text) + '</div>' +
          (q.answered && q.answer ? '<div class="answerbox"><div class="lbl">📌 Jawaban pemateri ' + vcheck() + '</div><div class="txt">' + esc(q.answer) + '</div></div>' : "") +
          reactBtns(q) + adminBlock(q) + repliesBlock(q) + '</div>';
      }).join("");

      // Pulihkan teks & fokus
      Object.keys(drafts).forEach(function (id) { if (id.indexOf("ans_") === 0 || id.indexOf("ri_") === 0) { var el = $(id); if (el) el.value = drafts[id]; } });
      if (focusId) { var fe = $(focusId); if (fe) { fe.focus(); if (caret != null && fe.setSelectionRange) { try { fe.setSelectionRange(caret, caret); } catch (e) {} } } }
    }
    DB.subscribe(function (data) { items = data; render(); });
  }

  /* ============================================================
     HALAMAN PRESENTER
     ============================================================ */
  function initPresenter() {
    setText("subtitle", (CFG.APP_NAME || "QUERY") + (CFG.APP_EVENT ? " · " + CFG.APP_EVENT : ""));
    document.title = (CFG.APP_NAME || "QUERY") + " — Presenter";
    var items = [], filter = "all";

    function unlock() {
      if ($("pin").value !== String(CFG.PRESENTER_PIN)) { toast("PIN salah"); return; }
      $("gate").style.display = "none"; $("panel").style.display = "block";
      if (!DB.configured()) $("warn").innerHTML = '<div class="banner"><b>Mode demo</b> — Firebase belum dikonfigurasi (lihat config.js / README.md).</div>';
      render();
    }
    $("unlock").addEventListener("click", unlock);
    $("pin").addEventListener("keydown", function (e) { if (e.key === "Enter") unlock(); });
    $("filterBtn").addEventListener("click", function () {
      filter = filter === "all" ? "open" : filter === "open" ? "answered" : "all";
      $("filterBtn").textContent = "Tampil: " + ({ all: "Semua", open: "Belum dijawab", answered: "Sudah dijawab" }[filter]); render();
    });
    $("projBtn").addEventListener("click", function () { document.body.classList.toggle("projector"); });

    window.__save = function (id) { var ta = $("a_" + id); DB.answer(id, ta.value.trim(), true).then(function () { toast("Jawaban disimpan ✓"); }).catch(function () { toast("Gagal menyimpan"); }); };
    window.__toggle = function (id, answered) { var ta = $("a_" + id); DB.answer(id, ta ? ta.value.trim() : "", !answered).catch(function () { toast("Gagal"); }); };
    window.__del = function (id) { if (!confirm("Hapus pertanyaan ini beserta balasannya?")) return; DB.remove(id).then(function () { toast("Dihapus"); }).catch(function () { toast("Gagal hapus"); }); };

    function repliesBlock(q) {
      var list = (q.replies || []).slice().sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
      if (!list.length) return "";
      return '<div class="replies">' + list.map(function (rp) {
        return '<div class="reply">' + avatarHTML(rp.name, true, rp.presenter) +
          '<div class="reply-body"><span class="cname">' + esc(rp.name || "Anonim") + '</span>' + (rp.presenter ? vcheck() : "") + '<div class="ctext">' + esc(rp.text) + '</div></div></div>';
      }).join("") + '</div>';
    }
    function render() {
      var total = items.length, totReact = 0, totReply = 0, ans = 0;
      items.forEach(function (q) { totReact += reactCount(q); totReply += (q.replies || []).length; if (q.answered) ans++; });
      $("sTotal").textContent = total; $("sReact").textContent = totReact; $("sReply").textContent = totReply; $("sOpen").textContent = total - ans;

      var view = items.slice().sort(function (a, b) { return (score(b) - score(a)) || (tsOf(a) - tsOf(b)); });
      if (filter === "open") view = view.filter(function (q) { return !q.answered; });
      if (filter === "answered") view = view.filter(function (q) { return q.answered; });

      var list = $("list");
      if (!view.length) { list.innerHTML = '<div class="empty">Tidak ada pertanyaan.</div>'; return; }
      list.innerHTML = view.map(function (q) {
        return '<div class="post"><div class="post-head"><div class="avatar" style="background:' + avColor(q.name) + '">' + esc(initial(q.name)) + '</div>' +
          '<div><span class="cname">' + esc(q.name || "Anonim") + '</span> <span class="badge ' + (q.answered ? "answered" : "new") + '">' + (q.answered ? "Dijawab" : "Baru") + '</span>' +
          '<div class="ctime">👍 ' + (q.reactions.like || 0) + ' &nbsp; ❤️ ' + (q.reactions.love || 0) + ' &nbsp; 💬 ' + (q.replies || []).length + '</div></div></div>' +
          '<div class="qtext">' + esc(q.text) + '</div>' + repliesBlock(q) +
          '<label class="lbl-field">Jawaban (tampil ke audience saat disimpan)</label>' +
          '<textarea id="a_' + q.id + '" placeholder="Ketik jawaban...">' + esc(q.answer || "") + '</textarea>' +
          '<div class="row-actions">' +
          '<button class="btn small" onclick="__save(\'' + q.id + '\')">Simpan &amp; Tandai Dijawab</button>' +
          '<button class="btn ghost small" onclick="__toggle(\'' + q.id + '\',' + q.answered + ')">' + (q.answered ? "Tandai belum" : "Tandai dijawab") + '</button>' +
          '<button class="btn ghost small danger" onclick="__del(\'' + q.id + '\')">Hapus</button></div></div>';
      }).join("");
    }
    $("exportBtn").addEventListener("click", function () {
      var rows = [["No", "Pertanyaan", "Nama", "Like", "Love", "Jml Balasan", "Status", "Jawaban", "Balasan"]];
      items.slice().sort(function (a, b) { return score(b) - score(a); }).forEach(function (q, i) {
        var reps = (q.replies || []).map(function (r) { return (r.name || "Anonim") + ": " + r.text; }).join(" | ");
        rows.push([i + 1, q.text, q.name || "Anonim", q.reactions.like || 0, q.reactions.love || 0, (q.replies || []).length, q.answered ? "Dijawab" : "Belum", q.answer || "", reps]);
      });
      var csv = "﻿" + rows.map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(","); }).join("\r\n");
      var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "notulen-qna-chcd.csv"; a.click(); URL.revokeObjectURL(a.href);
    });
    DB.subscribe(function (data) { items = data; if ($("panel").style.display !== "none") render(); });
  }

  window.App = { initAudience: initAudience, initPresenter: initPresenter };
})();
