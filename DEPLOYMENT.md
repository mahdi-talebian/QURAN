# راهنمای Deploy — مصحف لمسی

این پروژه یک سایت **کاملاً استاتیک** است: backend، دیتابیس، secret، API key یا متغیر محیطی ندارد. خروجی production پس از build شامل خود برنامه، 604 SVG و 604 JSON است و مرورگر کاربران در حالت production به GitHub یا CDN بیرونی درخواست نمی‌زند.

## پیش‌نیازهای source repository

پوشهٔ `mushaf-touch` را به‌عنوان root ریپوی خودت در GitHub قرار بده. فایل‌های `vendor/*.tar.gz` باید در commit باشند؛ آن‌ها assetهای نسخهٔ pinned و قابل‌اعتبارسنجی پروژه‌اند.

> فایل‌های استخراج‌شده در `assets/mushaf-svg` و `assets/qcf4` عمداً commit نمی‌شوند؛ اسکریپت build آن‌ها را از archiveهای `vendor/` تولید می‌کند.

## اعتبارسنجی قبل از انتشار

```bash
chmod +x scripts/*.sh scripts/*.py
./scripts/verify-vendored-assets.py
```

این دستور موارد زیر را بررسی می‌کند:

- SHA-256 هر دو archive؛
- وجود هر 604 صفحه؛
- XML معتبر، شمارهٔ صفحه و 15 خط فیزیکی در تمام SVGها؛
- JSON معتبر، شمارهٔ صفحه و تعداد خط صحیح در QCF4؛
- برابر بودن مجموعهٔ آیه‌های SVG و QCF4 در هر صفحه.

خروجی معتبر فعلی باید شامل این مقادیر باشد:

```text
SVG pages : 604
QCF pages : 604
SVG word groups: 91451
```

## روش عمومی برای هر static host

```bash
./scripts/build-static.sh ./site
```

پوشهٔ `site/` خروجی آمادهٔ انتشار است. آن را با هر static web server یا سرویس‌هایی مانند Nginx، Caddy، Netlify، Cloudflare Pages، Vercel یا object storage + CDN منتشر کن.

ساختار خروجی:

```text
site/
├── index.html
├── app.js
├── styles.css
├── asset-mode.js        # خودکار روی local تنظیم شده است
└── assets/
    ├── mushaf-svg/      # 604 فایل SVG
    └── qcf4/
        ├── pages/       # 604 فایل JSON
        ├── index.json
        ├── verses.json
        ├── font-map.json
        └── qbsml.json
```

همهٔ URLهای asset به‌صورت relative و بر مبنای `import.meta.url` ساخته می‌شوند؛ بنابراین deploy در دامنهٔ اصلی، subdomain، زیرمسیرهایی مثل `/quran/` و GitHub Pages repository path صحیح است.

## Docker — پیشنهادشده برای سرور شخصی

Docker image خودش فایل‌ها را verify و build می‌کند و با Nginx روی پورت 8080 سرو می‌کند:

```bash
docker compose up --build -d
curl http://127.0.0.1:8080/healthz
```

برای اجرا در پس‌زمینه پس از به‌روزرسانی:

```bash
docker compose up --build -d --remove-orphans
```

Nginx داخل image موارد زیر را تنظیم می‌کند:

- gzip برای SVG و JSON؛
- cache یک‌روزه برای data assetها؛
- health endpoint در `/healthz`؛
- Content Security Policy برای حالت کاملاً local؛
- headerهای `nosniff`، Referrer Policy و Permissions Policy؛
- fallback به `index.html` برای static SPA routeها.

برای دامنه و HTTPS، Docker را پشت reverse proxy خودت مانند Caddy، Traefik یا Nginx اصلی بگذار. TLS/دامنه وابسته به سرور و DNS توست و عمداً hard-code نشده است.

## GitHub Pages

فایل `.github/workflows/deploy-pages.yml` در پروژه حاضر است.

1. repository را به GitHub push کن.
2. در **Settings → Pages** گزینهٔ **Source: GitHub Actions** را انتخاب کن.
3. با push به شاخهٔ `main`، workflow archiveها را verify می‌کند، سایت self-hosted را می‌سازد و deploy می‌کند.

GitHub Pages باید برای artifact حدود 400MB فضای build داشته باشد. اگر hosting provider محدودیت artifact کوچک‌تری دارد، Docker یا سرور static شخصی انتخاب بهتری است.

## Netlify / Cloudflare Pages / Vercel

در تنظیمات build این مقادیر را وارد کن:

```text
Build command: chmod +x scripts/*.sh scripts/*.py && ./scripts/build-static.sh site
Publish directory: site
```

Node dependency لازم نیست؛ shell، Python 3، `tar`، `gzip` و `sha256sum` باید در محیط build موجود باشند. در صورت محدودیت RAM یا artifact، از Docker استفاده کن.

## Deploy بدون Docker روی Nginx

```bash
sudo mkdir -p /var/www/mushaf-touch
sudo ./scripts/build-static.sh /var/www/mushaf-touch
```

سپس ریشهٔ virtual host را روی `/var/www/mushaf-touch` تنظیم کن. می‌توانی از `nginx.conf` موجود در پروژه به‌عنوان مبنا استفاده کنی.

## حالت توسعه در برابر production

- در سورس پروژه، `asset-mode.js` روی `auto` است: local files را در صورت وجود ترجیح می‌دهد و فقط در development بدون asset استخراج‌شده از remote fallback استفاده می‌کند.
- `build-static.sh` در خروجی deploy به‌طور خودکار آن را به `local` قطعی تبدیل می‌کند؛ در production هیچ upstream fallback وجود ندارد.
- بنابراین تغییر دستی source برای deploy لازم نیست.

## بازگردانی یا حذف assetهای استخراج‌شده

برای development محلی:

```bash
./scripts/extract-local-assets.sh
# پس از پایان کار
./scripts/remove-extracted-assets.sh
```

این دو دستور archiveهای اصلی در `vendor/` را حذف نمی‌کنند.
