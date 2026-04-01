# UHC Feature Documentation

## command.js (Command System)

**Total: 4 Features**

| Category  | Feature                   | Description (TH)             |
| --------- | ------------------------- | ---------------------------- |
| Command   | CommandMap binding        | ใช้ map รวมคำสั่งทั้งหมด     |
| Register  | Auto register             | register command ตอน startup |
| Execution | Async execution           | ใช้ system.run ป้องกัน crash |
| Error     | Error handling + feedback | แจ้ง error กลับ player       |

อ้างอิง:

---

## function.js (Command Logic / Utilities)

**Total: 6 Features**

| Category  | Feature                | Description (TH)         |
| --------- | ---------------------- | ------------------------ |
| Config    | Spawn config           | กำหนด spawn              |
| Utility   | batch processing       | ทำงานเป็น batch ลด lag   |
| Player    | Setup / reset pipeline | setup player             |
| Effects   | Apply effects          | ให้ effect               |
| Inventory | Starter item           | แจก compass              |
| World     | Command executor       | run command ใน dimension |

อ้างอิง:

---

## TeamManager.js (Core System)

**Total: 18 Features**

| Category  | Feature                  | Description (TH) |
| --------- | ------------------------ | ---------------- |
| Team      | Join / Leave / Set team  | ระบบทีม          |
| Storage   | DynamicProperty          | เก็บข้อมูลโลก    |
| Cache     | playerTeamCache          | cache team       |
| Cache     | teamCounts               | จำนวนทีม         |
| Cache     | teamPlayerIndex          | index player     |
| Cache     | uhcPlayersCache          | cache UHC        |
| UI        | NameTag color            | แสดงสีทีม        |
| Sync      | Tag sync                 | sync ด้วย tag    |
| Combat    | hitRegistry              | track hit        |
| Death     | Death UI system          | UI ตอนตาย        |
| Logic     | Killer resolve           | หา killer        |
| Announcer | First Blood              | kill แรก         |
| Announcer | Multi Kill               | kill combo       |
| Announcer | Kill Streak              | streak           |
| Stats     | playerStats              | stats ผู้เล่น    |
| Stats     | teamStats                | stats ทีม        |
| Cache     | GlobalPlayerCaches       | cache global     |
| Runtime   | Alive team dirty handler | update UI        |

อ้างอิง:

---

## Leaderboard.js (Leaderboard UI)

**Total: 6 Features**

| Category | Feature           | Description (TH) |
| -------- | ----------------- | ---------------- |
| UI       | Top players kills | อันดับ kill      |
| UI       | Team ranking      | อันดับทีม        |
| UI       | Death ranking     | คนตายมาก         |
| Entity   | NPC display       | แสดงผ่าน entity  |
| Sorting  | Dynamic sort      | เรียงข้อมูล      |
| Update   | Interval refresh  | อัปเดตอัตโนมัติ  |

อ้างอิง:

---

## BlockFiller.js (Mass Block Engine)

**Total: 14 Features**

| Category    | Feature                 | Description (TH)  |
| ----------- | ----------------------- | ----------------- |
| Fill        | Massive block fill      | เติมบล็อกจำนวนมาก |
| Mode        | Multi mode (ore/nether) | โหมด block        |
| Queue       | Task queue              | คิวงาน            |
| Retry       | Retry queue             | retry             |
| Batch       | Adaptive batch          | ปรับ batch        |
| Cache       | Block cache             | cache block       |
| Random      | Fast RNG                | random เร็ว       |
| Limit       | Queue cap               | จำกัด             |
| Performance | Pending tracking        | track load        |
| Tick        | Main loop               | loop              |
| Cleanup     | Queue compact           | ล้าง queue        |
| Endgame     | High-speed fill         | เร่งท้าย          |
| Chunk       | Chunk awareness         | ตรวจ chunk        |
| Metrics     | Runtime metrics         | วัด performance   |

อ้างอิง:

---

## border.js (Enforcement Layer)

**Total: 10 Features**

| Category   | Feature                 | Description (TH) |
| ---------- | ----------------------- | ---------------- |
| Border     | Global limit            | จำกัดแมพ         |
| Border     | Shrinking check         | ตรวจวง           |
| Handler    | Unified handler         | handler กลาง     |
| Block      | Place block restriction | ห้ามวาง          |
| Interact   | Interaction control     | ห้ามใช้          |
| Late Game  | Build lock              | ล็อกท้าย         |
| Admin      | !fill command           | force shrink     |
| Anti Cheat | Out-of-map prevent      | กันออก           |
| Filter     | UHC filter              | เฉพาะ UHC        |
| Notify     | Broadcast               | แจ้งเตือน        |

อ้างอิง:

---

## BorderManager.js (Core Border Engine)

**Total: 16 Features**

| Category | Feature            | Description (TH) |
| -------- | ------------------ | ---------------- |
| Shrink   | Multi-phase shrink | หดหลายช่วง       |
| Timing   | Shrink timing      | เวลา             |
| Damage   | Border damage      | ดาเมจ            |
| Particle | Border render      | particle         |
| UI       | Scoreboard         | แสดงข้อมูล       |
| UI       | Dynamic update     | realtime         |
| Cache    | Score cache        | cache            |
| Context  | GameContext        | state            |
| Reset    | Reset system       | reset            |
| Tick     | Tick-based logic   | tick             |
| Trigger  | Shrink trigger     | trigger          |
| Color    | Border color       | สี               |
| Sequence | End sequence       | endgame          |
| Sync     | Geometry sync      | sync             |
| Compute  | Next shrink calc   | คำนวณ            |
| Display  | Sidebar system     | sidebar          |

อ้างอิง:

---

## UhcMatchManager.js (Game Engine)

**Total: 18 Features**

| Category     | Feature         | Description (TH) |
| ------------ | --------------- | ---------------- |
| Game Control | Start game      | เริ่มเกม         |
| Game Control | End game        | จบเกม            |
| Game Control | Reset game      | รีเซ็ต           |
| Loop         | Game loop       | loop             |
| Teleport     | Team grouping   | จัดทีม           |
| Teleport     | Circular spawn  | กระจายวง         |
| Teleport     | Queue teleport  | ลด lag           |
| Safety       | Safe Y          | ปลอดภัย          |
| Countdown    | Start countdown | นับถอยหลัง       |
| Items        | Starter kit     | ของเริ่ม         |
| PVP          | Delay enable    | หน่วง            |
| Victory      | Winner detect   | ทีมชนะ           |
| End          | End countdown   | จบ               |
| Player       | State control   | คุม player       |
| Inventory    | Reset inventory | เคลียร์          |
| Effects      | Apply effects   | effect           |
| Border       | Border sync     | เชื่อม           |
| Cache        | Player cache    | ลด lag           |

อ้างอิง:

---

# Summary

| Module             | Feature Count   |
| ------------------ | --------------- |
| command.js         | 4               |
| function.js        | 6               |
| TeamManager.js     | 18              |
| Leaderboard.js     | 6               |
| BlockFiller.js     | 14              |
| border.js          | 10              |
| BorderManager.js   | 16              |
| UhcMatchManager.js | 18              |
| **TOTAL**          | **92 Features** |

---
