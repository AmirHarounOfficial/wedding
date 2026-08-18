# الرفع على Vercel

## ليه محتاج قاعدة بيانات

Vercel سيرفرلس — نظام الملفات عنده **للقراءة بس**. يعني الطريقة القديمة
(الكتابة في `data.php`) مش هتشتغل خالص هناك. الردود لازم تروح لمكان تاني،
وأسهل حاجة Upstash Redis وهي مجانية وبتتعمل من جوه Vercel نفسه.

الدعوة نفسها HTML عادي — دي شغالة على Vercel من غير أي حاجة.

---

## الملفات

```
invitation.html     الدعوة
admin.html          صفحتك
api/guests.js       بيستقبل الردود  (بدون أي dependencies)
vercel.json         عشان "/" تفتح الدعوة
```

---

## الخطوات

### ١. ارفع المشروع

من الموقع: <https://vercel.com/new> → Import → ارفع الفولدر أو اربطه بـ GitHub.
مفيش build command ولا framework — اختار **Other**.

أو من الترمنال:

```bash
npx vercel
```

### ٢. اعمل قاعدة البيانات

Vercel → المشروع → **Storage** → **Create** → **Upstash for Redis** → Connect.

ده بيضيف `KV_REST_API_URL` و `KV_REST_API_TOKEN` لوحده. مش محتاج تعمل حاجة.

### ٣. حط كلمة الدخول

Vercel → Settings → **Environment Variables** → Add:

```
ADMIN_KEY = اكتب-كلمة-صعبة-هنا
```

### ٤. Redeploy

Deployments → آخر واحد → ⋯ → **Redeploy**.
لازم، عشان المتغيرات الجديدة تشتغل.

---

## الروابط

- الدعوة → `https://اسم-المشروع.vercel.app/`
- صفحتك → `https://اسم-المشروع.vercel.app/admin.html?key=كلمتك`

## لو حاجة مش شغالة

```
https://اسم-المشروع.vercel.app/api/guests?action=check&key=كلمتك
```

| النتيجة | يعني إيه |
|---|---|
| `storeConfigured: false` | خطوة ٢ ناقصة (أو نسيت Redeploy) |
| `storeReachable: false` | القاعدة اتعملت بس مش شغالة — شوف `storeError` |
| `adminKeyFromEnv: false` | خطوة ٣ ناقصة — شغال بالكلمة الافتراضية |
| `401` | الكلمة غلط |

---

## ♪ الموسيقى

ارفع `music.mp3` جنب `invitation.html`، وفي `CONFIG` غيّر:

```js
audio: { src: 'music.mp3', volume: 0.45 },
```

ارفع تاني (`npx vercel --prod` أو push على GitHub).

---

## ملاحظات

- `CONFIG.api` في `invitation.html` و `API` في `admin.html` لازم يكونوا
  `'/api/guests'` لـ Vercel، أو `'api.php'` لـ aaPanel.
- الطبقة المجانية في Upstash أكتر من كفاية لفرح.
- **اعمل export للردود قبل الفرح** — زرار «تنزيل CSV» في صفحتك.
