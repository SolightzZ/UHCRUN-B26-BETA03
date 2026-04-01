# UHC eature

## 📟 command.js

| Category  | Feature         | Description (TH)             |
| --------- | --------------- | ---------------------------- |
| Command   | CommandMap      | รวมคำสั่งทั้งหมดไว้ใน map    |
| Register  | Auto Register   | ลงทะเบียนคำสั่งตอนเริ่ม      |
| Execution | Async Execution | ใช้ system.run ป้องกัน crash |
| Error     | Error Handling  | ดัก error runtime            |
| Feedback  | Player Feedback | แจ้งผลลัพธ์ให้ผู้เล่น        |
| Safety    | Safe Wrapper    | ป้องกัน player invalid       |

---

## ⚙️ function.js

| Category  | Feature          | Description (TH)        |
| --------- | ---------------- | ----------------------- |
| Config    | Spawn Config     | ตั้งค่าจุด spawn        |
| Utility   | Batch Processing | รวมงานเพื่อลด lag       |
| Player    | Setup Pipeline   | เตรียม player ก่อนเริ่ม |
| Player    | Reset Pipeline   | รีเซ็ต player           |
| Effects   | Apply Effects    | ให้ effect              |
| Inventory | Starter Items    | แจกไอเทมเริ่มต้น        |
| World     | Command Executor | run command ในโลก       |
| Safety    | Dimension Safe   | ป้องกัน dimension error |

---

## 👥 TeamManager.js

| Category | Feature             | Description (TH)     |
| -------- | ------------------- | -------------------- |
| Team     | Join Team           | เข้าทีม              |
| Team     | Leave Team          | ออกจากทีม            |
| Team     | Set Team            | กำหนดทีม             |
| Storage  | DynamicProperty     | เก็บข้อมูลโลก        |
| Cache    | playerTeamCache     | cache ทีมผู้เล่น     |
| Cache    | teamCounts          | จำนวนผู้เล่นต่อทีม   |
| Cache    | teamPlayerIndex     | index ผู้เล่น        |
| Cache    | uhcPlayersCache     | cache player         |
| Cache    | GlobalPlayerCaches  | cache รวม            |
| UI       | NameTag Color       | แสดงสีทีม            |
| Sync     | Tag Sync            | sync ด้วย tag        |
| Combat   | Hit Registry        | track การโจมตี       |
| Death    | Death UI            | UI ตอนตาย            |
| Logic    | Killer Resolve      | หาผู้ฆ่า             |
| Logic    | Death Queue         | queue การตาย         |
| Announce | First Blood         | kill แรก             |
| Announce | Multi Kill          | kill combo           |
| Announce | Kill Streak         | kill ต่อเนื่อง       |
| Stats    | Player Stats        | สถิติผู้เล่น         |
| Stats    | Team Stats          | สถิติทีม             |
| Stats    | KD Tracking         | อัตราฆ่า/ตาย         |
| UI       | Sidebar Sync        | sync scoreboard      |
| Runtime  | Alive Team Dirty    | trigger update       |
| System   | Async Update        | update แบบ async     |
| System   | Cache Invalidation  | reset cache          |
| System   | Event Hook          | ดัก event            |
| System   | Lifecycle Control   | คุม player lifecycle |
| Optimize | Memory Optimization | ลด memory            |

---

## 🏆 Leaderboard.js

| Category | Feature          | Description (TH) |
| -------- | ---------------- | ---------------- |
| UI       | Top Kill         | อันดับ kill      |
| UI       | Team Ranking     | อันดับทีม        |
| UI       | Death Ranking    | อันดับตาย        |
| Entity   | NPC Display      | แสดงผ่าน entity  |
| Sorting  | Dynamic Sort     | เรียงข้อมูล      |
| Update   | Interval Refresh | อัปเดตอัตโนมัติ  |
| Cache    | Cache Layer      | cache ข้อมูล     |
| System   | Fallback Data    | ใช้ข้อมูลสำรอง   |
| Optimize | Throttle Update  | ลดการ update     |

---

## 🌍 BorderManager.js

| Category | Feature           | Description (TH)       |
| -------- | ----------------- | ---------------------- |
| Shrink   | Multi Phase       | หดหลายช่วง             |
| Timing   | Shrink Timing     | ควบคุมเวลา             |
| Damage   | Border Damage     | ดาเมจขอบ               |
| Render   | Particle Render   | แสดง particle          |
| UI       | Scoreboard        | แสดงข้อมูล             |
| UI       | Dynamic Update    | realtime               |
| Cache    | Score Cache       | cache                  |
| Context  | GameContext       | state เกม              |
| Reset    | Reset System      | รีเซ็ต                 |
| Tick     | Tick Loop         | loop                   |
| Trigger  | Shrink Trigger    | trigger                |
| Color    | Border Color      | สี                     |
| Sequence | End Sequence      | จบเกม                  |
| Sync     | Geometry Sync     | sync                   |
| Compute  | Next Shrink       | คำนวณ                  |
| Display  | Sidebar           | sidebar                |
| Damage   | Scaling Damage    | ดาเมจเพิ่ม             |
| Render   | Particle Batch    | รวม particle           |
| Optimize | Diff Update       | update เฉพาะที่เปลี่ยน |
| Config   | Lookup Table      | ตาราง config           |
| System   | Scheduler         | คุมเวลา                |
| Optimize | Performance Layer | ปรับประสิทธิภาพ        |

