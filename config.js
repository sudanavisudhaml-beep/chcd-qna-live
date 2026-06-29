// ============================================================
//  KONFIGURASI APLIKASI Q&A LIVE — CHCD
//  Ini SATU-SATUNYA file yang perlu Anda edit.
// ============================================================
//
//  CARA ISI (lengkap di README.md):
//  1. https://console.firebase.google.com -> Add project (mis. "chcd-qna")
//  2. Build -> Firestore Database -> Create database -> "Start in test mode"
//     -> lokasi asia-southeast2 (Jakarta)
//  3. Project settings (gerigi) -> Your apps -> ikon </> (Web) -> daftarkan
//     -> SALIN isi firebaseConfig, tempel menggantikan nilai di bawah.
//
//  Sebelum diisi, app tetap jalan dalam MODE DEMO (data contoh) supaya
//  Anda bisa lihat tampilannya dulu.
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

  // PIN untuk membuka Panel Presenter (presenter.html). Ganti dengan rahasia Anda.
  PRESENTER_PIN: "1234",

  // Teks header aplikasi.
  APP_TITLE: "Q&A Live — Juklak Pengadaan Barang & Jasa",
  APP_SUBTITLE: "Corporate Human Capital Development (CHCD)",
};
