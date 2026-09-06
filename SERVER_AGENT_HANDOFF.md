# Server Agent Handoff — WebAi ENV Capability Registry

เป้าหมายของ PR นี้คือส่งงานให้ agent ฝั่ง VPS/Server นำ ENV capability registry ที่อยู่บน `main` ไปใช้กับเซิร์ฟเวอร์จริง โดยต้องรักษา OpenTyphoon secure proxy ที่ทำงานอยู่แล้ว และห้ามเปิดเผย secret ลง Git หรือ log

## สิ่งที่มีอยู่แล้วบน main

- OpenTyphoon secure proxy ใช้งานอยู่
- `/api/health` รองรับ capability registry
- `/api/typhoon/chat` ใช้งานได้
- `/api/omp/prompt` มีอยู่แล้วแบบ opt-in ผ่าน `OMP_ENABLED=true`
- UI อ่าน capability status จาก `/api/health`
- `.env.example` มีช่องสำหรับ Typhoon, OMP, ECC, Hermes, OpenClaw, Harpoon และ Preview

## กฎสำคัญ

1. ห้ามเขียน `TYPHOON_API_KEY` หรือ secret อื่นลง repository
2. ห้ามแทนที่ `.env` จริงด้วย `.env.example` ตรง ๆ
3. ให้ backup `.env` ปัจจุบันก่อนทุกครั้ง
4. รักษาค่า OpenTyphoon ที่ใช้งานได้อยู่แล้ว
5. เปิด subsystem ทีละตัวหลังตรวจ dependency ครบ
6. ถ้า dependency ยังไม่พร้อม ให้คง `*_ENABLED=false`
7. ห้ามให้ browser กำหนด workspace path หรือ upstream secret
8. หลังแก้ทุกครั้งต้อง restart service และทดสอบ `/api/health`

## ขั้นตอนแรก — Sync code

บน VPS ให้หา WorkingDirectory ของ service ปัจจุบันก่อน:

```bash
systemctl cat webai-typhoon-proxy 2>/dev/null || true
systemctl status webai-typhoon-proxy --no-pager || true
```

ถ้า service ใช้ชื่ออื่น ให้ค้นหา service ที่รัน WebAi proxy แล้วใช้ WorkingDirectory ของ service นั้น

จากนั้น sync `main` ล่าสุด:

```bash
git status
git fetch origin
git checkout main
git pull --ff-only origin main
```

ห้าม reset/clean แบบทำลายไฟล์ local ที่ยังไม่ได้ตรวจ

## ขั้นตอนสอง — Backup ENV จริง

หา `EnvironmentFile` จาก systemd service แล้ว backup ก่อน:

```bash
cp /path/to/current/.env /path/to/current/.env.backup-$(date +%Y%m%d-%H%M%S)
```

อย่าแสดงค่าของ `.env` ทั้งไฟล์ใน terminal log ที่อาจถูกบันทึก

## ENV Registry ที่ต้องรองรับ

รักษาค่าจริงเดิมของ OpenTyphoon:

```env
TYPHOON_API_KEY=<KEEP_EXISTING_SECRET>
TYPHOON_BASE_URL=https://api.opentyphoon.ai/v1
TYPHOON_MODEL=typhoon-v2.5-30b-a3b-instruct
```

เพิ่มค่าที่ขาดตาม environment จริงของ VPS:

```env
PORT=8787
ALLOWED_ORIGINS=https://nustanakritwithai.github.io
WEB_AUTH_TOKEN=
WEBAI_WORKSPACE=/srv/webai/workspace

OMP_ENABLED=false
OMP_COMMAND=omp
OMP_PROVIDER=opentyphoon
OMP_MODEL=typhoon-v2.5-30b-a3b-instruct

ECC_ENABLED=false
ECC_ROOT=/srv/webai/ecc

HERMES_ENABLED=false
HERMES_HOME=/srv/webai/hermes

OPENCLAW_ENABLED=false
OPENCLAW_URL=http://127.0.0.1:18789

HARPOON_ENABLED=false
HARPOON_URL=http://127.0.0.1:9000

PREVIEW_ENABLED=false
PREVIEW_BASE_URL=http://127.0.0.1:4173
```

Path เป็น baseline เท่านั้น ถ้า VPS ใช้ path อื่น ให้ใช้ path จริงและรายงานกลับใน PR

## OMP — เปิดเมื่อพร้อมเท่านั้น

ตรวจ OMP ก่อน:

```bash
command -v omp
omp --help >/dev/null
```

ตรวจ workspace:

```bash
test -d "$WEBAI_WORKSPACE"
test -w "$WEBAI_WORKSPACE"
```

ถ้า OMP binary และ workspace พร้อม ให้เปลี่ยน:

