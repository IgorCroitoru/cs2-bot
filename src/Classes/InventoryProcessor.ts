import Inventory from "./Inventory";
import { SocketClient } from "../socket";
import { logger } from "../../logger";
import { NewInventory } from "./NewInventory";
import { Socket } from "socket.io-client";
import { InventorySocketEventsIngoing, InventorySocketEventsOutgoing } from "./Interfaces/SocketEvents";

export default class InventoryProcessor {
  constructor(
    readonly inventory: NewInventory,
    readonly socket: Socket<InventorySocketEventsIngoing, InventorySocketEventsOutgoing>
  ) {}
  async start() {
    this.bindEvents();
  }
  private bindEvents() {
    //SOCKET EVENTS
    this.socket.on("inventoryFetch", (steamId, callback) => {
      this.inventory.enqueue({ steamId }, (response) => {
        try {
          logger.info(`Inventory request for ${steamId}`);
          callback(response);
        } catch (err) {
          callback({
            status: "error",
            error: {
              message: err instanceof Error ? err.message : String(err),
            },
          });
        }
      });
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
