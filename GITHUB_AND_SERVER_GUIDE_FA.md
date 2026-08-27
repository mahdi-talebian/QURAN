# راهنمای صفر تا صد: بردن «مصحف لمسی» به GitHub و سرور شخصی

این راهنما برای پروژه‌ای است که همین‌جا در پوشهٔ `mushaf-touch` ساخته شده. روش پیشنهادی زیر در production **self-hosted** است؛ یعنی کاربران از GitHub، Raw GitHub یا ریپوهای upstream فایل قرآن دریافت نمی‌کنند.

---

## بخش A — پیش‌نیازها

### 0. چیزهایی که نیاز داری

- یک حساب GitHub؛
- Git روی کامپیوتر یا سرور خودت؛
- برای deploy روی سرور: یک VPS/Linux server و دسترسی SSH؛
- یک دامنه، فقط در صورتی که HTTPS و آدرس اختصاصی می‌خواهی.

این پروژه API key، دیتابیس، رمز عبور یا متغیر محیطی محرمانه ندارد.

### 1. بررسی محتویات پروژه

در ریشهٔ پروژه باید این فایل‌ها وجود داشته باشند:

```text
mushaf-touch/
├── vendor/
│   ├── mushafdatabase-svg-v1.01.tar.gz
│   ├── quran-qcf4-data.tar.gz
│   ├── SHA256SUMS
│   └── SOURCES.md
├── scripts/
├── Dockerfile
├── docker-compose.yml
├── nginx.conf
├── DEPLOYMENT.md
└── .github/workflows/deploy-pages.yml
```

فایل‌های `vendor/*.tar.gz` را حذف نکن. آن‌ها snapshot مستقل داده‌های لازم هستند.

---

## بخش B — ساخت repository در GitHub

### 2. یک repository خالی بساز

1. وارد https://github.com/new شو.
2. یک نام مانند `mushaf-touch` وارد کن.
3. Public یا Private را متناسب با نیازت انتخاب کن.
4. گزینه‌های **Add a README file**، `.gitignore` و License را فعال نکن؛ repo باید خالی باشد.
5. روی **Create repository** بزن.

URL جدیدت چیزی شبیه این است:

```text
https://github.com/USERNAME/mushaf-touch.git
```

### 3. Git را برای اولین‌بار تنظیم کن

اگر Git را قبلاً تنظیم نکرده‌ای:

```bash
git config --global user.name "نام شما"
git config --global user.email "you@example.com"
```

بررسی:

```bash
git config --global --list
```

---

## بخش C — ورود امن به GitHub

### روش پیشنهادی: GitHub CLI

### 4. GitHub CLI را نصب و login کن

پس از نصب `gh`، اجرا کن:

```bash
gh auth login
```

گزینه‌های امن پیشنهادی:

```text
GitHub.com
HTTPS
Login with a web browser
```

مرورگر باز می‌شود؛ ورود را خودت تأیید کن. در این روش token در دستورها، فایل‌های پروژه یا chat نوشته نمی‌شود.

بررسی login:

```bash
gh auth status
```

### روش جایگزین: Fine-grained Personal Access Token

اگر GitHub CLI نمی‌خواهی:

1. به GitHub → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** برو.
2. یک token کوتاه‌مدت ایجاد کن؛ مثلاً انقضای یک روز یا یک هفته.
3. **Repository access** را روی **Only select repositories** بگذار و فقط repository جدیدت را انتخاب کن.
4. مجوز **Contents: Read and write** را فعال کن.
5. اگر می‌خواهی workflow داخل `.github/workflows` را push کنی، permission مربوط به workflow/actions را نیز در UI GitHub فعال کن.
6. token را فقط هنگام prompt رمز در terminal وارد کن؛ نه در URL، نه در فایل و نه در chat.

وقتی `git push` نام کاربری و password خواست:

```text
Username: نام کاربری GitHub
Password: token
```

ورودی password در terminal نمایش داده نمی‌شود. پس از پایان کار، token کوتاه‌مدت را revoke کن.

---

## بخش D — commit و push پروژه

### 5. وارد پوشهٔ پروژه شو

```bash
cd mushaf-touch
```

### 6. بررسی integrity پیش از commit

```bash
chmod +x scripts/*.sh scripts/*.py
python3 scripts/verify-vendored-assets.py
```

خروجی مورد انتظار:

```text
Vendored asset verification passed.
SVG pages : 604
QCF pages : 604
SVG word groups: 91451
```

اگر این مرحله خطا داد، push نکن.

### 7. repository محلی بساز و اولین commit را انجام بده

```bash
git init
git add .
git status
git commit -m "Initial self-hosted interactive Mushaf"
git branch -M main
```

در `git status` باید فایل‌های `vendor/` دیده شوند. پوشه‌های بزرگِ استخراج‌شدهٔ `assets/mushaf-svg` و `assets/qcf4` نباید وارد commit شوند؛ این مورد در `.gitignore` تنظیم شده است.

### 8. remote را وصل و push کن

`USERNAME` را با نام GitHub خودت جایگزین کن:

```bash
git remote add origin https://github.com/USERNAME/mushaf-touch.git
git push -u origin main
```

فایل SVG فشرده حدود 75MB است؛ upload اولیه ممکن است چند دقیقه طول بکشد. این فایل زیر حد 100MB GitHub برای هر فایل است.

### 9. در GitHub بررسی کن

در صفحهٔ repository مطمئن شو این موارد هستند:

```text
vendor/mushafdatabase-svg-v1.01.tar.gz
vendor/quran-qcf4-data.tar.gz
scripts/build-static.sh
Dockerfile
DEPLOYMENT.md
```

### 10. یک tag نسخه بساز

