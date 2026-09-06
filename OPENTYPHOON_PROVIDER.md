# OpenTyphoon Provider — WebAi Primary Model

WebAi ใช้ **OpenTyphoon** เป็น primary AI provider ของ V0.1 โดย key ถูกเก็บเฉพาะฝั่ง server ผ่าน environment variable เท่านั้น

## Baseline

```text
Provider   : OpenTyphoon
Model      : typhoon-v2.5-30b-a3b-instruct
Base URL   : https://api.opentyphoon.ai/v1
Protocol   : OpenAI-compatible Chat Completions
```

Official docs: https://docs.opentyphoon.ai/

## Role in WebAi

OpenTyphoon เป็น reasoning layer ของ AI CPU ไม่ใช่ตัวที่ถือ repository หรือแก้ไฟล์โดยตรง

```text
User Request
    ↓
AI CPU
    ↓
OpenTyphoon
    ├─ understand intent
    ├─ classify task
    ├─ plan
    ├─ select skills/rules
    ├─ decide next action
    └─ summarize evidence
    ↓
OMP / ECC / Tools
```

OMP ยังคงเป็น coding worker ที่รับ instruction แล้วลงมือกับ repository

## Provider Boundary

ห้ามผูก Task Engine กับ provider ใด provider หนึ่งโดยตรง

```ts
export interface ModelProvider {
  complete(input: ModelRequest): Promise<ModelResponse>;
  stream(input: ModelRequest): AsyncIterable<ModelChunk>;
  healthCheck(): Promise<ProviderHealth>;
}
```

Implementation baseline:

```text
AI CPU
  ↓
ModelProvider
  ↓
TyphoonProvider
  ↓
OpenAI-compatible HTTP client
  ↓
https://api.opentyphoon.ai/v1
```

ข้อดีคือภายหลังสามารถเพิ่ม fallback หรือ smart routing ได้โดยไม่ต้องรื้อ Task Engine

## Server-side configuration

ใช้ `.env` บน server เท่านั้น:

```env
TYPHOON_API_KEY=<server-side-secret>
TYPHOON_BASE_URL=https://api.opentyphoon.ai/v1
TYPHOON_MODEL=typhoon-v2.5-30b-a3b-instruct
MODEL_PROVIDER=opentyphoon
```

`.env.example` มีเฉพาะ placeholder และ `.gitignore` ต้อง block `.env` ทุกกรณี

## Security Rules

ห้าม:

- commit API key ลง repository
- ฝัง API key ใน `index.html` หรือ JavaScript ฝั่ง browser
- ส่ง API key ผ่าน WebSocket/SSE ไป client
- log `Authorization` header
- ให้ OMP อ่าน environment secrets โดย default
- ให้ generated code เข้าถึง secret store โดยไม่มี policy

## V0.1 Model Tasks

OpenTyphoon รับผิดชอบอย่างน้อย:

1. แปลงคำสั่งธรรมชาติเป็น `TaskSpec`
2. วิเคราะห์ task complexity/risk
3. สร้าง implementation plan แบบ structured
4. สร้าง instruction สำหรับ OMP
5. วิเคราะห์ build/test failure ที่ backend ส่งกลับ
6. เสนอ retry/repair action ภายใต้ policy ของ AI CPU
7. สรุปผลและ evidence ให้ผู้ใช้

ตัวอย่าง `TaskSpec`:

```json
{
  "taskId": "TASK-001",
  "goal": "Add /hello page",
  "risk": "low",
  "acceptance": [
    "GET /hello renders WebAi is running",
    "automated test passes"
  ],
  "suggestedWorker": "omp"
}
```

## First Model Acceptance Test — MODEL-001

Given:

- `TYPHOON_API_KEY` ถูกตั้งใน server environment
- backend เข้าถึง OpenTyphoon API ได้

When:

```text
เพิ่มหน้า /hello ที่แสดง WebAi is running และเพิ่ม test ให้ด้วย
```

Then model response ต้อง parse เป็น structured task ได้ และต้องไม่ส่ง secret หรือ raw environment กลับไป client

## Failure Handling

```text
Request
  ↓
TyphoonProvider
  ├─ 2xx → parse + validate
  ├─ 429 → retry with bounded backoff
  ├─ 5xx → bounded retry
  ├─ timeout → cancel / retry policy
  └─ invalid output → repair once / fail explicitly
```

ทุก model call บันทึก metadata ที่ไม่ใช่ secret:

- provider
- model
- taskId
- latency
- token usage ถ้ามี
- status
- retry count
- parse result

## V0.9 Future Routing

OpenTyphoon ยังคงเป็น baseline ที่ใช้เปรียบเทียบ แม้ภายหลังเพิ่ม provider อื่น

```text
Task
 ↓
Typhoon first
 ↓
Verification / confidence / failure
 ↓
Need escalation?
 ├─ No → continue
 └─ Yes → alternate/stronger provider
```

การมี baseline provider คงที่สำคัญต่อการพิสูจน์ว่า ECC, Hermes, OpenClaw, Harpoon และ learning loop ทำให้ agent เก่งขึ้นจริงหรือไม่
