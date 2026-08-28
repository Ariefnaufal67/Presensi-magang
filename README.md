# Presensi — Absensi Peserta Magang Berbasis QR Code

## Tentang Proyek

Presensi adalah aplikasi web untuk mencatat kehadiran peserta magang
menggunakan kartu QR code pribadi, menggantikan absensi manual (tanda
tangan kertas atau grup chat) yang rawan dititip atau tidak akurat
waktunya.

Setiap peserta magang punya **kartu QR permanen** yang dibuat sekali oleh
admin. Saat datang atau pulang, peserta cukup menunjukkan kartu QR
tersebut ke kamera di satu layar **kiosk** yang dioperasikan admin —
sistem otomatis mendeteksi apakah itu absen masuk atau pulang.

Versi ini memakai **database asli (MongoDB Atlas)**, bukan lagi file
sementara — data tidak akan hilang saat cold start atau redeploy seperti
versi prototipe sebelumnya.

## Fitur Utama

- Login terpisah untuk admin (username & password) dan peserta (NIM/ID).
- **Multi-admin** — bisa ada lebih dari satu akun admin, masing-masing bisa
  login sendiri, ganti password sendiri, dan tambah/hapus akun admin lain
  (minimal harus ada 1 admin tersisa, tidak bisa dihapus semua).
- **QR ditampilkan di layar admin** (bukan lagi QR pribadi per peserta) —
  kode berganti otomatis tiap ~20 detik supaya tidak bisa discreenshot dan
  dipakai ulang dari jarak jauh.
- **Verifikasi lokasi GPS (geofencing)** — peserta scan dari HP mereka
  sendiri, browser meminta izin lokasi, dan server menolak absen kalau
  peserta berada di luar radius yang ditentukan dari titik kantor (default
  50 meter, bisa diubah admin). Ada juga pengecekan akurasi sinyal GPS
  supaya lokasi yang terlalu tidak presisi tidak diterima begitu saja.
- Kiosk scan otomatis — scan pertama di hari itu = masuk, scan berikutnya = pulang.
- Jam masuk & toleransi keterlambatan yang bisa diatur admin, dipakai
  untuk menandai status "Tepat waktu" / "Terlambat" secara otomatis
  (dihitung memakai zona waktu Jakarta/WIB, bukan zona waktu server).
- Tandai pulang manual oleh admin (kalau peserta lupa scan).
- Riwayat kehadiran per peserta (jam masuk, status, jam pulang, per hari).
- **Pengajuan izin/sakit/cuti** oleh peserta (dengan lampiran bukti foto
  opsional), dengan approval/penolakan oleh admin. Kalau izin sudah
  disetujui tapi peserta ternyata tetap datang dan scan, catatan izin
  otomatis ditimpa jadi absen masuk asli.
- **Statistik & leaderboard kehadiran** — ringkasan harian, persentase
  tepat waktu, dan peringkat per peserta untuk periode 7–60 hari terakhir.
- **Password admin disimpan ter-hash (bcrypt)**, tidak dalam bentuk teks biasa.

### Catatan soal geofencing & fake GPS

Verifikasi lokasi ini menaikkan usaha yang dibutuhkan untuk curang, tapi
**bukan jaminan 100% anti-spoof** — aplikasi "fake GPS" di Android/iOS bisa
membohongi API lokasi browser sepenuhnya, dan ini secara teknis tidak bisa
dideteksi sempurna dari sisi web tanpa aplikasi native yang punya akses ke
pengecekan integritas sistem operasi (di luar cakupan proyek ini). Kombinasi
QR yang berganti tiap 20 detik + jarak GPS + ambang akurasi sinyal membuat
kombinasi kecurangan jauh lebih sulit dan meninggalkan jejak (lat/lng/akurasi
tersimpan di setiap entri kehadiran) untuk ditelusuri manual kalau dicurigai.

## Struktur proyek

```
public/index.html       halaman aplikasi (login, kartu peserta, kiosk admin)
server.js                entry point Express — semua route API + static file server + jadwal cron
lib/db.js                 koneksi MongoDB (dengan connection caching)
lib/store.js              semua query database (roster, settings, admin,
                           absensi, izin, statistik)
data/seed.json             data awal — dipakai SEKALI saat database masih kosong
.env.example               contoh environment variable untuk lokal
```

