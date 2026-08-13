# Presensi — Absensi Magang Berbasis QR (Prototipe)

Prototipe siap deploy ke **Vercel**. Frontend statis (`/public`) + backend
serverless Node.js (`/api`).

## Cara deploy ke Vercel

**Opsi 1 — lewat CLI**
```bash
npm i -g vercel
cd presensi-magang
vercel
```
Ikuti prompt-nya (login Vercel, pilih scope, project baru). Setelah selesai,
`vercel --prod` untuk deploy ke production URL.

**Opsi 2 — lewat dashboard Vercel**
1. Push folder ini ke repo GitHub/GitLab/Bitbucket.
2. Di [vercel.com](https://vercel.com) → **Add New Project** → import repo tersebut.
3. Biarkan pengaturan default (Vercel otomatis mendeteksi `/api` sebagai
   Serverless Functions dan `/public` sebagai static hosting). Klik **Deploy**.

Tidak perlu build step — tidak ada framework, semua vanilla Node.js + HTML.

## Struktur proyek

```
public/index.html     halaman aplikasi (login, kartu peserta, kiosk admin)
api/login.js           login admin (username/password) & peserta (NIM)
api/roster.js          GET/POST/DELETE data peserta magang
api/settings.js        GET/POST jam masuk & toleransi keterlambatan
api/credentials.js     POST ganti username/password admin
api/scan.js            proses hasil scan QR -> catat masuk/pulang + status
api/mark-pulang.js     admin menandai pulang manual (tanpa scan)
api/today.js           log kehadiran hari ini (untuk dashboard kiosk)
api/history.js         riwayat kehadiran per peserta (untuk halaman peserta)
lib/store.js           helper baca/tulis data (lihat catatan di bawah)
data/seed.json         data awal: roster contoh, pengaturan default
```

## Login default

- **Admin**: `admin` / `admin123` — ganti lewat menu "Akun Admin" di kiosk
  setelah login pertama.
- **Peserta**: login pakai NIM (atau ID kartu, mis. `PST-1001`) sesuai data
  di `data/seed.json`, atau yang ditambahkan admin lewat menu "Kelola Peserta".

## ⚠️ Catatan penting soal penyimpanan data

`lib/store.js` menyimpan data di **file JSON di folder `/tmp`**, satu-satunya
lokasi yang bisa ditulis di lingkungan serverless Vercel. Ini cukup untuk
demo/prototipe, tapi:

- Data **bisa hilang atau ter-reset** saat terjadi cold start baru atau
  deploy ulang, karena `/tmp` tidak permanen antar-eksekusi function.
- Untuk beberapa pengguna yang mengakses bersamaan dalam waktu berdekatan,
  datanya kemungkinan tetap konsisten (satu instance function tetap "warm"),
  tapi ini **tidak dijamin** di skala produksi.

**Untuk versi produksi sungguhan**, ganti `lib/store.js` agar membaca/menulis
ke database asli, misalnya:
- [Vercel Postgres](https://vercel.com/docs/storage/vercel-postgres)
- [Vercel KV](https://vercel.com/docs/storage/vercel-kv) (Redis)
- Supabase / PlanetScale / MongoDB Atlas, dll.

Struktur data (`roster`, `settings`, `logs`) sudah dipisah rapi per fungsi,
jadi migrasi ke database nantinya cukup mengganti isi `getDB()`/`saveDB()`
tanpa mengubah kode di `/api/*.js`.

## Menjalankan secara lokal (opsional)

```bash
npm i -g vercel
cd presensi-magang
vercel dev
```
Ini menjalankan frontend + serverless functions sekaligus di `localhost`,
sama seperti lingkungan Vercel yang sebenarnya.
