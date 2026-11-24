# Kontribusi

[English](CONTRIBUTING.md) | **Bahasa Indonesia**

Terima kasih sudah mempertimbangkan kontribusi. `schemapar` adalah compiler kecil dengan standar kebenaran yang ketat: setiap bahasa hasil generate harus berperilaku identik. Perubahan diterima selama standar itu terjaga.

## Sebelum mulai

- Untuk bug, sertakan schema, seed dan jumlah kasus, OS, serta versi Node, Python, Go, dan `schemapar`.
- Untuk tipe node, format, atau bahasa target baru, buka issue terlebih dahulu agar semantiknya disepakati sebelum codegen ditulis.
- Jangan melemahkan parity agar test lolos. Perbaiki perilakunya atau dokumentasikan batasannya.

## Setup

Kebutuhan:

- Node.js 18+
- Python 3.8+ (untuk parity)
- Go 1.21+ (opsional, untuk target Go dan parity tiga arah)

```bash
git clone https://github.com/yuwanch3/schemapar.git
cd schemapar
npm ci
npm run build
```

## Perintah

```bash
npm run typecheck   # tsc --noEmit
npm test            # self-test; kasus Go dilewati jika tidak ada toolchain
npm run build       # emit dist/
npm run dev -- check examples/user.schema.json
npm run parity -- examples/user.schema.json --seed 7 --cases 100
```

Jalankan seluruh suite sebelum membuka pull request. Jika Go terpasang, pastikan test Go benar-benar berjalan, bukan dilewati.

## Konvensi

### Kode hasil generate

- Validator hasil generate harus punya **nol dependency runtime** selain standard library tiap bahasa.
- Output harus deterministik: tanpa timestamp, identifier acak, atau format yang bergantung environment.
- Pesan error ditanam saat generate dan harus identik di semua target.
- Key dinamis (properti objek tak dikenal, key record) dikunjungi dalam urutan code point Unicode.
- Validasi mengakumulasi error; tidak berhenti di kegagalan pertama.
- Node bertipe salah melaporkan satu error bentuk dan tidak turun ke anak.

### Parsing schema

- Tolak field tak dikenal alih-alih mengabaikannya.
- Validasi batas, referensi, dan bentuk constraint saat parse.
- Jaga regex tetap di dalam subset portabel yang diberlakukan `findPatternProblem`.
- Jika suatu konstruksi tidak bisa didukung identik di ECMA-262, `re` Python, dan RE2 Go, tolak.

### Gaya TypeScript

Proyek memakai TypeScript strict dengan `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, dan `noFallthroughCasesInSwitch`. Utamakan tipe eksplisit di batas modul, data readonly, dan fungsi murni kecil. Import ESM memakai ekstensi `.js`.

## Menambah tipe node

1. Tambahkan interface dan cabang parser di `src/schema.ts`.
2. Tambahkan tipe ke `KNOWN_TYPES`, `TYPE_FIELDS`, dan union `SchemaNode`.
3. Implementasikan codegen di `src/gen-ts.ts`, `src/gen-py.ts`, dan `src/gen-go.ts`.
4. Tambahkan generation dan probe adversarial di `src/generator.ts`.
5. Tambahkan test di `test/parity.test.ts` untuk nilai valid, nilai invalid, penggunaan bersarang, dan urutan error.
6. Perbarui `docs/schema-reference.md` dan `docs/id/schema-reference.md`, lalu jika perlu `examples/user.schema.json` beserta contoh hasil generate.

## Menambah format string

1. Tambahkan source regex ke `FORMAT_PATTERNS` di `src/schema.ts`. Regex harus portabel di ketiga engine.
2. Tambahkan generator sampel dan probe adversarial di `src/generator.ts`.
3. Tambahkan test parity untuk nilai yang diterima dan ditolak.
4. Dokumentasikan format dan batasannya di `docs/schema-reference.md` dan `docs/id/schema-reference.md`.

## Menambah bahasa target

1. Buat `src/gen-<lang>.ts` dengan generator dan tipe opsi.
2. Ekspor dari `src/index.ts`.
3. Sambungkan `--target` di `src/cli.ts`.
4. Tambahkan runner di `src/parity.ts` yang berbicara protokol wire yang sama (`$missing`, `$nan`, `$inf`).
5. Tambahkan bahasa ke laporan mismatch dan baris sukses.
6. Tambahkan test compile-and-compare.
7. Perbarui README, dokumentasi, dan CI.

## Generate ulang contoh

Validator yang di-commit harus tetap sinkron dengan schema:

```bash
node dist/cli.js compile examples/user.schema.json --target ts --out examples/user.validator.ts
node dist/cli.js compile examples/user.schema.json --target py --out examples/user_validator.py
node dist/cli.js compile examples/user.schema.json --target go --out examples/user_validator.go
```

CI menghasilkan ulang dan gagal jika ada `git diff`. Commit file hasil generate bersama perubahan schema atau generator yang menyebabkannya.

## Test

`test/parity.test.ts` sengaja tanpa dependency dan memakai `node:assert/strict`. Contoh penambahan:

```ts
test('reports every failing required property', () => {
  // ...
});
```

Utamakan test tingkat perilaku daripada snapshot string. Jika test menyangkut jaminan lintas bahasa, uji semua target yang tersedia, bukan hanya TypeScript.

## Pull request

- Jaga perubahan tetap fokus dan jelaskan dampaknya terhadap parity.
- Sertakan perintah yang dijalankan dan hasilnya.
- Sebutkan apakah Go tersedia secara lokal.
- Perbarui `CHANGELOG.md` dan `CHANGELOG.id.md` di bagian `[Unreleased]` untuk perubahan yang terlihat pengguna.
- Jangan commit `node_modules`, `dist`, tarball, atau file debug.

## Melaporkan bug parity

Sertakan:

- schema (atau reproduksi minimal);
- versi `schemapar` dari `package.json` (atau commit SHA);
- perintah persisnya, seed, dan jumlah kasus;
- laporan mismatch, termasuk input dan hasil tiap bahasa;
- versi Node, Python, dan Go.

Seed yang bisa direproduksi adalah jalur tercepat menuju perbaikan.
