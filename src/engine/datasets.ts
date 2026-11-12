import { Database } from "./database";
export type Dataset = "sekolah" | "kedai" | "edagang";
const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;
export const datasetNames: Record<Dataset, string> = {
  sekolah: "Sekolah",
  kedai: "Kedai Runcit",
  edagang: "E-Dagang",
};
export const examples: Record<Dataset, string> = {
  sekolah: `-- Prestasi pelajar mengikut kursus\nSELECT\n  k.nama AS kursus,\n  COUNT(p.id) AS pelajar,\n  ROUND(AVG(p.markah), 1) AS purata_markah,\n  MAX(p.markah) AS markah_tertinggi\nFROM kursus k\nLEFT JOIN pendaftaran p ON k.id = p.kursus_id\nGROUP BY k.id, k.nama\nORDER BY purata_markah DESC;`,
  kedai: `-- Nilai stok mengikut kategori\nSELECT kategori,\n  COUNT(*) AS produk,\n  SUM(stok) AS jumlah_stok,\n  ROUND(SUM(harga * stok), 2) AS nilai_stok\nFROM produk\nGROUP BY kategori\nORDER BY nilai_stok DESC;`,
  edagang: `-- Ringkasan jualan mengikut status\nSELECT status,\n  COUNT(*) AS pesanan,\n  ROUND(SUM(jumlah), 2) AS jumlah_jualan\nFROM pesanan\nGROUP BY status\nORDER BY jumlah_jualan DESC;`,
};
export function createDataset(name: Dataset): Database {
  const db = new Database();
  if (name === "sekolah") {
    db.execute(
      `CREATE TABLE pensyarah (id INTEGER PRIMARY KEY, nama TEXT NOT NULL, jabatan TEXT); CREATE TABLE kursus (id INTEGER PRIMARY KEY, nama TEXT NOT NULL, kod TEXT UNIQUE, pensyarah_id INTEGER REFERENCES pensyarah(id)); CREATE TABLE pelajar (id INTEGER PRIMARY KEY, nama TEXT NOT NULL, emel TEXT UNIQUE, semester INTEGER DEFAULT 1, aktif BOOLEAN DEFAULT TRUE); CREATE TABLE pendaftaran (id INTEGER PRIMARY KEY, pelajar_id INTEGER REFERENCES pelajar(id), kursus_id INTEGER REFERENCES kursus(id), markah INTEGER, tarikh TEXT);`,
    );
    const teachers = [
      "Dr. Nur Aisyah",
      "Dr. Farid Hassan",
      "Dr. Mei Ling",
      "Dr. Arjun Kumar",
      "Dr. Siti Aminah",
      "Dr. Hakim Zain",
    ];
    db.execute(
      `INSERT INTO pensyarah VALUES ${teachers.map((t, i) => `(${i + 1},${quote(t)},${quote(i % 2 ? "Kejuruteraan" : "Sains Komputer")})`).join(",")};`,
    );
    const courses = [
      "Pangkalan Data",
      "Pengaturcaraan Web",
      "Struktur Data",
      "Kecerdasan Buatan",
      "Rangkaian Komputer",
      "Sistem Pengendalian",
      "Matematik Diskret",
      "Kejuruteraan Perisian",
    ];
    db.execute(
      `INSERT INTO kursus VALUES ${courses.map((c, i) => `(${i + 1},${quote(c)},'CS${201 + i}',${(i % 6) + 1})`).join(",")};`,
    );
    const names = [
      "Aina Sofea",
      "Muhammad Danish",
      "Tan Mei Xin",
      "Arjun Raj",
      "Nur Iman",
      "Siti Hajar",
      "Lim Wei Han",
      "Ahmad Hakimi",
      "Priya Devi",
      "Farah Nabila",
      "Amirul Hakim",
      "Chong Kai Wen",
    ];
    db.execute(
      `INSERT INTO pelajar VALUES ${Array.from({ length: 120 }, (_, i) => `(${i + 1},${quote(names[i % 12] + (i >= 12 ? " " + (Math.floor(i / 12) + 1) : ""))},'pelajar${i + 1}@vela.edu.my',${(i % 6) + 1},${i % 11 !== 0 ? "TRUE" : "FALSE"})`).join(",")};`,
    );
    db.execute(
      `INSERT INTO pendaftaran VALUES ${Array.from({ length: 240 }, (_, i) => `(${i + 1},${(i % 120) + 1},${((i * 3 + Math.floor(i / 120)) % 8) + 1},${i % 19 === 0 ? "NULL" : 55 + ((i * 17) % 46)},'2026-09-${String((i % 28) + 1).padStart(2, "0")}')`).join(",")}; CREATE INDEX idx_pendaftaran_kursus ON pendaftaran(kursus_id);`,
    );
  } else if (name === "kedai") {
    db.execute(
      "CREATE TABLE produk (id INTEGER PRIMARY KEY, nama TEXT NOT NULL, kategori TEXT, harga REAL NOT NULL, stok INTEGER DEFAULT 0); CREATE TABLE pembekal (id INTEGER PRIMARY KEY, nama TEXT, bandar TEXT)",
    );
    const items = [
      "Beras wangi",
      "Susu segar",
      "Roti gandum",
      "Kopi tempatan",
      "Minyak masak",
      "Epal hijau",
      "Sabun tangan",
      "Teh hijau",
    ];
    db.execute(
      `INSERT INTO produk VALUES ${Array.from({ length: 48 }, (_, i) => `(${i + 1},${quote(items[i % 8] + " " + (Math.floor(i / 8) + 1))},${quote(["Makanan", "Minuman", "Keperluan"][i % 3])},${(2.5 + i * 1.7).toFixed(2)},${10 + ((i * 13) % 90)})`).join(",")}; INSERT INTO pembekal VALUES (1,'Maju Jaya','Shah Alam'),(2,'Segar Harian','Ipoh'),(3,'Sumber Kita','Kuala Lumpur')`,
    );
  } else {
    db.execute(
      "CREATE TABLE pelanggan (id INTEGER PRIMARY KEY, nama TEXT, bandar TEXT); CREATE TABLE pesanan (id INTEGER PRIMARY KEY, pelanggan_id INTEGER REFERENCES pelanggan(id), status TEXT, jumlah REAL, tarikh TEXT)",
    );
    db.execute(
      `INSERT INTO pelanggan VALUES ${Array.from({ length: 24 }, (_, i) => `(${i + 1},'Pelanggan ${i + 1}',${quote(["Kuala Lumpur", "Johor Bahru", "Kuching", "George Town"][i % 4])})`).join(",")}`,
    );
    db.execute(
      `INSERT INTO pesanan VALUES ${Array.from({ length: 96 }, (_, i) => `(${i + 1},${(i % 24) + 1},${quote(["Selesai", "Dihantar", "Diproses", "Dibatalkan"][i % 4])},${(24.9 + i * 7.3).toFixed(2)},'2026-11-${String((i % 9) + 1).padStart(2, "0")}')`).join(",")}`,
    );
  }
  return db;
}
export function generatedTable(count: number) {
  if (![10000, 100000, 500000].includes(count))
    throw new Error("Saiz penjana tidak sah.");
  const db = new Database();
  db.execute(
    "CREATE TABLE data_janaan (id INTEGER PRIMARY KEY, nama TEXT, kategori INTEGER, nilai REAL, aktif BOOLEAN)",
  );
  const state = db.export();
  state.tables[0].rows = Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    nama: `Rekod ${i + 1}`,
    kategori: i % 100,
    nilai: Math.round(((i * 13.37) % 10000) * 100) / 100,
    aktif: i % 3 !== 0,
  }));
  return state.tables[0];
}
