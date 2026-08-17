# FiyatNabız v13.3 — ReefAPI anahtar kontrolü düzeltildi

Bu sürümde **Şimdi tara** butonu yalnızca 1 partiyi başlatmaz. 12 kategori tamamlandıktan sonra kalan kategoriler **5 saniye arayla otomatik** taranır.

Örnek:
`1–12 → 5 sn → 13–24 → 5 sn → 25–36 → 5 sn → 37–48 → 5 sn → 49–54`

54 kategori tamamlandığında tam tur kapanır. `Döngü başına kategori` değerini 12 bırakmak kredi tüketimini kontrollü tutar.

## Önemli
- Mevcut `.env` dosyanı kullanır.
- Mevcut SQLite veritabanını silmez.
- `REEF_KEY` yalnızca sunucu tarafında okunur.
- Tarama sırasında tarayıcıyı kapatsan bile sunucu çalışıyorsa döngü devam eder.
- CMD penceresini kapatma; sunucu ve arka plan taraması o pencerede çalışır.
- Tarama tamamlandığında `/api/status` ekranı 15 saniyede bir yenilenir.

## Çalıştırma
`FiyatNabiz_v13_2.bat` dosyasına çift tıklayın.

Sonra:
1. `.env` içinde `REEF_KEY=` anahtarının dolu olduğundan emin olun.
2. Tarayıcıda `http://127.0.0.1:3000` açılır.
3. **Şimdi tara**ya bir kez basın.
4. 12 kategori tamamlandıktan sonra sistem kendisi devam eder.


## v13.3 ReefAPI düzeltmesi
- Kök klasördeki `.env` okunur.
- `config/.env` de desteklenir.
- `REEF_KEY`, `REEF_API_KEY` ve `REEFAPI_KEY` adları desteklenir.
- Arayüz yalnızca gerçekten anahtar bulunamadığında uyarı verir.
- Gerçek anahtar pakete dahil edilmez.

## Telegram Bot Kurulumu

1. BotFather'dan bot token alın.
2. Sunucuda Environment Variables bölümüne `TELEGRAM_BOT_TOKEN` ekleyin.
3. İlk çalıştırmada Telegram'dan bota `/id` gönderin.
4. Dönen Chat ID'yi `TELEGRAM_CHAT_ID` olarak sunucuya ekleyin ve yeniden deploy edin.
5. Sonrasında `/baslat`, `/durum`, `/sonuclar` ve `/ayar` komutları kullanılabilir.

**Güvenlik:** ReefAPI anahtarı ve Telegram tokenı kaynak koduna eklenmemelidir. `.env` Git'e gönderilmemelidir.