---

## 🧱 border.js

| Category | Feature              | Description (TH) |
| -------- | -------------------- | ---------------- |
| Border   | Global Limit         | จำกัดขอบ         |
| Border   | Shrink Check         | ตรวจขอบ          |
| Handler  | Unified Handler      | handler กลาง     |
| Block    | Place Restrict       | ห้ามวาง          |
| Interact | Interaction Restrict | ห้ามใช้          |
| Late     | Build Lock           | ล็อกท้ายเกม      |
| Admin    | Force Shrink         | คำสั่ง admin     |
| System   | Chat Intercept       | ดักคำสั่ง        |
| Anti     | Out-of-map Prevent   | กันออกแมพ        |
| Filter   | UHC Filter           | เฉพาะ UHC        |
| Notify   | Broadcast            | แจ้งเตือน        |
| System   | Event Cancel         | cancel event     |
| Context  | State Mutation       | เปลี่ยน state    |

---

## 🎮 UhcMatchManager.js

| Category  | Feature         | Description (TH) |
| --------- | --------------- | ---------------- |
| Game      | Start Game      | เริ่มเกม         |
| Game      | End Game        | จบเกม            |
| Game      | Reset Game      | รีเซ็ต           |
| Loop      | Game Loop       | loop             |
| Teleport  | Team Group      | จัดทีม           |
| Teleport  | Circular Spawn  | spawn วง         |
| Teleport  | Queue Teleport  | ลด lag           |
| Safety    | Safe Y          | ปลอดภัย          |
| Timer     | Countdown       | นับถอยหลัง       |
| Items     | Starter Kit     | ของเริ่ม         |
| PvP       | Delay Enable    | หน่วง PvP        |
| Win       | Winner Detect   | ทีมชนะ           |
| End       | End Countdown   | จบ               |
| Player    | State Control   | คุม player       |
| Inventory | Reset Inventory | เคลียร์          |
| Effects   | Apply Effects   | effect           |
| Border    | Sync Border     | sync             |
| Cache     | Player Cache    | cache            |
| System    | Teleport Batch  | batch            |
| System    | Abort Teleport  | ยกเลิก           |
| System    | Leader Preload  | preload          |
| Render    | Particle Spawn  | particle         |
| Runtime   | Tick Control    | คุม tick         |
| Optimize  | Memory Reduce   | ลด memory        |

---

# ⚔️ Gameplay Modules

## 🛡️ anticheat_cps.js

| Category  | Feature         | Description (TH) |
| --------- | --------------- | ---------------- |
| AntiCheat | CPS Tracking    | ตรวจ CPS         |
| System    | Circular Buffer | เก็บ tick        |
| Logic     | Sliding Window  | คำนวณย้อนหลัง    |
| Timing    | Tick Filter     | filter tick      |
| Detect    | Hard Limit      | ตรวจเกิน         |
| Action    | Auto Kick       | เตะ              |
| Safety    | Safe Command    | กัน error        |
| Recovery  | Reset Buffer    | รีเซ็ต           |

---

## 🔥 AutoSmelt.js

| Category | Feature         | Description (TH) |
| -------- | --------------- | ---------------- |
| Gameplay | Auto Smelt      | หลอมอัตโนมัติ    |
| Reward   | XP Gain         | ได้ XP           |
| Reward   | Lapis Bonus     | โบนัส            |
| Convert  | Flint → Arrow   | แปลง             |
| Effect   | Heal            | ฟื้นเลือด        |
| Effect   | Absorption      | บัฟ              |
| System   | Tool Check      | ตรวจ tool        |
| Cache    | Tool Cache      | cache            |
| Scan     | Item Radius     | scan             |
| Batch    | Batch System    | รวมงาน           |
| Optimize | Bounding Box    | ลด scan          |
| Optimize | Dedup Entity    | กันซ้ำ           |
| System   | Lapis Aggregate | รวม lapis        |
| System   | Async Flush     | flush            |
| UI       | Toast           | แจ้ง             |
| Sound    | Feedback        | เสียง            |
| System   | Item Table      | mapping          |

---

## 🌲 axe.js

