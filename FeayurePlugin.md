# 🔌 UHC Plugin Features

---

## 🛡️ anticheat_cps.js (Anti-Cheat System)

**Total: 6 Features**

| Category     | Feature              | Description (TH)                            |
| ------------ | -------------------- | ------------------------------------------- |
| Anti-Cheat   | CPS Tracking         | ตรวจจับจำนวนคลิกต่อวินาที (20 ticks window) |
| Optimization | Circular Buffer      | ใช้ Int32Array ลดการใช้หน่วยความจำ          |
| Anti-Cheat   | Hard Limit Detection | ตรวจจับ CPS เกินค่าที่กำหนด (≥24)           |
| Enforcement  | Auto Kick            | เตะผู้เล่นอัตโนมัติเมื่อโกง                 |
| System       | Player Isolation     | แยก state ของแต่ละผู้เล่น                   |
| Recovery     | Buffer Reset         | รีเซ็ตข้อมูลหลังตรวจพบการโกง                |

---

## 🔥 AutoSmelt.js (Auto Smelt System)

**Total: 11 Features**

| Category     | Feature          | Description (TH)           |
| ------------ | ---------------- | -------------------------- |
| Gameplay     | Auto Smelt       | แร่ถูกหลอมอัตโนมัติ        |
| Reward       | XP System        | ให้ XP จาก resource        |
| Reward       | Lapis Reward     | มีโอกาสได้หนังสือ/ไอเทม    |
| Conversion   | Flint → Arrow    | แปลง flint เป็นลูกธนู      |
| Effect       | Redstone Heal    | redstone ใช้ heal          |
| Effect       | Absorption Buff  | มีโอกาสได้ absorption      |
| Performance  | Batch Processing | รวมงานเพื่อลด lag          |
| Validation   | Tool Check       | ตรวจสอบเครื่องมือก่อนทำงาน |
| System       | Item Scan Radius | ตรวจจับ item รอบ block     |
| UI           | Toast Feedback   | แสดง UI แจ้งเตือน          |
| Optimization | Tool Cache       | cache tool ลด cost         |

---

## 🌲 axe.js (Tree Capitator)

**Total: 12 Features**

| Category     | Feature         | Description (TH)     |
| ------------ | --------------- | -------------------- |
| Gameplay     | Tree Capitator  | ตัดต้นไม้ทั้งต้น     |
| Scan         | Trunk Scan      | scan ลำต้นขึ้น/ลง    |
| Scan         | Leaf BFS        | scan ใบแบบ BFS       |
| Reward       | Apple Drop      | ดรอป apple แบบสุ่ม   |
| Performance  | Batch Break     | ทำลาย block ทีละชุด  |
| System       | Async Job       | ใช้ runJob แบบ async |
| System       | Job Queue       | คิวจัดการงาน         |
| Balance      | Tool Durability | ลด durability        |
| Control      | Cooldown        | ป้องกัน spam         |
| Control      | Job Limit       | จำกัดงานต่อ player   |
| Scheduler    | Fair Scheduling | กระจายงานยุติธรรม    |
| Optimization | Item Batch Drop | รวม item spawn       |

---

## 🚫 blockInteractGuard.js (Block Control)

**Total: 7 Features**

| Category     | Feature              | Description (TH)         |
| ------------ | -------------------- | ------------------------ |
| Protection   | Block Denylist       | ห้ามใช้งาน block บางชนิด |
| Detection    | Door Detection       | ตรวจจับ door/trapdoor    |
| Permission   | Tag Access           | ต้องมี tag "uhc"         |
| Gameplay     | EnderChest Knockback | เปิดแล้วโดน knockback    |
| Feedback     | Sound Rotation       | เสียงเปลี่ยนแบบวน        |
| Optimization | Cache System         | cache block type         |
| Cleanup      | Item Removal         | ลบ hopper minecart       |

---

## ✨ enchant.js (Auto Enchant)

**Total: 7 Features**

| Category   | Feature        | Description (TH)       |
| ---------- | -------------- | ---------------------- |
| Gameplay   | Auto Enchant   | enchant อัตโนมัติ      |
| Enchant    | Efficiency IV  | เพิ่ม Efficiency IV    |
| Protection | Lore Marker    | ป้องกัน enchant ซ้ำ    |
| Trigger    | Hotbar Trigger | ทำงานเมื่อเปลี่ยน slot |
| Control    | Cooldown       | จำกัด tick             |
| UI         | Toast Message  | แจ้งเตือน              |
| Feedback   | Sound Effect   | เล่นเสียง              |

