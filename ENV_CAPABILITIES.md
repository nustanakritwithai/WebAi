# WebAi ENV Capability Registry

WebAi ใช้ `.env` ฝั่ง VPS เป็น source of truth สำหรับการเปิด/ปิดและกำหนดค่าของ subsystem ต่าง ๆ โดย API key และ secret ทุกชนิดต้องอยู่ฝั่ง server เท่านั้น

## Capability groups

- OpenTyphoon: `TYPHOON_API_KEY`, `TYPHOON_BASE_URL`, `TYPHOON_MODEL`
- WebAi server: `PORT`, `ALLOWED_ORIGINS`, `WEB_AUTH_TOKEN`, `WEBAI_WORKSPACE`
- OMP: `OMP_ENABLED`, `OMP_COMMAND`, `OMP_PROVIDER`, `OMP_MODEL`
- ECC: `ECC_ENABLED`, `ECC_ROOT`
- Hermes: `HERMES_ENABLED`, `HERMES_HOME`
- OpenClaw: `OPENCLAW_ENABLED`, `OPENCLAW_URL`
- Harpoon: `HARPOON_ENABLED`, `HARPOON_URL`
- Preview: `PREVIEW_ENABLED`, `PREVIEW_BASE_URL`

`GET /api/health` ต้องรายงานเฉพาะ metadata เช่น enabled/configured และห้ามส่งค่าของ secret กลับ browser

## Status meanings

- `enabled=false` = ปิดระบบนั้นไว้
- `enabled=true, configured=false` = เปิดไว้ แต่ ENV ที่จำเป็นยังไม่ครบ
- `enabled=true, configured=true` = ตั้งค่าพร้อมสำหรับขั้น integration

คำว่า `configured` ไม่เท่ากับการยืนยันว่า external service ออนไลน์จริง เว้นแต่มี health probe เฉพาะของ integration นั้น
