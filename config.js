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
  firebaseConfig: {
    apiKey: "GANTI_DENGAN_API_KEY_ANDA",
    authDomain: "GANTI.firebaseapp.com",
    projectId: "GANTI",
    storageBucket: "GANTI.appspot.com",
    messagingSenderId: "GANTI",
    appId: "GANTI",
  },

  // PIN untuk membuka Mode Presenter (menjawab langsung di halaman). Ganti dengan rahasia Anda.
  PRESENTER_PIN: "1234",

  // ---------- BRANDING JUDUL (ganti sesuai event) ----------
  APP_NAME: "QUERY",                              // nama aplikasi (fallback bila logo gambar tak ada)
  APP_TAGLINE: "Malu Bertanya, Sesat di Jalan",   // tagline
  APP_EVENT: "Kopdar CHCD",                        // nama event / forum
  APP_MATERI: "Sosialisasi Juklak Pengadaan Barang dan Jasa CHCD", // judul materi
};
