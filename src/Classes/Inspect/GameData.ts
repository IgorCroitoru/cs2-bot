// eslint-disable-next-line @typescript-eslint/no-var-requires
const vdf = require("simple-vdf") as { parse: (data: string) => any };

import { readFile, writeFile } from "../../lib/files";
import { downloadFile, isValidDir } from "../../utils";
import { logger } from "../../../logger";
import path from "path";
import fs from "fs";
import GlobalOffensive, { InventoryItem } from "globaloffensive";

interface FloatName {
  range: [number, number];
  name: string;
}

interface StickerInfo extends GlobalOffensive.Sticker {
  codename?: string;
  material?: string;
  name?: string;
  tint_id: number | null;
  rotation_x: number | null;
  rotation_y: number | null;
  rotation_z: number | null;
}

interface KeychainInfo extends GlobalOffensive.Sticker {
  name?: string;
  tint_id: number | null;
  rotation_x: number | null;
  rotation_y: number | null;
  rotation_z: number | null;
  pattern: number | null;
}

export interface ItemInfo extends GlobalOffensive.ItemInfo {
  paintindex: number;
  defindex: number;
  rarity: number;
  quality: number;
  origin: number;
  killeatervalue: number | null;
  stickers: StickerInfo[];
  keychains?: KeychainInfo[];
  imageurl?: string;
  min?: number;
  max?: number;
  weapon_type?: string;
  item_name?: string;
  rarity_name?: string;
  quality_name?: string;
  origin_name?: string;
  wear_name?: string;
  full_item_name?: string;
}
export interface InventoryItemInfo extends Omit<GlobalOffensive.InventoryItem, "attribute"> {
  stickers: StickerInfo[];
  keychains?: KeychainInfo[];
  wear_name?: string;
  full_item_name?: string;
  rarity_name?: string;
  quality_name?: string;
  origin_name?: string;
  imageurl?: string;
  assetid: string;
  weapon_type?: string;
  item_name?: string;
}

interface LanguageHandler {
  get(obj: Record<string, any>, prop: string): any;
  has(obj: Record<string, any>, prop: string): boolean;
}

interface ItemsGame {
  sticker_kits: Record<string, any>;
  keychain_definitions: Record<string, any>;
  paint_kits: Record<string, any>;
  items: Record<string, any>;
  prefabs: Record<string, any>;
  rarities: Record<string, any>;
  qualities: Record<string, any>;
}

interface Schema {
  originNames: Array<{ origin: number; name: string }>;
}

const floatNames: FloatName[] = [
  {
    range: [0, 0.07],
    name: "SFUI_InvTooltip_Wear_Amount_0",
  },
  {
    range: [0.07, 0.15],
    name: "SFUI_InvTooltip_Wear_Amount_1",
  },
  {
    range: [0.15, 0.38],
    name: "SFUI_InvTooltip_Wear_Amount_2",
  },
  {
    range: [0.38, 0.45],
    name: "SFUI_InvTooltip_Wear_Amount_3",
  },
  {
    range: [0.45, 1.0],
    name: "SFUI_InvTooltip_Wear_Amount_4",
  },
];

const LanguageHandler: LanguageHandler = {
  get: function (obj: Record<string, any>, prop: string): any {
    return obj[prop.toLowerCase()];
  },
  has: function (obj: Record<string, any>, prop: string): boolean {
    return prop.toLowerCase() in obj;
  },
};

export class GameData {
  private items_game_url: string;
  private items_game_cdn_url: string;
  private csgo_english_url: string;
  private schema_url: string;

  private items_game: ItemsGame | false;
  private items_game_cdn: Record<string, string> | false;
  private csgo_english: Record<string, string> | false;
  private schema: Schema | false;

  private filesDir: string;

  constructor(update_interval?: number, enable_update?: boolean) {
    this.items_game_url =
      "https://raw.githubusercontent.com/SteamDatabase/GameTracking-CS2/master/game/csgo/pak01_dir/scripts/items/items_game.txt";
    this.items_game_cdn_url =
      "https://raw.githubusercontent.com/SteamDatabase/GameTracking-CS2/master/game/csgo/pak01_dir/scripts/items/items_game_cdn.txt";
    this.csgo_english_url =
      "https://raw.githubusercontent.com/SteamDatabase/GameTracking-CS2/master/game/csgo/pak01_dir/resource/csgo_english.txt";
    this.schema_url =
      "https://raw.githubusercontent.com/SteamDatabase/SteamTracking/b5cba7a22ab899d6d423380cff21cec707b7c947/ItemSchema/CounterStrikeGlobalOffensive.json";

    this.items_game = false;
    this.items_game_cdn = false;
    this.csgo_english = false;
    this.schema = false;

    this.filesDir = path.join(process.cwd(), "files");

    // Create the game data folder if it doesn't exist
    if (!isValidDir(this.filesDir)) {
      logger.info("Creating game files directory");
      fs.mkdirSync(this.filesDir, { recursive: true });
    } else {
      // check if we can load the files from disk
      void this.loadFiles();
    }

    if (enable_update) {
      // Update the files
      this.update();

      // Setup interval
      if (update_interval && update_interval > 0) {
        setInterval(() => {
          this.update();
        }, update_interval);
      }
    }
  }

