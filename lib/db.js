// Koneksi MongoDB, di-cache supaya dipakai ulang antar-invocation
// selama serverless function masih "warm" (pola resmi yang direkomendasikan
// MongoDB & Vercel untuk lingkungan serverless — supaya tidak buka koneksi
// baru di setiap request).

const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'presensi_magang';

if (!uri) {
  // Sengaja tidak "throw" di sini supaya pesan error yang lebih ramah
  // bisa ditampilkan lewat handler API (lihat lib/store.js -> getDb()).
  console.warn(
    '[presensi] MONGODB_URI belum diset. Tambahkan environment variable ini ' +
      'di dashboard hosting kamu (mis. Render -> Environment) atau file .env lokal.'
  );
}

// Simpan promise koneksi di object global Node supaya bertahan antar-invocation
// selama container/function masih hidup (bukan supaya dibagi antar-request
// yang benar-benar berbeda function, tapi cukup untuk mengurangi overhead
// koneksi berulang pada function yang sama).
let clientPromise = global._presensiMongoClientPromise;

function getClientPromise() {
  if (!uri) {
    throw new Error(
      'MONGODB_URI belum diset. Tambahkan environment variable MONGODB_URI ' +
        '(connection string MongoDB Atlas) lalu deploy ulang.'
    );
  }
  if (!clientPromise) {
    const client = new MongoClient(uri, {
      maxPoolSize: 5
    });
    clientPromise = client.connect();
    global._presensiMongoClientPromise = clientPromise;
  }
  return clientPromise;
}

async function getDb() {
  const client = await getClientPromise();
  return client.db(dbName);
}

module.exports = { getDb };
