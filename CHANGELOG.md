# QUERY — Riwayat Versi (CHANGELOG)

Versi aktif ditampilkan di **footer** aplikasi & layar live (mis. `QUERY v2.1`).
Sumber versi: `config.js` → `APP_VERSION`.

## Cara pakai (untuk Sudana)

Cukup sebut versinya, mis. **"balik ke v1.7"** atau **"apa isi v1.9?"**.
Setiap versi di bawah punya **git tag** → kodenya tersimpan permanen dan bisa dikembalikan **persis**.

```bash
# lihat semua versi
git tag -l

# lihat isi/perubahan sebuah versi
git show v1.7 --stat

# LIHAT-LIHAT saja kode versi lama (tanpa mengubah apa pun)
git checkout v1.7        # kembali ke kondisi versi itu
git checkout main        # balik ke versi terkini

# BALIKKAN aplikasi ke versi lama (aman, tetap simpan riwayat)
git revert --no-commit v2.1..HEAD && git commit -m "Rollback ke v1.7"
git push
```

> Catatan: git menyimpan **semua** versi selamanya. Tidak ada yang hilang walau kita rollback —
> rollback pun dicatat sebagai commit baru, jadi selalu bisa maju lagi.

---

## Versi

| Versi | Tanggal | Commit | Isi |
|---|---|---|---|
| **v2.4** | 2026-07-16 | `-` | **(TERKINI)** **Logo QUERY di layar live**: kotak *frosted glass* dihapus (termasuk `backdrop-filter:blur(22px)` yang bikin logo lembut/kurang tajam); logo dijadikan **putih (knockout)** agar kontras di panel gelap — PNG aslinya biru gelap `RGB(0,60,116)`; ukuran diperbesar **56→76px** (desktop) & **30→46px** (mobile). Catatan: PNG sudah 800×304 (resolusi tinggi), jadi masalahnya bukan resolusi. |
| **v2.3** | 2026-07-16 | `-` | **Skala tipografi kuadran**: desktop → angka % di-scale up (1.5→**2.6rem**) & nama negara (1.02→**1.5rem**); badge Juara 1/2/3 sengaja dibuat **lebih kecil** dari nama negara & **selalu sebaris** (nowrap, tidak lagi turun ke bawah pada nama panjang spt "Argentina"). Mobile ikut disesuaikan. |
| **v2.2** | 2026-07-16 | `52f4394` | **Sistem versi**: `APP_VERSION` di `config.js`, badge versi tampil di footer & layar live, `CHANGELOG.md` ini, dan **git tag untuk tiap versi** → versi mana pun bisa dikembalikan persis. |
| **v2.1** | 2026-07-16 | `b5224fc` | Layar live kembali ke **kuadran 2×2 gaya Match**: baris atas Final (Spain vs Argentina), baris bawah Perebutan Juara 3 (France vs England), pembatas **VS**, bar chart diperpendek (10px). |
| **v2.0** | 2026-07-16 | `dd78653` | **Bracket/prediksi 2 duel.** France masuk lagi (4 tim). Tiap orang menebak pemenang Final **dan** pemenang Juara 3 (2 pilihan, 1 submit). Badge 🏆Juara 1 / 🥈Juara 2 / 🥉Juara 3, % dihitung per-duel. CSV berisi kedua prediksi + klasemen. Pill "World Cup Special Edition" dihapus (`9a07f12`). |
| **v1.9.1** | 2026-07-15 | `0e66ddf` | **Fix bug hitungan dobel** — `increment()` di dalam transaction bisa terhitung 2× saat retry; diganti nilai absolut dari hasil read (idempoten). |
| **v1.9** | 2026-07-15 | `bf8fdda` | **Vote berbasis identitas.** Nama/alias **wajib**; anti vote-ganda **di server** (Firestore transaction) → 1 nama = 1 suara walau ganti HP. Simpan alias+pilihan+waktu (`voterAlias`). Tombol **📥 export CSV** untuk host. Reset ikut menghapus daftar nama. |
| **v1.8** | 2026-07-15 | `bf2faab` | Kunci 1-HP-1-suara yang tahan banting: device-id via **cookie + localStorage** + catatan pemilih di server (`voters`) → tetap terkunci walau webview QR menghapus localStorage. Emblem FIFA (`worldcup.png`) responsif: desktop di bawah QR, mobile di tengah bawah; PNG transparan + outline putih tipis (`d2aec69`). |
| **v1.7** | 2026-07-15 | `a736b60` | **Leaderboard gelap gaya Polymarket** (3 tim), medali peringkat, % besar + bar warna tim, latar orb menyala, judul "World Cup Winner". Baris auto-urut (animasi FLIP), panah tren naik/turun ala saham (`d1fa978`). |
| **v1.6** | 2026-07-15 | `127a6e0` | **World Cup edition**: latar lapangan bola, badge emas Special Edition, trofi+glow untuk yang unggul, QR pindah ke panel samping. Tombol reset babak (`6e061f7`), bar persen gaya Gantt + kartu liquid-glass (`3613a4f`). |
| **v1.5** | 2026-07-15 | `725a415` | Bendera **pixel-fill** (kanvas bersih), **fit-to-screen** + top bar QUERY, suara **ting** + **confetti** + popup tiap vote, QR on-screen dengan panah animasi, 1 vote per perangkat (`0bf0040`). |
| **v1.4** | 2026-07-15 | `7332044` | **Fitur Vote lahir** — pilih tim, tampilan live kuadran, bendera membesar sesuai perolehan, builder tim, hitungan real-time (berbasis event-doc). |
| **v1.3** | 2026-07-15 | `8c35b42` | Tipe soal **Matriks** (grid baris×kolom 1–5), ranking vendor, rata-rata per sel, ekspansi CSV. Grup kolom + dropdown "Vendor Lainnya" (`fe7e79c`). |
| **v1.2** | 2026-07-15 | `6f1d900` | **Fitur Kuesioner/Survey**: builder, form gaya MS Forms, hasil live (tabel + chart + ringkasan otomatis), export CSV. |
| **v1.1** | 2026-07-02 | `6f81614` | Format teks: **bold/italic** (markdown + toolbar + Ctrl+B/I), enter/baris baru dipertahankan. |
| **v1.0** | 2026-06-30 | `4969419` | **Platform multi-host** — login/daftar host, dashboard, tiap event punya papan sendiri, join via kode/QR. (Tonggak besar) |
| **v0.4** | 2026-06-30 | `380b292` | Terhubung **Firebase** (`query-chcd`) — keluar dari mode demo, live sungguhan + QR. |
| **v0.3** | 2026-06-30 | `5620819` | **Rebrand QUERY** — judul tebal gaya Astra, tagline "Malu Bertanya, Sesat di Jalan", hero biru, favicon. |
| **v0.2** | 2026-06-29 | `134874a` | Redesign tema korporat **Astra** + bubble gaya Mentimeter, logo, kredit GA Dept. |
| **v0.1** | 2026-06-29 | `3c9e22b` | **Versi pertama** — Q&A live: kolom komentar, reaksi, balasan, presenter menjawab inline. |

---

## Aturan versi

- **Angka besar** (v1 → v2): perubahan konsep/alur (mis. single-vote → prediksi bracket).
- **Angka kecil** (v2.0 → v2.1): fitur/tata letak baru.
- **Angka ketiga** (v1.9 → v1.9.1): perbaikan bug.

Setiap kali ada perubahan berarti: naikkan `APP_VERSION` di `config.js`, tambah baris di tabel ini, lalu `git tag vX.Y`.