  /*
        Loads items_game, csgo_english, and items_game_cdn from disk
    */
  async loadFiles(): Promise<void> {
    try {
      const itemsGamePath = path.join(this.filesDir, "items_game.txt");
      const itemsGameData = (await readFile(itemsGamePath, false)) as string;
      if (itemsGameData) {
        this.items_game = vdf.parse(itemsGameData)["items_game"] as ItemsGame;
      }
    } catch (error) {
      // File doesn't exist or parse error
    }

    try {
      const csgoEnglishPath = path.join(this.filesDir, "csgo_english.txt");
      const csgoEnglishData = (await readFile(
        csgoEnglishPath,
        false
      )) as string;
      if (csgoEnglishData) {
        const parsed = this.objectKeysToLowerCase(
          vdf.parse(csgoEnglishData)["lang"]["Tokens"]
        );
        this.csgo_english = new Proxy(parsed, LanguageHandler) as Record<
          string,
          string
        >;
      }
    } catch (error) {
      // File doesn't exist or parse error
    }

    try {
      const itemsGameCdnPath = path.join(this.filesDir, "items_game_cdn.txt");
      const itemsGameCdnData = (await readFile(
        itemsGameCdnPath,
        false
      )) as string;
      if (itemsGameCdnData) {
        this.items_game_cdn = this.parseItemsCDN(itemsGameCdnData);
      }
    } catch (error) {
      // File doesn't exist or parse error
    }

    try {
      const schemaPath = path.join(this.filesDir, "schema.json");
      const schemaData = (await readFile(schemaPath, true)) as any;
      if (schemaData && schemaData.result) {
        this.schema = schemaData.result as Schema;
      }
    } catch (error) {
      // File doesn't exist or parse error
    }
  }

  /*
        Parses the data of items_game_cdn
    */
  private parseItemsCDN(data: string): Record<string, string> {
    const lines = data.split("\n");
    const result: Record<string, string> = {};

    for (const line of lines) {
      const kv = line.split("=");

      if (kv[1]) {
        result[kv[0]] = kv[1];
      }
    }

    return result;
  }

  /*
        Calls toLowerCase on all object shallow keys, modifies in-place, not pure
     */
  private objectKeysToLowerCase(obj: Record<string, any>): Record<string, any> {
    const keys = Object.keys(obj);
    let n = keys.length;
    while (n--) {
      const key = keys[n];
      const lower = key.toLowerCase();
      if (key !== lower) {
        obj[lower] = obj[key];
        delete obj[key];
      }
    }

    return obj;
  }

  /*
        Updates and saves the most recent versions of csgo_english, items_game, and items_game_cdn from the SteamDB Github
    */
  update(): void {
    logger.info("Updating Game Files...");

    downloadFile(this.items_game_url, async (data?: string) => {
      if (data) {
        logger.debug("Fetched items_game.txt");
        this.items_game = vdf.parse(data)["items_game"] as ItemsGame;
        await writeFile(
          path.join(this.filesDir, "items_game.txt"),
          data,
          false
        );
      } else logger.error("Failed to fetch items_game.txt");
    });

    downloadFile(this.csgo_english_url, async (data?: string) => {
      if (data) {
        logger.debug("Fetched csgo_english.txt");
        const parsed = this.objectKeysToLowerCase(
          vdf.parse(data)["lang"]["Tokens"]
        );
        this.csgo_english = new Proxy(parsed, LanguageHandler) as Record<
          string,
          string
        >;

        await writeFile(
          path.join(this.filesDir, "csgo_english.txt"),
          data,
          false
        );
      } else logger.error("Failed to fetch csgo_english.txt");
    });

    downloadFile(this.items_game_cdn_url, async (data?: string) => {
      if (data) {
        logger.debug("Fetched items_game_cdn.txt");
        this.items_game_cdn = this.parseItemsCDN(data);
        await writeFile(
          path.join(this.filesDir, "items_game_cdn.txt"),
          data,
          false
        );
      } else logger.error("Failed to fetch items_game_cdn.txt");
    });

    downloadFile(this.schema_url, async (data?: string) => {
      if (data) {
        logger.debug("Fetched schema.json");
        this.schema = JSON.parse(data)["result"] as Schema;
        await writeFile(path.join(this.filesDir, "schema.json"), data, false);
      } else logger.error("Failed to fetch schema.json");
    });
  }

