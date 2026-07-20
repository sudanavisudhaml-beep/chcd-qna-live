// ============================================================
//  QUERY — Suara Insan Astra  |  KONFIGURASI
//  Ini SATU-SATUNYA file yang perlu Anda edit.
//  Untuk event berikutnya, cukup ganti APP_EVENT (& Firebase bila perlu).
// ============================================================
//
//  SETUP FIREBASE (lengkap di README.md):
//  1. https://console.firebase.google.com -> Add project
//  2. Build -> Firestore Database -> Create database -> "Start in test mode"
//  3. Project settings (gerigi) -> Your apps -> ikon </> (Web)
//     -> SALIN isi firebaseConfig, tempel menggantikan nilai di bawah.
//
//  Sebelum diisi, app jalan dalam MODE DEMO (data contoh).
// ============================================================

window.APP = {
  // ---------- VERSI APLIKASI ----------
  // Ditampilkan di footer & layar live. Riwayat lengkap tiap versi ada di CHANGELOG.md,
  // dan tiap versi ditandai git tag (mis. v2.1) → bisa dikembalikan persis kapan saja.
  APP_VERSION: "2.6",

  firebaseConfig: {
    apiKey: "AIzaSyADeuHLNMAs6DoeCMUClXQ77Hc8fs0IGac",
    authDomain: "query-chcd.firebaseapp.com",
    projectId: "query-chcd",
    storageBucket: "query-chcd.firebasestorage.app",
    messagingSenderId: "224504788",
    appId: "1:224504788:web:369b7f9c739679ed37c441",
  },

  // PIN untuk membuka Mode Presenter (menjawab langsung di halaman). Ganti dengan rahasia Anda.
  PRESENTER_PIN: "1234",

  // ---------- BRANDING JUDUL (ganti sesuai event) ----------
  APP_NAME: "QUERY",                              // nama aplikasi (fallback bila logo gambar tak ada)
  APP_TAGLINE: "Malu Bertanya, Sesat di Jalan",   // tagline
  APP_EVENT: "Kopdar CHCD",                        // nama event / forum
  APP_MATERI: "Sosialisasi Juklak Pengadaan Barang dan Jasa CHCD", // judul materi
};