پس از اطمینان از push:

```bash
git tag -a v0.1.0 -m "First self-hosted Mushaf release"
git push origin v0.1.0
```

این tag برای برگشت به نسخهٔ سالم در آینده مهم است.

---

## بخش E — Deploy روی GitHub Pages

### 11. GitHub Pages را فعال کن

1. وارد repository شو.
2. به **Settings → Pages** برو.
3. در Source گزینهٔ **GitHub Actions** را انتخاب کن.
4. یک push جدید به `main` انجام بده یا از تب Actions، workflow را دستی اجرا کن.

workflow موجود ابتدا archiveها را verify می‌کند، سپس سایت local را build کرده و deploy می‌کند. در خروجی، `asset-mode.js` به‌صورت خودکار روی `local` است.

### 12. وضعیت deploy را بررسی کن

در تب **Actions**:

- job `Build and deploy self-hosted Mushaf` باید سبز شود؛
- URL نهایی در مرحلهٔ deploy نمایش داده می‌شود؛
- با باز کردن DevTools → Network، درخواست‌ها باید به همان دامنهٔ GitHub Pages بروند، مانند:

```text
https://USERNAME.github.io/mushaf-touch/assets/mushaf-svg/351.svg
https://USERNAME.github.io/mushaf-touch/assets/qcf4/pages/351.json
```

نباید درخواست runtime به `raw.githubusercontent.com` ببینی.

---

## بخش F — Deploy روی سرور شخصی با Docker

این روش برای production پیشنهاد می‌شود.

### 13. روی سرور به GitHub وصل شو

```bash
ssh USER@SERVER_IP
```

### 14. Git و Docker را نصب کن

روش نصب Docker به توزیع Linux سرور بستگی دارد. از راهنمای رسمی Docker برای Debian/Ubuntu/Rocky/AlmaLinux استفاده کن. پس از نصب، بررسی کن:

```bash
git --version
docker --version
docker compose version
```

### 15. پروژهٔ خودت را clone کن

در این مرحله فقط ریپوی **خودت** را clone می‌کنی، نه ریپوهای upstream:

```bash
git clone https://github.com/USERNAME/mushaf-touch.git
cd mushaf-touch
```

### 16. قبل از اجرا صحت archiveها را بررسی کن

```bash
chmod +x scripts/*.sh scripts/*.py
python3 scripts/verify-vendored-assets.py
```

### 17. container را بساز و اجرا کن

```bash
docker compose up --build -d
```

این دستور در build:

1. checksumها را بررسی می‌کند؛
2. SVG و QCF4 را از `vendor/` استخراج می‌کند؛
3. حالت production local را فعال می‌کند؛
4. سایت را با Nginx روی پورت داخلی 8080 اجرا می‌کند.

بررسی health:

```bash
curl http://127.0.0.1:8080/healthz
```

باید ببینی:

```text
ok
```

### 18. اتصال دامنه و HTTPS با Caddy

برای domain مانند `quran.example.com`:

1. یک A record در DNS بساز که به IP سرور اشاره کند.
2. Caddy را با روش رسمی نصب کن.
3. متن `Caddyfile.example` را در `/etc/caddy/Caddyfile` کپی کن.
4. `quran.example.com` را با دامنهٔ واقعی عوض کن.
5. Caddy را reload کن:

```bash
sudo systemctl reload caddy
```

Caddy به `127.0.0.1:8080` proxy می‌کند و HTTPS را خودکار مدیریت می‌کند.

> Docker Compose به‌طور پیش‌فرض فقط روی localhost bind می‌شود؛ این کار عمدی و امن است. برای تست موقتی بدون reverse proxy می‌توانی اجرا کنی:
>
> ```bash
> MUSHAF_BIND_ADDRESS=0.0.0.0 docker compose up --build -d
> ```
>
> برای production بهتر است همین کار را نکنی و از Caddy/Nginx با HTTPS استفاده کنی.

### 19. تست نهایی مرورگر

در مرورگر:

1. صفحهٔ 351 را باز کن؛
2. روی چند کلمه لمس/کلیک کن؛
3. بین صفحه‌های 1، 2، 3، 351 و 604 جابه‌جا شو؛
4. DevTools → Network را باز کن؛
5. مطمئن شو همهٔ SVG و JSON از دامنهٔ خودت لود می‌شوند.

---

## بخش G — بروزرسانی بعدی

### 20. تغییر پروژه و deploy مجدد

روی کامپیوتر خودت:

```bash
git add .
git commit -m "Describe your change"
git push origin main
```

روی سرور Docker:

```bash
cd mushaf-touch
git pull --ff-only
docker compose up --build -d --remove-orphans
```

### 21. بکاپ ضروری

برای مستقل‌بودن واقعی، حداقل از این موارد backup داشته باش:

- repository GitHub خودت؛
- یک clone محلی یا private mirror؛
- release tagهایی مانند `v0.1.0`؛
- نسخهٔ deployشده یا volume/backup سرور.

اگر upstreamها پاک شوند، تا وقتی repository یا backup خودت شامل `vendor/` باشد، build و سایت تو سالم باقی می‌ماند.

---

## چک‌لیست نهایی

```text
[ ] vendor archiveها در Git commit شده‌اند
[ ] python3 scripts/verify-vendored-assets.py پاس شده
[ ] سایت با build-static.sh یا Docker build شده
[ ] asset-mode.js در خروجی local است
[ ] همهٔ درخواست‌های SVG/JSON از دامنهٔ خودت می‌آیند
[ ] HTTPS فعال است
[ ] صفحه‌های 1، 2، 351 و 604 تست شده‌اند
[ ] یک tag نسخه و backup داری
```
