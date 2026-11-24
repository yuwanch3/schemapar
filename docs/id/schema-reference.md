# Referensi schema

[English](../schema-reference.md) | **Bahasa Indonesia**

Schema `schemapar` adalah dokumen JSON yang root-nya berupa **node schema**. Halaman ini mendokumentasikan setiap node, field, dan aturan yang diterima. Apa pun yang tidak tercantum di sini akan ditolak.

```json
{
  "type": "object",
  "properties": {
    "name": { "type": "string" }
  }
}
```

## Field umum

Setiap node menerima field berikut selain field khusus tipenya:

| Field | Tipe | Default | Arti |
| --- | --- | --- | --- |
| `type` | string | wajib | Tipe node, salah satu nilai di bawah |
| `optional` | boolean | `false` | Lewati validasi saat nilai `undefined` / tidak ada |
| `nullable` | boolean | `false` | Lewati validasi saat nilai `null` |

`optional` dan `nullable` boleh sama-sama `true`. Dalam kasus itu, nilai yang tidak ada maupun `null` diterima.

`optional` paling berguna pada properti objek:

```json
{
  "type": "object",
  "properties": {
    "age": { "type": "integer", "optional": true }
  }
}
```

Sebuah properti wajib kecuali node-nya sendiri menetapkan `"optional": true`.

Field tak dikenal ditolak dengan path ke dokumen schema:

```text
/properties/age/minLenght: unknown field 'minLenght' for type 'integer'
```

## Tipe node

### `string`

