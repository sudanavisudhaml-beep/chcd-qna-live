# Q&A Live — Juklak Pengadaan Barang & Jasa (CHCD)

Mini aplikasi untuk menampung pertanyaan audience secara **live** saat presentasi.
Tampilannya seperti **kolom komentar YouTube/Instagram**: audience **scan QR → kirim pertanyaan**, lalu bisa **👍 Like, ❤️ Love, dan 💬 Balas** (komentar berbalas). Pemateri menjawab dari **Panel Presenter**, lalu **export notulen**.

- **Tanpa install apa pun** (HTML murni + Firebase CDN)
- **Gratis** (GitHub Pages + Firebase free tier)
- **Real-time** — pertanyaan, reaksi, balasan & jawaban muncul instan tanpa refresh
- **Mode demo** — sebelum Firebase diisi, app jalan dengan data contoh & tetap bisa diklik (Like/Love/Balas) supaya bisa Anda pratinjau dulu

---

## Isi folder
| File | Fungsi |
|------|--------|
| `index.html` | Halaman **audience** (tujuan QR): kirim pertanyaan + Like/Love/Balas |
| `presenter.html` | **Panel presenter** (PIN): lihat live, jawab, tandai, export |
| `config.js` | **Satu-satunya file yang Anda edit** — kunci Firebase + PIN + judul |
| `app.js` | Logika aplikasi (tidak perlu disentuh) |

> Tampilan (CSS) sudah menyatu di dalam `index.html`/`presenter.html`, jadi pasti tampil rapi walau file dibuka langsung.

---

## SETUP — 3 langkah (± 10 menit)

### 1) Buat database gratis (Firebase)
1. Buka https://console.firebase.google.com → **Add project** → beri nama (mis. `chcd-qna`) → Continue (Analytics boleh dimatikan).
2. Menu kiri **Build → Firestore Database → Create database**.
   - **Start in test mode** (cocok untuk acara; lihat catatan keamanan di bawah).
   - Lokasi: **asia-southeast1** atau **asia-southeast2 (Jakarta)**.
3. Klik gerigi **Project settings** → bagian **Your apps** → ikon **`</>`** (Web) → daftarkan app → **salin object `firebaseConfig`**.
4. Buka **`config.js`**, tempel nilainya, ganti juga **`PRESENTER_PIN`** dengan PIN rahasia Anda.

### 2) Publish ke GitHub Pages
1. Buat repo baru di GitHub (mis. `chcd-qna-live`) → upload semua file folder ini (drag-and-drop di web GitHub juga bisa).
2. Repo → **Settings → Pages** → Source: **Deploy from a branch** → Branch: **main** / folder **/(root)** → Save.
3. Tunggu ±1 menit. URL Anda: `https://USERNAME.github.io/chcd-qna-live/`
   - Halaman audience: `…/index.html`
   - Panel presenter: `…/presenter.html`

### 3) Buat QR Code
Arahkan QR ke URL **index.html**. Cara cepat & gratis:
- https://www.qr-code-generator.com atau https://goqr.me → tempel URL → unduh PNG → taruh di slide pertama & terakhir.

---

## Cara pakai saat presentasi

**Semua terjadi di satu halaman (`index.html`):** audience kirim pertanyaan → langsung tampil di feed → semua bisa Like/Love/Balas → **Anda (presenter) menjawab langsung di feed yang sama**.

1. **Slide pembuka**: tampilkan QR + URL `index.html`. Audience scan & kirim pertanyaan kapan saja — pertanyaan langsung muncul di feed untuk semua orang.
2. **Anda jadi presenter**: di halaman yang sama, klik tombol **🔑 Presenter** (pojok kanan atas) → masukkan PIN. Sekarang tiap pertanyaan punya tombol **✍️ Jawab**.
3. Klik **✍️ Jawab** → ketik jawaban → **Simpan & tampilkan**. Jawaban langsung muncul ke **semua audience** dengan label *📌 Jawaban pemateri*. (Teks yang sedang diketik aman walau ada reaksi/pertanyaan baru masuk.)
4. (Opsional) Buka **`presenter.html`** untuk "ruang kontrol": statistik, **Mode Proyektor** (tampil ke layar), filter, dan **⬇ Export Notulen (CSV)** setelah sesi.

---

## Catatan keamanan (penting tapi singkat)
- **Test mode** Firestore terbuka untuk siapa saja **dan otomatis kedaluwarsa ±30 hari** — aman & praktis untuk acara sekali pakai. Untuk pemakaian jangka panjang, perketat *Rules* (mis. izinkan `create`/`read`, batasi `update/delete`).
- **PIN presenter** hanya gerbang ringan di sisi browser (mencegah audience iseng buka panel), **bukan** keamanan kuat. Cukup untuk konteks internal.
- Jangan taruh data rahasia di pertanyaan/jawaban.

---

## Pratinjau tampilan (sebelum publish)
Cukup **dobel-klik `index.html`** — app langsung tampil rapi dengan **data contoh (mode demo)** dan bisa diklik (Like/Love/Balas). Ini hanya pratinjau di perangkat Anda; **untuk Q&A live multi-orang yang tersimpan, app harus dibuka lewat URL** (GitHub Pages) setelah `config.js` diisi.

> **Penting:** dobel-klik file hanya untuk lihat tampilan. Fitur **live** (semua audience lihat pertanyaan yang sama secara real-time) baru aktif setelah di-publish ke GitHub Pages + `config.js` terisi Firebase.
