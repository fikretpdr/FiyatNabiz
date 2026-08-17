const TelegramBot = require('node-telegram-bot-api');
module.exports = ({ stats, scanNow, scanning }) => {
const TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const ALLOWED_CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || '').trim();

if (!TOKEN) {
  console.log('[Telegram] TELEGRAM_BOT_TOKEN tanımlı değil; bot devre dışı.');
  module.exports = null;
} else {
  const bot = new TelegramBot(TOKEN, { polling: true });

  const isAllowed = (msg) =>
    ALLOWED_CHAT_ID && String(msg.chat.id) === ALLOWED_CHAT_ID;

  const money = n =>
    Number(n || 0).toLocaleString('tr-TR', { maximumFractionDigits: 2 }) + ' TL';

  function help() {
    return [
      '🤖 FiyatNabız v13.3',
      '',
      '/id — Telegram Chat ID\'ni gösterir',
      '/durum — sistem durumunu gösterir',
      '/baslat — taramayı başlatır',
      '/sonuclar — son fırsatları gösterir',
      '/ayar — tarama ayarlarını gösterir',
      '/yardim — bu listeyi gösterir',
      '',
      'Güvenlik: TELEGRAM_CHAT_ID ayarlanmışsa yalnızca bu hesap komut çalıştırabilir.'
    ].join('\n');
  }

  function denied(msg) {
    return bot.sendMessage(
      msg.chat.id,
      '⛔ Yetkiniz yok. Bu bot yalnızca tanımlı Telegram hesabından kullanılabilir.'
    );
  }

  function requireAccess(msg) {
    if (!ALLOWED_CHAT_ID) {
      bot.sendMessage(
        msg.chat.id,
        '🔐 Bot henüz güvenli hesaba kilitlenmedi.\n\n' +
        'Önce /id komutuyla Chat ID\'ni öğrenip sunucuda TELEGRAM_CHAT_ID olarak tanımlayın.'
      );
      return false;
    }
    if (!isAllowed(msg)) {
      denied(msg);
      return false;
    }
    return true;
  }

  async function sendOpportunities(chatId) {
    const s = stats(50);
    const rows = (s.opportunities || []).slice(0, 10);
    if (!rows.length) {
      return bot.sendMessage(chatId, '🔎 Son 1 saatte %50 veya üzeri fiyat düşüşü bulunamadı.');
    }

    let text = '🔥 Son fırsatlar\n\n';
    for (const x of rows) {
      text += `🛒 ${x.title}\n`;
      text += `🏪 ${x.marketplace}\n`;
      text += `💰 ${money(x.old_price)} → ${money(x.new_price)}\n`;
      text += `📉 %${x.drop_pct} düşüş\n`;
      if (x.url) text += `🔗 ${x.url}\n`;
      text += '\n';
    }
    return bot.sendMessage(chatId, text, { disable_web_page_preview: true });
  }

  async function sendScanSummary(chatId, r) {
    await bot.sendMessage(chatId, [
      '✅ Tarama partisi tamamlandı',
      '',
      `📚 Kategoriler: ${r.categories.length}`,
      `🔎 Bulunan ürün: ${Number(r.found || 0).toLocaleString('tr-TR')}`,
      `💾 Kaydedilen fiyat: ${Number(r.saved || 0).toLocaleString('tr-TR')}`,
      `🔥 Fırsat: ${Number(r.opportunities || 0)}`,
      `🔁 Sonraki parti otomatik devam edecek.`,
    ].join('\n'));
    if (r.opportunities > 0) await sendOpportunities(chatId);
  }

  bot.setMyCommands([
    { command: 'id', description: 'Chat ID\'ni göster' },
    { command: 'baslat', description: 'Tarama başlat' },
    { command: 'durum', description: 'Durumu göster' },
    { command: 'sonuclar', description: 'Son fırsatları göster' },
    { command: 'ayar', description: 'Ayarları göster' },
    { command: 'yardim', description: 'Yardım' }
  ]).catch(() => {});

  bot.onText(/^\/(?:start|yardim|help)$/i, msg => {
    if (!ALLOWED_CHAT_ID || isAllowed(msg)) return bot.sendMessage(msg.chat.id, help());
    return denied(msg);
  });

  // /id güvenlik kurulumunda ilk adım için özellikle açık bırakılır.
  bot.onText(/^\/id$/i, msg => {
    bot.sendMessage(
      msg.chat.id,
      `🆔 Chat ID: ${msg.chat.id}\n\n` +
      'Bu değeri TELEGRAM_CHAT_ID olarak sunucunun Environment Variables bölümüne ekleyin. ' +
      'Sonrasında bot yalnızca bu hesaptan komut kabul eder.'
    );
  });

  bot.onText(/^\/baslat$/i, async msg => {
    if (!requireAccess(msg)) return;
    if (scanning) return bot.sendMessage(msg.chat.id, '⏳ Zaten bir tarama çalışıyor.');
    await bot.sendMessage(msg.chat.id, '🚀 FiyatNabız taraması başlıyor...');
    try {
      const r = await scanNow('telegram', true);
      await sendScanSummary(msg.chat.id, r);
    } catch (e) {
      await bot.sendMessage(msg.chat.id, `❌ Tarama hatası:\n${e.message}`);
    }
  });

  bot.onText(/^\/durum$/i, async msg => {
    if (!requireAccess(msg)) return;
    const s = stats(50);
    const last = s.lastScan;
    const sourceNames = Object.entries(s.settings.sources)
      .filter(([, v]) => v).map(([k]) => k).join(', ') || 'yok';

    await bot.sendMessage(msg.chat.id, [
      '📊 FiyatNabız Durumu',
      '',
      `🔄 Tarama: ${s.scanning ? 'ÇALIŞIYOR' : 'Beklemede'}`,
      `📦 Ürün: ${s.products.toLocaleString('tr-TR')}`,
      `🧾 Fiyat kaydı: ${s.observations.toLocaleString('tr-TR')}`,
      `⚙️ Parti: ${s.settings.batch} kategori`,
      `⏱ Otomatik aralık: ${s.settings.interval} dk`,
      `🛍 Kaynaklar: ${sourceNames}`,
      `🔐 ReefAPI: ${process.env.REEF_KEY || process.env.REEF_API_KEY || process.env.REEFAPI_KEY ? 'hazır' : 'eksik'}`,
      last ? `🕒 Son tarama: ${new Date(last.finishedAt).toLocaleString('tr-TR')}` : '🕒 Son tarama: yok',
      s.lastError ? `⚠️ Son hata: ${s.lastError}` : ''
    ].filter(Boolean).join('\n'));
  });

  bot.onText(/^\/sonuclar$/i, async msg => {
    if (!requireAccess(msg)) return;
    await sendOpportunities(msg.chat.id);
  });

  bot.onText(/^\/ayar$/i, async msg => {
    if (!requireAccess(msg)) return;
    const s = stats(50);
    await bot.sendMessage(msg.chat.id, [
      '⚙️ FiyatNabız Ayarları',
      '',
      `⏱ Otomatik tarama: ${s.settings.interval} dakika`,
      `🔢 Parti boyutu: ${s.settings.batch} kategori`,
      `🛍 Kaynaklar: ${Object.entries(s.settings.sources).filter(([,v])=>v).map(([k])=>k).join(', ') || 'yok'}`
    ].join('\n'));
  });

  bot.on('polling_error', e => console.error('[Telegram polling]', e.message));
  console.log('[Telegram] Bot aktif.');
}

module.exports = null;
  };