| Field | Tipe | Aturan |
| --- | --- | --- |
| `minLength` | integer | `>= 0` |
| `maxLength` | integer | `>= 0`, dan `>= minLength` jika keduanya ada |
| `pattern` | string | Harus bisa dikompilasi dan berada di dalam [subset regex portabel](#kebijakan-regex) |
| `format` | string | Salah satu [format yang didukung](#format-string) |

Panjang dihitung dalam **code point** Unicode, jadi satu emoji dihitung 1 di semua target. Jika `pattern` dan `format` sama-sama ada, nilai harus memenuhi keduanya.

```json
{
  "type": "string",
  "minLength": 8,
  "maxLength": 15,
  "pattern": "^[0-9]+$"
}
```

Error: `expected string`, `string shorter than N`, `string longer than N`, `string does not match pattern`, `string does not match format <name>`.

### `number`

| Field | Tipe | Aturan |
| --- | --- | --- |
| `min` | number finite | Batas bawah inklusif |
| `max` | number finite | Batas atas inklusif |

Menerima angka JSON finite apa pun, termasuk pecahan. Menolak boolean, NaN, `Infinity`, dan `-Infinity`. Jika `min > max`, schema ditolak saat parse.

Error: `expected number`, `number less than N`, `number greater than N`.

### `integer`

| Field | Tipe | Aturan |
| --- | --- | --- |
| `min` | integer | Batas bawah inklusif |
| `max` | integer | Batas atas inklusif |

Menerima angka tanpa bagian pecahan. Menolak boolean, nilai pecahan, NaN, dan infinity. Di Go, angka JSON datang sebagai `float64`; validator hasil generate menerima `float64` integral dan tipe integer Go, sesuai perilaku `Number.isInteger` di TypeScript dan pengecekan integer di Python.

Error: `expected integer`, `integer less than N`, `integer greater than N`.

### `boolean`

Tidak ada field.

Error: `expected boolean`.

### `literal`

| Field | Tipe | Aturan |
| --- | --- | --- |
| `value` | string \| number \| boolean \| null | Wajib |

Nilai harus sama dengan literal memakai perbandingan sadar tipe. `true` tidak sama dengan `1`, dan `1` tidak sama dengan `"1"`.

```json
{ "type": "literal", "value": "email" }
```

Error: `expected literal <JSON>`.

### `enum`

| Field | Tipe | Aturan |
| --- | --- | --- |
| `values` | array | Non-kosong; elemen string \| number \| boolean; duplikat ditolak; `null` tidak diizinkan |

```json
{ "type": "enum", "values": ["admin", "member", "guest"] }
```

Error: `value not in enum`.

### `array`

| Field | Tipe | Aturan |
| --- | --- | --- |
| `items` | schema | Wajib |
| `minItems` | integer | `>= 0` |
| `maxItems` | integer | `>= 0`, dan `>= minItems` jika keduanya ada |

Setiap item divalidasi, bahkan setelah item sebelumnya gagal.

```json
{
  "type": "array",
  "items": { "type": "string", "minLength": 1 },
  "maxItems": 5
}
```

Error: `expected array`, `array shorter than N`, `array longer than N`, plus error per item pada path seperti `["tags", 0]`.

### `object`

| Field | Tipe | Aturan |
| --- | --- | --- |
| `properties` | object | Wajib; memetakan nama properti ke schema; nama tidak boleh kosong |
| `additionalProperties` | boolean | Default `true` |
| `constraints` | array | Opsional, [constraint antar-field](#constraint-antar-field) |

Properti divalidasi dalam urutan deklarasi. Sebuah properti wajib kecuali node-nya `optional`. Jika `additionalProperties` bernilai `false`, setiap key tak dikenal menghasilkan `unexpected property` pada path `[...objectPath, key]`, dikunjungi dalam urutan code point Unicode.

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "id": { "type": "string", "format": "uuid" },
    "age": { "type": "integer", "optional": true }
  }
}
```

Error: `expected object`, error per properti, `unexpected property`, plus error constraint.

### `record`

Map dengan key string arbitrer dan schema nilai yang seragam.

| Field | Tipe | Aturan |
| --- | --- | --- |
| `values` | schema | Wajib |
| `minProperties` | integer | `>= 0` |
| `maxProperties` | integer | `>= 0`, dan `>= minProperties` jika keduanya ada |

Key divalidasi dalam urutan code point Unicode, sehingga urutan error identik di semua bahasa.

```json
{
  "type": "record",
  "values": { "type": "integer" },
  "minProperties": 1
}
```

Error: `expected object`, `object has fewer than N properties`, `object has more than N properties`, plus error per nilai.

### `tuple`

Array panjang tetap dengan schema per posisi.

| Field | Tipe | Aturan |
| --- | --- | --- |
| `items` | array of schema | Wajib, non-kosong |

Array harus memiliki panjang **tepat** sama dengan `items`. Jika panjang berbeda, satu error panjang dilaporkan dan posisi tidak divalidasi.

```json
{
  "type": "tuple",
  "items": [
    { "type": "string" },
    { "type": "integer" }
  ]
}
```

Error: `expected array`, `tuple must have exactly N items`, plus error posisional.

### `union`

Nilai valid jika lolos validasi terhadap **salah satu** varian.

| Field | Tipe | Aturan |
| --- | --- | --- |
| `variants` | array of schema | Wajib, non-kosong |

Error tiap varian diisolasi dan ditekan. Jika tidak ada varian yang menerima nilai, satu error dilaporkan pada path union:

```text
value matched no union variant
```

```json
{
  "type": "union",
  "variants": [
    { "type": "string", "format": "email" },
    { "type": "string", "pattern": "^[0-9]{8,15}$" }
  ]
}
```

### `any`

Tidak ada field. Menerima nilai JSON apa pun. Nilai `undefined` tetap ditolak kecuali node `optional`.

Error: `expected a value, got undefined`.

## Constraint antar-field

Constraint berada pada node `object` dan dievaluasi **setelah** validasi struktural objek. Jika ada properti yang gagal, constraint dilewati untuk objek itu, sehingga field yang hilang tidak juga menghasilkan noise constraint.

```json
{
  "type": "object",
  "properties": {
    "min": { "type": "integer" },
    "max": { "type": "integer" },
    "start": { "type": "string", "optional": true },
    "end": { "type": "string", "optional": true }
  },
  "constraints": [
    { "kind": "lessOrEqual", "left": "min", "right": "max" },
    { "kind": "requiredTogether", "fields": ["start", "end"] }
  ]
}
```

### Constraint perbandingan

`greaterThan`, `lessThan`, `greaterOrEqual`, `lessOrEqual`, `equal`, `notEqual`.

| Field | Aturan |
| --- | --- |
| `kind` | Salah satu dari enam jenis perbandingan |
| `left` | Nama properti yang dideklarasikan pada objek yang sama |
| `right` | Nama properti yang dideklarasikan pada objek yang sama |
| `message` | Pesan kustom opsional |

Semantik:

- **Jenis urutan** (`greaterThan`, `lessThan`, `greaterOrEqual`, `lessOrEqual`) hanya berlaku jika kedua sisi adalah angka finite. Selain itu constraint dilewati.
- **`equal` / `notEqual`** memakai perbandingan sadar tipe dan dilewati jika salah satu sisi tidak ada (`undefined`).
- Path error adalah path objek, bukan path `left` atau `right`.
- Pesan default: `constraint failed: <left> <op> <right>`, misalnya `constraint failed: min <= max`.

### `requiredTogether`

| Field | Aturan |
| --- | --- |
| `kind` | `"requiredTogether"` |
| `fields` | Array berisi minimal dua nama properti yang dikenal |
| `message` | Pesan kustom opsional |

Constraint gagal hanya jika **sebagian, tetapi tidak semua**, field yang terdaftar ada. Semua tidak ada atau semua ada akan lolos.

Pesan default: `fields must be provided together: <field1>, <field2>`.

## Format string

Format adalah definisi regex bersama yang ditanam ke setiap validator hasil generate. Format memvalidasi **bentuk**, bukan semantik RFC penuh.

| Format | Menerima | Catatan |
| --- | --- | --- |
| `email` | `local@domain.tld` | Tanpa whitespace; butuh satu `@` dan minimal satu `.` setelahnya. Bukan RFC 5322 penuh. |
| `uuid` | Hex `8-4-4-4-12` | Hex case-insensitive; tanpa kurung kurawal atau prefix `urn:`. |
| `date` | `YYYY-MM-DD` | Hanya bentuk. `2020-13-40` lolos; validitas kalender tidak diperiksa. |
| `date-time` | `YYYY-MM-DDTHH:MM:SS[.fff]Z` | `T` huruf besar, wajib diakhiri `Z`. Offset tidak diterima. |
| `time` | `HH:MM:SS[.fff][Z\|±HH:MM]` | Offset opsional. Hanya bentuk; rentang tidak diperiksa. |
| `hostname` | Label dipisah titik | Huruf, angka, dan hyphen; label tidak boleh diawali atau diakhiri hyphen. Tanpa titik di akhir. |
| `ipv4` | Desimal bertitik | Setiap oktet 0–255. |
| `ipv6` | Berbagai bentuk teks IPv6 | Termasuk kompresi `::` dan bentuk IPv4-mapped. |
| `uri` | `scheme:rest` | Scheme diawali huruf; tanpa whitespace di sisa string. Bukan parser RFC 3986 penuh. |

Jika sebuah node memiliki `format` dan `pattern`, keduanya harus lolos. Saat pembentukan corpus parity, kandidat diperiksa terhadap keduanya.

## Kebijakan regex

`pattern` dievaluasi oleh `RegExp` ECMA-262 di TypeScript, `re` Python di Python, dan RE2 di Go. Agar perilakunya identik, hanya subset portabel yang diterima saat parse.

**Diizinkan**

- Literal, `.`, `^`, `$`
- Character class, range, dan negasi: `[a-z]`, `[^0-9]`
- Grup `(...)` dan grup non-capturing `(?:...)`
- Alternasi `|`
- Quantifier `*`, `+`, `?`, `{m}`, `{m,}`, `{m,n}`
- Escape `\f`, `\n`, `\r`, `\t`, `\v`, `\xHH`, `\uXXXX`
- Metakarakter yang di-escape seperti `\.` dan `\\`

**Ditolak**

| Konstruksi | Alasan |
| --- | --- |
| Lookahead `(?=...)`, `(?!...)` | Tidak didukung RE2 (Go) |
| Lookbehind `(?<=...)`, `(?<!...)` | Tidak portabel di semua target |
| Named group `(?<name>...)`, `(?P<name>...)` | Tidak portabel |
| Named backreference `\k<name>` | Tidak portabel |
| Backreference numerik dan escape oktal `\1` | Tidak portabel |
| Unicode property escape `\p{...}`, `\P{...}` | Tidak didukung RE2 |
| Shorthand class `\d`, `\w`, `\s`, `\b`, `\B` | Semantik Unicode berbeda antar-engine |
| Anchor `\A`, `\Z`, `\z` | Gunakan `^` dan `$` |
| Control escape `\cX` | Tidak portabel |
| `\a` | Bell di Python, literal `a` di ECMA-262 |
| `\N`, `\U`, `\u{...}` | Gunakan `\uXXXX` |
| Class kosong `[]`, `[^]` | Valid di ECMA-262, syntax error di Python |

Gunakan class eksplisit alih-alih shorthand:

```json
{ "type": "string", "pattern": "^[0-9]{8,15}$" }
```

Terjemahan yang dilakukan generator:

- Python: `$` yang tidak di-escape menjadi `\Z`, sehingga newline di akhir tidak pernah cocok.
- Go: `\uXXXX` menjadi `\x{XXXX}` milik RE2.

## Model error

Semua validator hasil generate berperilaku sama:

- **Akumulasi error.** Satu properti gagal tidak menghentikan properti saudara, item array berikutnya, atau pengecekan selanjutnya.
- **Array path.** Setiap error memiliki `path` berisi nama properti (`string`) dan indeks array (`number`), plus `message`.
- **Urutan.** Properti objek dalam urutan deklarasi schema; key objek tak dikenal dan key record dalam urutan code point Unicode; item array berdasarkan indeks; constraint setelah pengecekan struktural dalam urutan deklarasi.
- **Error bentuk menghentikan pengecekan lebih dalam.** Jika sebuah node bertipe salah, hanya error bentuk yang dilaporkan untuk node itu; anak-anaknya tidak dikunjungi.
- **Error union diringkas.** Varian dicoba secara terisolasi; jika tidak ada yang lolos, satu error `value matched no union variant` dilaporkan.

Contoh:

```text
["email"]            expected string
["tags", 2]          string shorter than 1
["contact"]          value matched no union variant
["age"]              integer greater than 150
[]                   constraint failed: min <= max
```

## Contoh lengkap

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "id": { "type": "string", "format": "uuid" },
    "email": { "type": "string", "format": "email" },
    "name": { "type": "string", "minLength": 1, "maxLength": 80 },
    "age": { "type": "integer", "min": 0, "max": 150, "optional": true },
    "role": { "type": "enum", "values": ["admin", "member", "guest"] },
    "nickname": { "type": "string", "nullable": true, "maxLength": 20 },
    "tags": {
      "type": "array",
      "items": { "type": "string", "minLength": 1, "maxLength": 24 },
      "maxItems": 5
    },
    "contact": {
      "type": "union",
      "variants": [
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "kind": { "type": "literal", "value": "email" },
            "value": { "type": "string", "format": "email" }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "kind": { "type": "literal", "value": "phone" },
            "value": { "type": "string", "pattern": "^[0-9]{8,15}$" }
          }
        }
      ]
    },
    "min": { "type": "integer", "optional": true },
    "max": { "type": "integer", "optional": true }
  },
  "constraints": [
    { "kind": "lessOrEqual", "left": "min", "right": "max" }
  ]
}
```

Ini mirip dengan [`examples/user.schema.json`](../../examples/user.schema.json), yang di-commit bersama validator hasil generate-nya.

## Aturan validasi schema

`schemapar check` menolak dokumen jika salah satu kondisi berikut terpenuhi:

- Root bukan objek biasa, atau `type` hilang/tidak dikenal.
- Ada field tak dikenal untuk tipe node tersebut.
- `optional` / `nullable` bukan boolean.
- Batas numerik bertipe salah, atau batas panjang/jumlah negatif atau bukan integer.
- `minLength > maxLength`, `minItems > maxItems`, `minProperties > maxProperties`, atau `min > max`.
- `literal.value` bukan skalar.
- `enum.values` kosong, berisi `null`, atau berisi duplikat.
- `array` tidak punya `items`; `record` tidak punya `values`; `tuple.items` kosong.
- `union.variants` kosong.
- `object.properties` hilang atau bukan objek; nama properti kosong.
- Constraint mereferensikan properti tak dikenal, memakai `kind` tak dikenal, atau punya field tambahan.
- `requiredTogether.fields` berisi kurang dari dua entri.
- `pattern` gagal dikompilasi atau memakai konstruksi tidak portabel.
- `format` bukan salah satu dari sembilan nama yang didukung.