```env
OMP_ENABLED=true
```

ถ้าอย่างใดอย่างหนึ่งไม่พร้อม ให้คง `false` และรายงาน blocker

ห้ามเปิด OMP โดยชี้ workspace ไปยัง `/`, home ทั้งหมด หรือ directory ที่กว้างเกินจำเป็น

## ECC / Hermes / OpenClaw / Harpoon

รอบนี้ให้เปิดเฉพาะ subsystem ที่ติดตั้งและมี endpoint/path จริงบน VPS แล้วเท่านั้น

ตัวอย่างเงื่อนไข:

- ECC: `ECC_ROOT` มีอยู่จริง
- Hermes: `HERMES_HOME` มีอยู่จริง
- OpenClaw: endpoint ตอบได้จาก localhost
- Harpoon: endpoint ตอบได้จาก localhost

ถ้ายังไม่ได้ติดตั้ง ให้คง `false` ไม่ต้องติดตั้งโดยเดา configuration เอง

## Restart service

หลังแก้ ENV:

```bash
sudo systemctl daemon-reload
sudo systemctl restart webai-typhoon-proxy
sudo systemctl status webai-typhoon-proxy --no-pager
```

ถ้า service ใช้ชื่ออื่น ให้ใช้ชื่อจริงและรายงานกลับ

## Acceptance — Health

ทดสอบ local ก่อน:

```bash
curl -fsS http://127.0.0.1:8787/api/health
```

response ต้องมีอย่างน้อย:

```json
{
  "ok": true,
  "typhoonConfigured": true,
  "ompEnabled": false,
  "capabilities": {
    "typhoon": {},
    "omp": {},
    "ecc": {},
    "hermes": {},
    "openclaw": {},
    "harpoon": {},
    "preview": {}
  }
}
```

`ompEnabled` สามารถเป็น `true` ได้เมื่อ OMP พร้อมจริง

## Acceptance — Live Typhoon

ยิงผ่าน public proxy endpoint ปัจจุบัน:

```bash
curl -fsS -X POST 'https://<PUBLIC_BACKEND>/api/typhoon/chat' \
  -H 'Content-Type: application/json' \
  --data '{"messages":[{"role":"user","content":"ตอบคำว่า WEBAPI_OK เท่านั้น"}],"temperature":0.1,"max_tokens":32}'
```

ต้องได้รับ OpenTyphoon response จริง และ response/log ต้องไม่มี API key

## Acceptance — OMP

ทำเฉพาะเมื่อ `OMP_ENABLED=true`:

```bash
curl -fsS -X POST 'http://127.0.0.1:8787/api/omp/prompt' \
  -H 'Content-Type: application/json' \
  --data '{"prompt":"Inspect this workspace and return only the project name. Do not edit files."}'
```

ต้องได้ `worker: omp` / `ok: true` โดยไม่แก้ไฟล์

ก่อนอนุญาตงาน edit จริง ให้ตรวจว่า OMP cwd อยู่ใน `WEBAI_WORKSPACE` ที่ตั้งใจไว้

## Security Verification

ยืนยันทั้งหมด:

- [ ] `.env` ไม่ tracked โดย Git
- [ ] API key ไม่อยู่ใน `git diff`
- [ ] API key ไม่อยู่ใน service logs
- [ ] `/api/health` คืนเฉพาะ boolean/status ไม่คืน secret
- [ ] CORS อนุญาต GitHub Pages ของ WebAi
- [ ] process ฟัง localhost หลัง reverse proxy ตามเดิม
- [ ] OMP ใช้ workspace จำกัดขอบเขต

## สิ่งที่ Server Agent ต้องรายงานกลับใน PR

โพสต์ comment ใน PR นี้พร้อม:

1. service name ที่ใช้งานจริง
2. WorkingDirectory
3. EnvironmentFile path — รายงาน path เท่านั้น ห้ามรายงานค่า secret
4. public backend URL
5. `/api/health` sanitized JSON
6. Typhoon live-call = PASS/FAIL
7. OMP installed = YES/NO
8. OMP enabled = YES/NO
9. ECC/Hermes/OpenClaw/Harpoon/Preview status
10. `systemctl status` summary
11. blockers ถ้ามี
12. ยืนยันว่าไม่มี secret ถูก commit หรือ log

## Definition of Done สำหรับ Server Handoff

```text
Existing Typhoon proxy        PASS
ENV registry applied          PASS
/api/health capabilities      PASS
Secret exposure check         PASS
Service restart               PASS
Public health check           PASS
Typhoon live call             PASS
OMP safe check                PASS / NOT ENABLED WITH REASON
```

ห้ามเปิด subsystem ที่ยังไม่มี dependency จริงเพียงเพื่อให้หน้า UI เป็นสีเขียว
