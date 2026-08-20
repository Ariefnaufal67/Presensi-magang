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
- Kartu QR pribadi per peserta, dikelola sepenuhnya oleh admin.
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
- **Presensi mandiri berbasis lokasi** — selain discan admin di kiosk, peserta
  bisa login sendiri lewat HP, memindai kode QR yang tertampil di layar
  kiosk (menu admin "QR Presensi Mandiri"), lalu presensi hanya tercatat
  kalau HP-nya berada dalam radius yang ditentukan (default 50m) dari
  koordinat lokasi magang yang diatur admin, dan sinyal GPS-nya cukup
  akurat (ditolak kalau akurasi lebih kasar dari ~100m).

## Struktur proyek

```
public/index.html       halaman aplikasi (login, kartu peserta, kiosk admin)
api/[...route].js        satu serverless function untuk semua endpoint API
lib/db.js                 koneksi MongoDB (dengan connection caching)
lib/store.js              semua query database (roster, settings, admin,
                           absensi, izin, statistik)
data/seed.json             data awal — dipakai SEKALI saat database masih kosong
.env.example               contoh environment variable untuk lokal
```

Koleksi MongoDB yang dipakai: `roster`, `settings`, `admins`, `attendance`, `izin`.

## Setup database (MongoDB Atlas — gratis)

1. Buat akun di [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas/register) (gratis, tidak perlu kartu kredit).
2. Buat cluster baru, pilih tier **M0 Free**.
3. Di menu **Database Access**, buat database user (username & password) —
   catat kredensialnya.
4. Di menu **Network Access**, klik **Add IP Address** → pilih
   **Allow Access from Anywhere** (`0.0.0.0/0`). Ini perlu karena Vercel
   memakai IP dinamis untuk serverless function.
5. Di halaman cluster, klik **Connect** → **Drivers** → salin
   *connection string*-nya, bentuknya seperti:
   ```
   mongodb+srv://USERNAME:PASSWORD@CLUSTER.mongodb.net/?retryWrites=true&w=majority
   ```
6. Ganti `USERNAME` dan `PASSWORD` dengan kredensial dari langkah 3.

## Setup environment variable di Vercel

1. Buka project di dashboard Vercel → **Settings** → **Environment Variables**.
2. Tambahkan:
   - `MONGODB_URI` = connection string dari langkah di atas
   - `MONGODB_DB` = `presensi_magang` (opsional, ini juga defaultnya)
3. Redeploy project (Vercel akan otomatis redeploy kalau kamu push commit
   baru, atau klik **Redeploy** manual di dashboard).

Database & koleksinya akan **terisi otomatis** dari `data/seed.json` saat
pertama kali ada request masuk ke aplikasi (tidak perlu import manual).

## Cara deploy ke Vercel

**Opsi 1 — lewat CLI**
```bash
npm i -g vercel
cd presensi-magang
vercel
```

**Opsi 2 — lewat dashboard Vercel**
1. Push folder ini ke repo GitHub/GitLab/Bitbucket.
2. Di [vercel.com](https://vercel.com) → **Add New Project** → import repo tersebut.
3. Isi environment variable `MONGODB_URI` (lihat bagian di atas) sebelum
   klik **Deploy**, atau tambahkan sesudahnya lalu redeploy.

Vercel otomatis menjalankan `npm install` untuk memasang dependency
(`mongodb`, `bcryptjs`) — tidak perlu langkah build tambahan.

## Login default

- **Admin**: `admin` / `admin123` — **segera ganti** lewat menu "Akun Admin"
  di kiosk setelah login pertama (password akan otomatis di-hash ulang).
- **Peserta**: login pakai NIM (atau ID kartu, mis. `PST-1001`) sesuai data
  di `data/seed.json`, atau yang ditambahkan admin lewat menu "Kelola Peserta".

## Menjalankan secara lokal (opsional)

```bash
cp .env.example .env
# isi MONGODB_URI di .env dengan connection string kamu

npm i -g vercel
npm install
vercel dev
```

## Catatan keamanan & pengembangan lanjutan

- Password admin sudah di-hash pakai `bcryptjs` — bukan disimpan sebagai
  teks biasa di database.
- Belum ada rate-limiting di endpoint login — untuk produksi dengan
  trafik publik, pertimbangkan menambah pembatasan percobaan login.
- Login belum memakai sesi/token (JWT) — status login hanya disimpan di
  memori browser (JS), jadi refresh halaman = perlu login ulang. Kalau
  perlu sesi yang bertahan setelah refresh, bisa ditambahkan
  `httpOnly` cookie + token nanti.
- Index unik `{pesertaId, tanggal}` di koleksi `attendance` mencegah satu
  peserta punya lebih dari satu entri absen di hari yang sama, meski ada
  banyak scan bersamaan.
- **Batas presensi mandiri**: browser tidak punya cara resmi mendeteksi
  aplikasi fake-GPS/mock-location — validasi jarak + akurasi GPS di sini
  mempersulit, bukan menjamin 100% mustahil, dipalsukan. Kombinasikan
  dengan kode QR kiosk (harus lihat layar kiosk langsung) dan "Buat ulang
  kode" berkala kalau curiga ada kode yang bocor.
