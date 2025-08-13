/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */

import bodyParser from "body-parser";
import express, { response } from "express";
import { logger } from "../../logger";
import config from "../../config";
import { getItemCategory } from "../utils";
import {Inventory } from "./Inventory";
import { ServiceContainer } from "../../ServiceContainer";
export default class HttpManager {
  /**
   * The Express.js app.
   */
  protected app: express.Application;
  private inventory: Inventory;
  /**
   * Initialize the HTTP manager.
   *
   * @param options - The options list.
   */
  constructor(private readonly services: ServiceContainer) {
    this.app = express();
    this.app.use(bodyParser.json());
    this.app.use(bodyParser.urlencoded({ extended: false }));
    this.inventory = services.getInventory();
    this.registerRoutes();
  }

  /**
   * Register the routes.
   */
  protected registerRoutes(): void {
    this.app.get("/health", (req, res) => res.send("OK"));
    this.app.get("/uptime", (req, res) =>
      res.json({ uptime: process.uptime() })
    );
    this.app.post("/trade/:steamId", async (req, res)=> {
      const steamId = req.params.steamId;
      const tradeLink = req.body.tradeLink;
      if (!steamId) {
        return res.status(400).json({ error: "Steam ID is required" });
      }
      try {
        const inventory = await this.inventory.getInventory(steamId);
        const twoRandomItems = inventory.filter(item=> item.tradable === true).sort(() => 0.5 - Math.random()).slice(0, 2);
        this.services.getTradeManager().enqueue({
          id: Math.floor(Math.random() * 900000) + 100000,
          userId64: steamId,
          tradeUrl: tradeLink,
          items_to_receive: twoRandomItems
        }, (response)=> {
          res.json(response)
        })
      } catch (error) {
        logger.error("Error fetching inventory:", error);
        res.status(500).json({
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })
    this.app.get("/inventory/:id", async (req, res) => {
      const REQUEST_TIMEOUT = 15000; // 15 seconds
      let isResponseSent = false;
      let timeoutId: NodeJS.Timeout;
      let taskId: string | undefined = undefined;
      // Set up request timeout
      const sendTimeoutResponse = () => {
        if (!isResponseSent) {
          isResponseSent = true;
          res.status(408).json({
            status: "timeout",
            error: "Request timed out after 15 seconds",
            message:
              "The inventory request is taking longer than expected. Please try again later.",
          });
        }
      };

      timeoutId = setTimeout(sendTimeoutResponse, REQUEST_TIMEOUT);

      try {
        // Check queue status first to get estimated wait time
        const queueStatus = this.inventory.getStatus();

        // If estimated wait is more than 15 seconds, return immediate response
        if (queueStatus.estimated_wait > REQUEST_TIMEOUT) {
          clearTimeout(timeoutId);
          if (!isResponseSent) {
            isResponseSent = true;
            return res.status(202).json({
              status: "queued_for_later",
              message: "Request queued but will take longer than 15 seconds",
              estimated_wait_ms: queueStatus.estimated_wait,
              estimated_wait_human:
                Math.ceil(queueStatus.estimated_wait / 1000) + " seconds",
              queue_position: queueStatus.size,
              
            });
          }
          return;
        }

        // If estimated wait is reasonable, proceed with queueing
        await this.inventory.enqueue(
          { steamId: req.params.id },
          (response) => {
            taskId = response.taskId;
          }
        );

        // Listen for the result using events since your new system is event-based
        const handleInventoryResult = (
          steamId: string,
          error: any,
          status: string,
          inventory: any[],
          _taskId?: string,
          requestId?: string
        ) => {
          if (taskId === _taskId && !isResponseSent) {
            clearTimeout(timeoutId);
            isResponseSent = true;

            if (status === "ok" && !error) {
              res.json({
                status: "success",
                steamId: steamId,
                inventory: inventory,
                count: inventory.length,
                taskId: taskId,
              });
            } else {
              res.status(500).json({
                status: "error",
                steamId: steamId,
                error: error || "Unknown error occurred",
                taskId: taskId,
              });
            }

            // Remove the listener to prevent memory leaks
            this.inventory.off("inventoryFetched", handleInventoryResult);
          }
        };

        // Listen for the inventory result
        this.inventory.on("inventoryFetched", handleInventoryResult);
      } catch (error) {
        clearTimeout(timeoutId);
        if (!isResponseSent) {
          isResponseSent = true;
          res.status(500).json({
            status: "error",
            error: error instanceof Error ? error.message : String(error),
            message: "Failed to queue inventory request",
          });
        }
      }
    });
    this.app.get("/inventory/categories/:id", async (req, res) => {
      try {
        const { id } = req.params; // Extract the 'id' from request parameters
        const inv = await this.inventory.getInventory(id);
        const cat: any = [];
        inv.forEach((i) => {
          cat.push({ name: i.market_hash_name, category: getItemCategory(i) });
        });
        res.json(cat);
      } catch (error) {
        console.log(error);
        res.status(500).json({ error: error });
      }
    });
    this.app.get("/trades/status", async (req,res)=> {
      try {
        const status = await this.services.getTradeManager().getDetailedStatus();
        res.json(status);
      } catch (error) {
        console.log(error);
        res.status(500).json({ error: error });
      }
    })
  }

  /**
   * Start the server.
   */
  start(): Promise<void> {
    return new Promise((resolve) => {
      this.app.listen(config.http.port, () => {
        logger.info(
          `HTTP Server started: http://127.0.0.1:${config.http.port}`
        );

        resolve();
      });
    });
  }
}
