# Dokumentasi schemapar

[English](../README.md) | **Bahasa Indonesia**

`schemapar` mengompilasi satu schema JSON menjadi validator TypeScript, Python, dan Go, lalu membuktikan validator hasil generate berperilaku identik.

| Dokumen | Baca saat Anda ingin… |
| --- | --- |
| [Memulai](getting-started.md) | Install tool, compile validator pertama, menjalankan parity, integrasi CI |
| [Referensi schema](schema-reference.md) | Mencari tipe node, field, constraint, format, atau aturan regex |
| [Pengujian parity](parity.md) | Memahami pembentukan corpus, aturan perbandingan, dan laporan mismatch |
| [Arsitektur](architecture.md) | Memahami hubungan compiler, generator, dan parity engine |

File lain yang berguna:

- [README utama](../../README.id.md) — ringkasan proyek dan quick start.
- [Contoh](../../examples/README.id.md) — schema dan validator hasil generate yang di-commit.
- [Kontribusi](../../CONTRIBUTING.id.md) — development lokal dan panduan perubahan.
- [Changelog](../../CHANGELOG.id.md) — riwayat rilis.
- [Dokumentasi Inggris](../README.md).

## Model mental

```text
schema.json ──► schemapar compile --target ts ──► validator.ts
            ├─► schemapar compile --target py ──► validator.py
            ├─► schemapar compile --target go ──► validator.go
            └─► schemapar parity ──────────────► output terminal + exit code
```

- **Compile** mengubah aturan menjadi file source mandiri.
- **Parity** menghasilkan corpus, menjalankan setiap validator pada input yang sama, dan membandingkan seluruh daftar error.
- `schemapar` adalah tool build-time. Validator hasil generate tidak bergantung padanya saat runtime.