  addAdditionalInventoryItemProperties(itemInfo: InventoryItemInfo) {
    if (!this.items_game || !this.items_game_cdn || !this.csgo_english) return;
    // const itemInfo = Object.assign({}, item) as ItemInfo;
    // Get sticker codename/name
    const stickerKits = this.items_game.sticker_kits;
    for (const sticker of itemInfo.stickers || []) {
      const kit = stickerKits[sticker.sticker_id];

      if (!kit) continue;

      sticker.codename = kit.name;
      sticker.material = kit.sticker_material;

      let name = this.csgo_english[kit.item_name.replace("#", "")];

      if (sticker.tint_id) {
        name += ` (${
          this.csgo_english[`Attrib_SprayTintValue_${sticker.tint_id}`]
        })`;
      }

      if (name) sticker.name = name;
    }
    // Get keychain name
    const keychainDefinitions = this.items_game.keychain_definitions;
    for (const keychain of itemInfo.keychains || []) {
      const kit = keychainDefinitions[keychain.sticker_id];

      if (!kit) continue;

      let name = this.csgo_english[kit.loc_name.replace("#", "")];

      if (name) keychain.name = name;
    }

    // Get the skin name
    let skin_name = "";

    if (itemInfo.paint_index && itemInfo.paint_index in this.items_game["paint_kits"]) {
      skin_name =
        "_" + this.items_game["paint_kits"][itemInfo.paint_index]["name"];

      if (skin_name == "_default") {
        skin_name = "";
      }
    }

    // Get the weapon name
    let weapon_name: string = "";

    if (itemInfo.def_index && itemInfo.def_index in this.items_game["items"]) {
      weapon_name = this.items_game["items"][itemInfo.def_index]["name"];
    }

    // Get the image url
    let image_name = weapon_name + skin_name;

    if (image_name in this.items_game_cdn) {
      itemInfo["imageurl"] = this.items_game_cdn[image_name];
    }

    // Get the paint data and code name
    let code_name: string = "";
    let paint_data: any;

    if (itemInfo.paint_index && itemInfo.paint_index in this.items_game["paint_kits"]) {
      code_name = this.items_game["paint_kits"][itemInfo.paint_index][
        "description_tag"
      ].replace("#", "");
      paint_data = this.items_game["paint_kits"][itemInfo.paint_index];
    }

   

    let weapon_data: any = "";

    if (itemInfo.def_index && itemInfo.def_index in this.items_game["items"]) {
      weapon_data = this.items_game["items"][itemInfo.def_index];
    }

    // Get the weapon_hud
    let weapon_hud: string = "";

    if (
      weapon_data &&
      typeof weapon_data === "object" &&
      "item_name" in weapon_data
    ) {
      weapon_hud = weapon_data["item_name"].replace("#", "");
    } else {
      // need to find the weapon hud from the prefab
      if (itemInfo.def_index && itemInfo.def_index in this.items_game["items"]) {
        let prefab_val = this.items_game["items"][itemInfo.def_index]["prefab"];
        if (
          this.items_game["prefabs"] &&
          prefab_val in this.items_game["prefabs"]
        ) {
          weapon_hud = this.items_game["prefabs"][prefab_val][
            "item_name"
          ].replace("#", "");
        }
      }
    }

    // Get the skin name if we can
    if (
      weapon_hud &&
      weapon_hud in this.csgo_english &&
      code_name &&
      code_name in this.csgo_english
    ) {
      itemInfo.weapon_type = this.csgo_english[weapon_hud];
      itemInfo.item_name = this.csgo_english[code_name];
    }

    // Get the rarity name (Mil-Spec Grade, Covert etc...)
    if (
      this.items_game &&
      typeof this.items_game === "object" &&
      this.items_game.rarities
    ) {
      const rarityKey = Object.keys(this.items_game.rarities).find((key) => {
        return (
          parseInt((this.items_game as ItemsGame).rarities[key]["value"]) ===
          itemInfo.rarity
        );
      });

      if (rarityKey) {
        const rarity = (this.items_game as ItemsGame).rarities[rarityKey];

        // Assumes weapons always have a float above 0 and that other items don't
        // TODO: Improve weapon check if this isn't robust
        itemInfo.paint_wear ? itemInfo.rarity_name =
          this.csgo_english[
            rarity[itemInfo.paint_wear > 0 ? "loc_key_weapon" : "loc_key"]
          ] : undefined;
      }
    }

    // Get the quality name (Souvenir, Stattrak, etc...)
    if (
      this.items_game &&
      typeof this.items_game === "object" &&
      this.items_game.qualities
    ) {
      const qualityKey = Object.keys(this.items_game.qualities).find((key) => {
        return (
          parseInt((this.items_game as ItemsGame).qualities[key]["value"]) ===
          itemInfo.quality
        );
      });

      if (
        qualityKey &&
        this.csgo_english &&
        typeof this.csgo_english === "object"
      ) {
        itemInfo.quality_name = (this.csgo_english as Record<string, string>)[
          qualityKey
        ];
      }
    }

    // Get the origin name
    if (this.schema) {
      const origin = this.schema["originNames"].find(
        (o) => o.origin === itemInfo.origin
      );

      if (origin) {
        itemInfo.origin_name = origin.name;
      }
    }

    // Get the wear name
    const wearName = itemInfo.paint_wear ? this.getWearName(itemInfo.paint_wear) : undefined;
    if (wearName) {
      itemInfo.wear_name = wearName;
    }

    const itemName = this.getFullItemName(itemInfo);
    if (itemName) {
      itemInfo.full_item_name = itemName;
    }
  }
  /*
        Given returned iteminfo, finds the item's min/max float, name, weapon type, and image url using CSGO game data
    */
  addAdditionalItemProperties(itemInfo: ItemInfo) {
    if (!this.items_game || !this.items_game_cdn || !this.csgo_english) return;
    // const itemInfo = Object.assign({}, item) as ItemInfo;
    // Get sticker codename/name
    const stickerKits = this.items_game.sticker_kits;
    for (const sticker of itemInfo.stickers || []) {
      const kit = stickerKits[sticker.sticker_id];

      if (!kit) continue;

      sticker.codename = kit.name;
      sticker.material = kit.sticker_material;

      let name = this.csgo_english[kit.item_name.replace("#", "")];

      if (sticker.tint_id) {
        name += ` (${
          this.csgo_english[`Attrib_SprayTintValue_${sticker.tint_id}`]
        })`;
      }

      if (name) sticker.name = name;
    }
    // Get keychain name
    const keychainDefinitions = this.items_game.keychain_definitions;
    for (const keychain of itemInfo.keychains || []) {
      const kit = keychainDefinitions[keychain.sticker_id];

      if (!kit) continue;

      let name = this.csgo_english[kit.loc_name.replace("#", "")];

      if (name) keychain.name = name;
    }

    // Get the skin name
    let skin_name = "";

    if (itemInfo.paintindex in this.items_game["paint_kits"]) {
      skin_name =
        "_" + this.items_game["paint_kits"][itemInfo.paintindex]["name"];

      if (skin_name == "_default") {
        skin_name = "";
      }
    }

    // Get the weapon name
    let weapon_name: string = "";

    if (itemInfo.defindex in this.items_game["items"]) {
      weapon_name = this.items_game["items"][itemInfo.defindex]["name"];
    }

    // Get the image url
    let image_name = weapon_name + skin_name;

    if (image_name in this.items_game_cdn) {
      itemInfo["imageurl"] = this.items_game_cdn[image_name];
    }

    // Get the paint data and code name
    let code_name: string = "";
    let paint_data: any;

    if (itemInfo.paintindex in this.items_game["paint_kits"]) {
      code_name = this.items_game["paint_kits"][itemInfo.paintindex][
        "description_tag"
      ].replace("#", "");
      paint_data = this.items_game["paint_kits"][itemInfo.paintindex];
    }

    // Get the min float
    if (paint_data && "wear_remap_min" in paint_data) {
      itemInfo["min"] = parseFloat(paint_data["wear_remap_min"]);
    } else itemInfo["min"] = 0.06;

    // Get the max float
    if (paint_data && "wear_remap_max" in paint_data) {
      itemInfo["max"] = parseFloat(paint_data["wear_remap_max"]);
    } else itemInfo["max"] = 0.8;

    let weapon_data: any = "";

    if (itemInfo.defindex in this.items_game["items"]) {
      weapon_data = this.items_game["items"][itemInfo.defindex];
    }

    // Get the weapon_hud
    let weapon_hud: string = "";

    if (
      weapon_data &&
      typeof weapon_data === "object" &&
      "item_name" in weapon_data
    ) {
      weapon_hud = weapon_data["item_name"].replace("#", "");
    } else {
      // need to find the weapon hud from the prefab
      if (itemInfo.defindex in this.items_game["items"]) {
        let prefab_val = this.items_game["items"][itemInfo.defindex]["prefab"];
        if (
          this.items_game["prefabs"] &&
          prefab_val in this.items_game["prefabs"]
        ) {
          weapon_hud = this.items_game["prefabs"][prefab_val][
            "item_name"
          ].replace("#", "");
        }
      }
    }

    // Get the skin name if we can
    if (
      weapon_hud &&
      weapon_hud in this.csgo_english &&
      code_name &&
      code_name in this.csgo_english
    ) {
      itemInfo.weapon_type = this.csgo_english[weapon_hud];
      itemInfo.item_name = this.csgo_english[code_name];
    }

    // Get the rarity name (Mil-Spec Grade, Covert etc...)
    if (
      this.items_game &&
      typeof this.items_game === "object" &&
      this.items_game.rarities
    ) {
      const rarityKey = Object.keys(this.items_game.rarities).find((key) => {
        return (
          parseInt((this.items_game as ItemsGame).rarities[key]["value"]) ===
          itemInfo.rarity
        );
      });

      if (rarityKey) {
        const rarity = (this.items_game as ItemsGame).rarities[rarityKey];

        // Assumes weapons always have a float above 0 and that other items don't
        // TODO: Improve weapon check if this isn't robust
        itemInfo.rarity_name =
          this.csgo_english[
            rarity[itemInfo.paintwear > 0 ? "loc_key_weapon" : "loc_key"]
          ];
      }
    }

    // Get the quality name (Souvenir, Stattrak, etc...)
    if (
      this.items_game &&
      typeof this.items_game === "object" &&
      this.items_game.qualities
    ) {
      const qualityKey = Object.keys(this.items_game.qualities).find((key) => {
        return (
          parseInt((this.items_game as ItemsGame).qualities[key]["value"]) ===
          itemInfo.quality
        );
      });

      if (
        qualityKey &&
        this.csgo_english &&
        typeof this.csgo_english === "object"
      ) {
        itemInfo.quality_name = (this.csgo_english as Record<string, string>)[
          qualityKey
        ];
      }
    }

    // Get the origin name
    if (this.schema) {
      const origin = this.schema["originNames"].find(
        (o) => o.origin === itemInfo.origin
      );

      if (origin) {
        itemInfo.origin_name = origin.name;
      }
    }

    // Get the wear name
    const wearName = this.getWearName(itemInfo.paintwear);
    if (wearName) {
      itemInfo.wear_name = wearName;
    }

    const itemName = this.getFullItemName(itemInfo);
    if (itemName) {
      itemInfo.full_item_name = itemName;
    }
  }

