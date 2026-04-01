import { system, CustomCommandStatus } from "@minecraft/server";
import { CommandMap } from "./function.js";

system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
  for (const [name, data] of Object.entries(CommandMap)) {
    const { handler, permission } = data;

    customCommandRegistry.registerCommand(
      {
        name,
        description: "CustomCommand",
        permissionLevel: permission,
        cheatsRequired: false,
      },
      (origin) => {
        const source = origin.initiator ?? origin.sourceEntity;

        system.run(() => {
          try {
            handler(source);
          } catch (e) {
            console.warn(`[Command Error] ${name}`, e);
          }
        });

        return { status: CustomCommandStatus.Success };
      },
    );
  }
});
