import { system, CustomCommandStatus } from "@minecraft/server";
import { CommandMap } from "./function.js";

system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
  for (const name in CommandMap) {
    const data = CommandMap[name];

    customCommandRegistry.registerCommand(
      {
        name,
        description: "CustomCommand",
        permissionLevel: data.permission,
        cheatsRequired: false,
      },
      (origin) => {
        const source = origin.initiator ?? origin.sourceEntity;

        system.run(() => {
          try {
            data.handler(source);
          } catch (error) {
            console.warn(`[Command Error] ${name}`, error);

            // ส่ง feedback กลับผู้ใช้ เพื่อให้ Admin รู้ว่าคำสั่งพัง
            if (source?.isValid && typeof source.sendMessage === "function") {
              source.sendMessage(
                `§c[Command] §f${name} §cfailed: ${error?.message ?? error}`
              );
            }
          }
        });

        return { status: CustomCommandStatus.Success };
      }
    );
  }
});