---

## 🎣 fishing_hod.js (Rod PvP)

**Total: 5 Features**

| Category   | Feature          | Description (TH)      |
| ---------- | ---------------- | --------------------- |
| PvP        | Rod Knockback    | ใช้เบ็ด knockback     |
| Validation | PvP Check        | ตรวจ player vs player |
| Physics    | Direction Vector | คำนวณทิศ              |
| Cleanup    | Hook Remove      | ลบ hook หลังใช้       |
| Feedback   | Sound            | เสียงเอฟเฟกต์         |

---

## 📦 ItemPickup.js (Pickup System)

**Total: 6 Features**

| Category    | Feature           | Description (TH) |
| ----------- | ----------------- | ---------------- |
| Gameplay    | Auto Smelt Pickup | ได้ของแล้ว smelt |
| System      | Inventory Scan    | ตรวจ slot        |
| System      | Queue             | เก็บงานเป็นคิว   |
| Performance | Batch Processing  | ทำงานทีเดียว     |
| Reward      | XP Gain           | ได้ XP           |
| Safety      | Overflow Drop     | ของล้น drop      |

---

## 🥊 Knockback.js (PvP KB)

**Total: 4 Features**

| Category     | Feature          | Description (TH)  |
| ------------ | ---------------- | ----------------- |
| PvP          | Custom Knockback | ปรับแรง knockback |
| Physics      | Direction Calc   | คำนวณ vector      |
| Control      | Clamp Limit      | จำกัดแรง          |
| Optimization | Tick Throttle    | ลด spam           |

---

## 🪤 plateKnockback.js (Trap)

**Total: 3 Features**

| Category | Feature         | Description (TH) |
| -------- | --------------- | ---------------- |
| Trap     | Plate Knockback | เหยียบแล้วเด้ง   |
| Physics  | Direction Force | ตามทิศ           |
| Feedback | Sound Rotation  | เสียงสุ่ม        |

---

## 🎯 projectile_hit_sounds.js (Projectile)

**Total: 3 Features**

| Category  | Feature           | Description (TH) |
| --------- | ----------------- | ---------------- |
| Detection | Projectile Detect | ตรวจ projectile  |
| Feedback  | Hit Sound         | ยิงโดนมีเสียง    |
| System    | Shooter Detect    | หาเจ้าของ        |

---

## 💣 tnt_instant.js (TNT System)

**Total: 4 Features**

| Category | Feature         | Description (TH) |
| -------- | --------------- | ---------------- |
| Gameplay | Instant TNT     | TNT ระเบิดทันที  |
| System   | Entity Spawn    | spawn entity     |
| Control  | Player Cooldown | จำกัดต่อ player  |
| Control  | Global Limit    | จำกัดทั้ง server |

---

## 🧰 Util.js (Utility)

**Total: 3 Features**

| Category | Feature          | Description (TH) |
| -------- | ---------------- | ---------------- |
| Config   | Knockback Config | ค่า KB กลาง      |
| Utility  | Clamp Function   | จำกัดค่า         |
| UI       | Dynamic Toast    | UI แจ้งเตือน     |

---

## 📟 command.js (Command System)

**Total: 4 Features**

| Category   | Feature          | Description (TH) |
| ---------- | ---------------- | ---------------- |
| Core       | Command Handler  | จัดการคำสั่ง     |
| Permission | Permission Check | ตรวจสิทธิ์       |
| Gameplay   | Game Commands    | start / stop     |
| Utility    | Argument Parser  | รองรับ argument  |

---

# 📊 Summary

| Module                   | Feature Count |
| ------------------------ | ------------- |
| anticheat_cps.js         | 6             |
| AutoSmelt.js             | 11            |
| axe.js                   | 12            |
| blockInteractGuard.js    | 7             |
| enchant.js               | 7             |
| fishing_hod.js           | 5             |
| ItemPickup.js            | 6             |
| Knockback.js             | 4             |
| plateKnockback.js        | 3             |
| projectile_hit_sounds.js | 3             |
| tnt_instant.js           | 4             |
| Util.js                  | 3             |
| command.js               | 4             |

---

## ⚙️ Total Features

**= 75 Features**
