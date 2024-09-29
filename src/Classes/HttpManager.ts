/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */

import bodyParser from 'body-parser';
import express from 'express';
import { logger } from '../../logger';
import config from '../../config'
import Inventory from './Inventory';
import { getItemCategory } from '../utils';
export default class HttpManager {
    /**
     * The Express.js app.
     */
    protected app: express.Application;
    private inventory: Inventory
    /**
     * Initialize the HTTP manager.
     *
     * @param options - The options list.
     */
    constructor(inv:Inventory) {
        this.app = express();
        this.app.use(bodyParser.json());
        this.app.use(bodyParser.urlencoded({ extended: false }));
        this.inventory = inv
        this.registerRoutes();
    }

    /**
     * Register the routes.
     */
    protected registerRoutes(): void {
        this.app.get('/health', (req, res) => res.send('OK'));
        this.app.get('/uptime', (req, res) => res.json({ uptime: process.uptime() }));
        this.app.get('/inventory/:id', async (req,res)=>{
            try {
                const { id } = req.params; // Extract the 'id' from request parameters
                const inv = await this.inventory.getInventory(id); // Pass the 'id' to your method
                res.json(inv); // Send the inventory data as a JSON response
            } catch (error) {
                res.status(500).json({ error: error });
            }
        })
        this.app.get('/inventory/categories/:id', async(req,res)=>{

            try {
                const { id } = req.params; // Extract the 'id' from request parameters
                const inv = await this.inventory.getInventory(id);
                const cat:any = []
                inv.forEach(i=>{
                    cat.push({name: i.market_hash_name ,category:getItemCategory(i)})
                })
                res.json(cat)
            } catch (error) {
                console.log(error)
                res.status(500).json({ error: error });
            }
        })
    }

    /**
     * Start the server.
     */
    start(): Promise<void> {
        return new Promise(resolve => {
            this.app.listen(config.http.port, () => {
                logger.info(`HTTP Server started: http://127.0.0.1:${config.http.port}`);
               
                resolve();
            });
        });
    }
}