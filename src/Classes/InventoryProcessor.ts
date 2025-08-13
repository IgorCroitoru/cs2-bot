import { SocketClient } from "../socket";
import { logger } from "../../logger";
import { Inventory } from "./Inventory";
import { Socket } from "socket.io-client";
import {
  InventorySocketEventsIngoing,
  InventorySocketEventsOutgoing,
} from "./Interfaces/SocketEvents";
import { TaskQueueResponse } from "./AbstractTaskQueue";
import { CustomError } from "./CustomError";

export default class InventoryProcessor {
  constructor(
    readonly inventory: Inventory,
    readonly socket: Socket<
      InventorySocketEventsIngoing,
      InventorySocketEventsOutgoing
    >
  ) {}
  async start() {
    this.bindEvents();
  }
  private bindEvents() {
    //SOCKET EVENTS
    this.socket.on("inventoryFetch", async (steamId, callback) => {
      try {
        const result = await new Promise<TaskQueueResponse>((resolve) => {
          this.inventory.enqueue({ steamId }, (response) => {
            resolve(response);
          });
        });
        if (result.status === "queued") {
          callback({
            status: "ok",
            data: result,
          });
        } else {
          callback({
            status: "error",
            error: result.error,
            data: result,
          });
        }
      } catch (e) {
        logger.error(`Error processing inventory fetch for ${steamId}:`, e);
        if (e instanceof CustomError) {
          callback({
            status: "error",
            error: {
              eresult: e.eresult,
              message: e.message,
              cause: e.cause,
            },
          });
        } else {
          callback({
            status: "error",
            error: {
              message: e instanceof Error ? e.message : String(e),
            },
          });
        }
      }
    });
    this.socket.on("pauseInventory", (paused, cause, pauseEnd) => {
      logger.info(`Pausing inventory processor: ${paused} - ${cause}`);
      if (!paused) {
        this.inventory.resume();
        return;
      }
      this.inventory.pause(pauseEnd - Date.now(), cause);
    });
    // Bind inventory events
    this.inventory.bot.on("paused", (paused, cause, pauseEnd) => {
      if (!paused && !this.inventory.isPaused) {
        this.inventory.resume();
      }
    });
    this.inventory.bot.on("ready", (ready) => {
      if (ready && !this.inventory.bot.isPaused && !this.inventory.isPaused) {
        this.inventory.resume();
      }
    });
    this.inventory.on("paused", (paused, cause, pauseEnd) => {
      logger.info(`Inventory processing paused: ${paused} - ${cause}`);
      this.socket.emit("inventoryPaused", paused, cause, pauseEnd);
    });
    this.inventory.on(
      "inventoryFetched",
      (steamId, error, status, inventory) => {
        this.socket.emit("inventoryFetched", steamId, error, status, inventory);
      }
    );
  }
}
