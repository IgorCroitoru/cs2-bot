// import CEconItem from "steamcommunity/classes/CEconItem";
// import GameData, { ItemInfo } from "./GameData";
// import { Bot } from "../Bot";

// export class InspectProcessor {
//   public gameData: GameData;
//   private bot: Bot;

//   constructor(bot: Bot) {
//     //this.gameData = gameData;
//     this.bot = bot;
//     this.gameData = new GameData(undefined, true);
//     this.bindEvents();
//   }

//   bindEvents(): void {
//     this.bot.csClient.on("inspectItemInfo", (itemInfo) => {
//       // try {
//       //   let item = Object.assign({}, itemInfo) as ItemInfo;
//       //     this.gameData.addAdditionalItemProperties(item);
//       //   console.log(JSON.stringify(item, null, 2));
//       // } catch (e) {
//       //   console.log(e);
//       // }
//     });
//   }

//   // public async processItem(item: CEconItem): Promise<void> {
//   //     const iteminfo = await this.gameData.getItemInfo(item);
//   //     if (!iteminfo) return;

//   //     // Process the item information
//   // }
// }