| Category  | Feature         | Description (TH) |
| --------- | --------------- | ---------------- |
| Gameplay  | Tree Capitator  | ตัดต้นไม้        |
| Scan      | Trunk Scan      | scan             |
| Scan      | Leaf BFS        | BFS              |
| System    | Generator Scan  | yield            |
| Reward    | Apple Drop      | apple            |
| Batch     | Break Batch     | batch            |
| Async     | Job System      | async            |
| Queue     | Job Queue       | queue            |
| Limit     | Player Limit    | จำกัด            |
| Limit     | Global Queue    | จำกัด            |
| Control   | Cooldown        | กัน spam         |
| Scheduler | Fair Scheduler  | ยุติธรรม         |
| System    | Concurrency     | จำกัดงาน         |
| System    | Hash Visit      | กันซ้ำ           |
| Balance   | Durability      | ลด durability    |
| Drop      | Batch Drop      | รวม drop         |
| Limit     | Scan Cap        | จำกัด scan       |
| Tick      | Yield Execution | แบ่ง tick        |

---

## 🚫 blockInteractGuard.js

| Category | Feature      | Description (TH) |
| -------- | ------------ | ---------------- |
| Block    | Denylist     | block ห้าม       |
| Detect   | Regex Door   | ตรวจ door        |
| Cache    | Door Cache   | cache            |
| Cache    | Cache Evict  | ล้าง cache       |
| Perm     | Tag Access   | permission       |
| Effect   | Ender KB     | knockback        |
| Sound    | Rotation     | เสียง            |
| System   | Cancel Event | cancel           |
| Cleanup  | Remove Item  | ลบ entity        |

---

## ✨ enchant.js

| Category | Feature       | Description (TH) |
| -------- | ------------- | ---------------- |
| Gameplay | Auto Enchant  | enchant          |
| Enchant  | Efficiency IV | เพิ่ม            |
| Protect  | Lore Marker   | กันซ้ำ           |
| Trigger  | Slot Change   | trigger          |
| Control  | Cooldown      | จำกัด            |
| System   | Lazy Init     | init             |
| Safety   | Clone Item    | clone            |
| UI       | Toast         | แจ้ง             |
| Sound    | Feedback      | เสียง            |

---

## 🎣 fishing_hod.js

| Category | Feature      | Description (TH) |
| -------- | ------------ | ---------------- |
| PvP      | Rod KB       | knockback        |
| Check    | PvP Validate | ตรวจ             |
| Physics  | Normalize    | vector           |
| Physics  | Direction    | ทิศ              |
| Cleanup  | Remove Hook  | ลบ               |
| Sound    | Feedback     | เสียง            |

---

## 📦 ItemPickup.js

| Category | Feature        | Description (TH) |
| -------- | -------------- | ---------------- |
| Gameplay | Auto Smelt     | smelt            |
| System   | Inventory Scan | scan             |
| System   | Slot Tracking  | track            |
| Queue    | Player Entry   | queue            |
| Batch    | Flush System   | batch            |
| Async    | Deferred       | delay            |
| Safety   | Queue Limit    | limit            |
| Reward   | XP             | xp               |
| System   | Container      | access           |
| System   | Scheduler      | schedule         |

---

## 🥊 Knockback.js

| Category | Feature         | Description (TH) |
| -------- | --------------- | ---------------- |
| PvP      | Custom KB       | knockback        |
| Physics  | Normalize       | vector           |
| Control  | Clamp           | จำกัด            |
| Optimize | Throttle        | ลด spam          |
| Physics  | Distance Calc   | คำนวณ            |
| Check    | Player Validate | ตรวจ             |

---

## 🪤 plateKnockback.js

| Category | Feature   | Description (TH) |
| -------- | --------- | ---------------- |
| Trap     | Plate KB  | เด้ง             |
| Physics  | Normalize | vector           |
| Control  | Clamp     | จำกัด            |
| Sound    | Rotation  | เสียง            |

---

## 🎯 projectile_hit_sounds.js

| Category | Feature         | Description (TH) |
| -------- | --------------- | ---------------- |
| Detect   | Projectile      | ตรวจ             |
| System   | Shooter Resolve | หา owner         |
| Sound    | Hit Sound       | เสียง            |
| Filter   | Type Filter     | filter           |

---

## 💣 tnt_instant.js

| Category | Feature      | Description (TH) |
| -------- | ------------ | ---------------- |
| Gameplay | Instant TNT  | ระเบิด           |
| System   | Spawn Entity | spawn            |
| Control  | Player CD    | cooldown         |
| Control  | Global Limit | จำกัด            |
| Timing   | Tick Reset   | รีเซ็ต           |
| Physics  | Offset Spawn | offset           |
| Cleanup  | Player Leave | clear            |

---

## 🧰 Util.js

| Category | Feature       | Description (TH) |
| -------- | ------------- | ---------------- |
| Config   | KB Config     | ค่า KB           |
| Utility  | Clamp         | จำกัด            |
| UI       | Toast         | แจ้ง             |
| UI       | Padding       | จัดข้อความ       |
| System   | Shared Module | ใช้ร่วม          |

---

# 📊 FINAL TOTAL

> **≈ 210+ Features **

---