  getWearName(float: number): string | undefined {
    const f = floatNames.find((f) => float > f.range[0] && float <= f.range[1]);

    if (f && this.csgo_english && typeof this.csgo_english === "object") {
      return (this.csgo_english as Record<string, string>)[f["name"]];
    }
  }

  getFullItemName(iteminfo: ItemInfo | InventoryItemInfo): string {
    let name = "";

    // Default items have the "unique" quality
    if (iteminfo.quality !== 4) {
      name += `${iteminfo.quality_name} `;
    }
    const killeaterValue = 'killeatervalue' in iteminfo 
    ? (iteminfo as ItemInfo).killeatervalue 
    : (iteminfo as InventoryItemInfo).kill_eater_value;
    // Patch for items that are stattrak and unusual (ex. Stattrak Karambit)
    if (
      !killeaterValue &&
      iteminfo.quality !== 9 &&
      this.csgo_english &&
      typeof this.csgo_english === "object"
    ) {
      name += `${(this.csgo_english as Record<string, string>)["strange"]} `;
    }

    name += `${iteminfo.weapon_type} `;

    if (
      iteminfo.weapon_type === "Sticker" ||
      iteminfo.weapon_type === "Sealed Graffiti"
    ) {
      if (iteminfo.stickers && iteminfo.stickers[0]) {
        name += `| ${iteminfo.stickers[0].name}`;
      }
    } else if (iteminfo.weapon_type === "Charm") {
      if (iteminfo.keychains && iteminfo.keychains[0]) {
        name += `| ${iteminfo.keychains[0].name}`;
      }
    }

    // Vanilla items have an item_name of '-'
    if (iteminfo.item_name && iteminfo.item_name !== "-") {
      name += `| ${iteminfo.item_name} `;

      if (iteminfo.wear_name) {
        name += `(${iteminfo.wear_name})`;
      }
    }

    return name.trim();
  }
}

export default GameData;
