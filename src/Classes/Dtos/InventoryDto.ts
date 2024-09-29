// import CEconItem from "steamcommunity/classes/CEconItem";
// import { ItemAsset,ItemInv,Sticker } from "../../core/entities/ItemInv";

// export default class InventoryDto {
//     items: ItemInv[];

//     constructor(items: (CEconItem | ItemInv)[]) {
//         this.items = items.map(item => item instanceof ItemInv ? item : new ItemInv(item as CEconItem));
//     }

//     // Method to add an item to the inventory
//     addItem(item: CEconItem | ItemInv): void {
//         this.items.push(item instanceof CEconItem? new ItemInv(item) : item);
//     }

//     // Method to remove an item from the inventory by assetid
//     removeItem(assetid: number | string): void {
//         this.items = this.items.filter(item => item.ceconitem.assetid !== assetid);
//     }

//     // Method to get an item by assetid
//     getItem(assetid: number | string): ItemInv | undefined {
//         return this.items.find(item => item.ceconitem.assetid === assetid);
//     }
// }