Koleksi MongoDB yang dipakai: `roster`, `settings`, `admins`, `attendance`, `izin`, `session`.

## Setup database (MongoDB Atlas — gratis)

1. Buat akun di [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas/register) (gratis, tidak perlu kartu kredit).
2. Buat cluster baru, pilih tier **M0 Free**.
3. Di menu **Database Access**, buat database user (username & password) —
   catat kredensialnya.
4. Di menu **Network Access**, klik **Add IP Address** → pilih
   **Allow Access from Anywhere** (`0.0.0.0/0`). Ini perlu karena Render
   (atau host lain) bisa memakai IP yang berubah-ubah.
5. Di halaman cluster, klik **Connect** → **Drivers** → salin
   *connection string*-nya, bentuknya seperti:
   ```
   mongodb+srv://USERNAME:PASSWORD@CLUSTER.mongodb.net/?retryWrites=true&w=majority
   ```
6. Ganti `USERNAME` dan `PASSWORD` dengan kredensial dari langkah 3.

## Deploy ke Render

1. Push folder ini ke repo GitHub.
2. Di [dashboard.render.com](https://dashboard.render.com) → **New** → **Web Service** → connect ke repo tersebut.
3. Isi konfigurasi:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. Di tab **Environment**, tambahkan environment variable:
   - `MONGODB_URI` = connection string dari langkah setup database di atas
   - `MONGODB_DB` = `presensi_magang` (opsional, ini juga defaultnya)
5. Klik **Deploy**.

Database & koleksinya akan **terisi otomatis** dari `data/seed.json` saat
pertama kali ada request masuk ke aplikasi (tidak perlu import manual).

Server ini adalah proses Node.js **persisten** (bukan serverless) — jadwal
"Pulang Otomatis" dijalankan langsung di dalam proses lewat `node-cron`
(lihat `server.js`), dicek presisi tiap menit sesuai zona waktu Jakarta,
tidak lagi bergantung pada layanan cron eksternal.

**Catatan tier gratis Render**: web service gratis akan "tidur" setelah
~15 menit tidak ada trafik, dan bangun lagi (cold start ~30–60 detik) saat
ada request baru. Ini juga memengaruhi jadwal pulang otomatis — kalau
server sedang tidur pas jam yang dijadwalkan, jadwalnya baru kecek begitu
server bangun lagi. Kalau butuh presisi mutlak tanpa tidur, pertimbangkan
upgrade ke paket berbayar Render, atau pakai VPS yang menyala 24/7.

## Login default

- **Admin**: `admin` / `admin123` — **segera ganti** lewat menu "Akun Admin"
  di kiosk setelah login pertama (password akan otomatis di-hash ulang).
- **Peserta**: login pakai NIM (atau ID kartu, mis. `PST-1001`) sesuai data
  di `data/seed.json`, atau yang ditambahkan admin lewat menu "Kelola Peserta".

## Menjalankan secara lokal (opsional)

```bash
cp .env.example .env
# isi MONGODB_URI di .env dengan connection string kamu

npm install
npm start
```

Server akan jalan di `http://localhost:3000` (atau port lain lewat
environment variable `PORT`).

## Catatan keamanan & pengembangan lanjutan

- Password admin sudah di-hash pakai `bcryptjs` — bukan disimpan sebagai
  teks biasa di database.
- Belum ada rate-limiting di endpoint login — untuk produksi dengan
  trafik publik, pertimbangkan menambah pembatasan percobaan login.
- Sesi login (admin & peserta) disimpan di `localStorage` browser supaya
  bertahan setelah refresh halaman — bukan sesi server dengan token/JWT
  sungguhan. Cukup untuk kebutuhan kiosk internship, tapi bukan tingkat
  keamanan produksi publik.
- Index unik `{pesertaId, tanggal}` di koleksi `attendance` mencegah satu
  peserta punya lebih dari satu entri absen di hari yang sama, meski ada
  banyak scan bersamaan.

