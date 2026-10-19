/**
 * JOUMPA People Development Tracker: pemicu sinkronisasi Google Sheet <-> database.
 *
 * Project standalone (dibuat dari script.google.com, tidak menempel di Sheet). Script ini hanya
 * mengirim "ping" ke server (POST /api/sync/run); server yang membaca dan menulis data. Script tidak
 * pernah membaca atau mengubah isi Sheet, dan tidak menyimpan kunci database.
 *
 * Script Properties (Project Settings > Script Properties):
 *   SHEET_ID          ID Google Sheet People Development JOUMPA (bagian URL di antara /d/ dan /edit)
 *   SYNC_URL          https://<domain-aplikasi>/api/sync/run
 *   SYNC_PING_SECRET  rahasia khusus ping (hanya bisa memicu sinkronisasi, tidak bisa membaca data)
 *
 * Jalankan dari editor (pilih fungsi di samping tombol Run, lalu Run):
 *   cekKonfigurasi      memeriksa ketiga properti dan akses ke Sheet, tanpa sinkronisasi
 *   pasangTrigger       sekali saja: memasang trigger edit dan perubahan struktur pada Sheet
 *   sinkronkanSekarang  memicu satu sinkronisasi sekarang
 *   hapusTrigger        melepas trigger (sinkronisasi tetap berjalan tiap menit dari server)
 * Hasil tiap fungsi tampil di Execution log.
 */

var JEDA_PING_DETIK = 5; // edit beruntun dalam 5 detik cukup satu ping; sisanya ikut putaran cron (<= 1 menit)
var HANDLER = ['saatDiedit', 'saatStrukturBerubah'];

function cekKonfigurasi() {
  var cfg = konfigurasi_();
  if (!cfg) throw new Error(pesanBelumDikonfigurasi_());
  var nama = SpreadsheetApp.openById(cfg.sheetId).getName(); // gagal di sini bila ID salah atau akun tanpa akses
  var trigger = triggerTerpasang_();
  console.log('Konfigurasi lengkap. Sheet: "' + nama + '". SYNC_URL: ' + cfg.url + '. ' +
    (trigger.length ? 'Trigger terpasang: ' + trigger.join(', ') + '.' : 'Trigger belum dipasang: jalankan pasangTrigger.'));
}

function pasangTrigger() {
  var cfg = konfigurasi_();
  if (!cfg) throw new Error(pesanBelumDikonfigurasi_());
  SpreadsheetApp.openById(cfg.sheetId); // memastikan akun ini bisa membuka Sheet sebelum memasang trigger
  hapusTriggerKami_();
  ScriptApp.newTrigger('saatDiedit').forSpreadsheet(cfg.sheetId).onEdit().create();
  ScriptApp.newTrigger('saatStrukturBerubah').forSpreadsheet(cfg.sheetId).onChange().create();
  console.log('Trigger terpasang. Setiap perubahan di Sheet akan memicu sinkronisasi.');
}

function sinkronkanSekarang() {
  var hasil = kirimPing_('manual', false);
  if (!hasil.ok) throw new Error(hasil.pesan);
  console.log(hasil.pesan);
}

function hapusTrigger() {
  var jumlah = hapusTriggerKami_();
  console.log(jumlah ? jumlah + ' trigger dilepas.' : 'Tidak ada trigger JOUMPA yang terpasang.');
}

/** Trigger terpasang: setiap edit sel. */
function saatDiedit(e) {
  kirimPing_('edit', true);
}

/** Trigger terpasang: hapus/sisip baris atau tab (tidak memicu onEdit). */
function saatStrukturBerubah(e) {
  var jenis = e && e.changeType;
  if (jenis === 'EDIT' || jenis === 'FORMAT') return; // sudah ditangani saatDiedit / tidak relevan
  kirimPing_('change', true);
}

function kirimPing_(sumber, pakaiJeda) {
  var cfg = konfigurasi_();
  if (!cfg) return { ok: false, pesan: pesanBelumDikonfigurasi_() };

  if (pakaiJeda) {
    var cache = CacheService.getScriptCache();
    if (cache.get('joumpa_ping')) return { ok: true, pesan: 'Dilewati (jeda).' };
    cache.put('joumpa_ping', '1', JEDA_PING_DETIK);
  }

  try {
    var res = UrlFetchApp.fetch(cfg.url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ source: 'sheet:' + sumber }),
      headers: { Authorization: 'Bearer ' + cfg.secret },
      muteHttpExceptions: true,
      followRedirects: false,
    });
    var kode = res.getResponseCode();
    var isi = {};
    try {
      isi = JSON.parse(res.getContentText());
    } catch (err) {}

    if (kode === 200 && isi.status === 'busy') {
      return { ok: true, pesan: 'Sinkronisasi lain sedang berjalan. Perubahan Anda ikut pada putaran berikutnya (paling lama 1 menit).' };
    }
    if (kode === 200 && isi.status === 'partial') {
      return { ok: true, pesan: 'Sinkronisasi selesai dengan catatan. Lihat catatan sel (segitiga hitam) atau halaman admin.' };
    }
    if (kode === 200) return { ok: true, pesan: 'Sinkronisasi selesai.' };
    if (kode === 401) return { ok: false, pesan: 'Ditolak server: SYNC_PING_SECRET tidak cocok.' };
    if (kode === 503) return { ok: false, pesan: 'Server belum dikonfigurasi untuk sinkronisasi.' };
    return { ok: false, pesan: 'Sinkronisasi gagal (kode ' + kode + '). Coba lagi nanti atau hubungi admin.' };
  } catch (err) {
    console.warn('JOUMPA ping gagal: ' + err.message);
    return { ok: false, pesan: 'Tidak dapat menghubungi server. Coba lagi nanti.' };
  }
}

function konfigurasi_() {
  var p = PropertiesService.getScriptProperties();
  var sheetId = (p.getProperty('SHEET_ID') || '').trim();
  var url = (p.getProperty('SYNC_URL') || '').trim();
  var secret = (p.getProperty('SYNC_PING_SECRET') || '').trim();
  if (!/^[A-Za-z0-9_-]{30,}$/.test(sheetId) || !/^https:\/\/\S+$/.test(url) || secret.length < 16) return null;
  return { sheetId: sheetId, url: url, secret: secret };
}

function triggerTerpasang_() {
  return ScriptApp.getProjectTriggers()
    .map(function (t) { return t.getHandlerFunction(); })
    .filter(function (f) { return HANDLER.indexOf(f) >= 0; });
}

function hapusTriggerKami_() {
  var jumlah = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (HANDLER.indexOf(t.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(t);
      jumlah++;
    }
  });
  return jumlah;
}

function pesanBelumDikonfigurasi_() {
  return 'Belum dikonfigurasi. Buka Project Settings > Script Properties, lalu isi SHEET_ID, SYNC_URL ' +
    'dan SYNC_PING_SECRET (nilainya ada di file .env aplikasi).';
}
