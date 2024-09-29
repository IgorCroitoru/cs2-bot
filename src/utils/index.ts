import CEconItem from "steamcommunity/classes/CEconItem";
import { StatusType } from "../Classes/Interfaces/SocketEvents";
import { Sticker } from "../core/entities/ItemInv";
import { EFullCategory, EGlovesCategory, fullCategorySet, glovesCategorySet } from "./category-enums";

export function delay(ms:number) {
    return new Promise(resolve => setTimeout(resolve, ms));
};

export function exponentialBackoff(n: number, base = 1000): number {
    return Math.pow(2, n) * base + Math.floor(Math.random() * base);
}

export function  getInspectUrl(actions:any[],id64: string, assetId:number): string | null {
    if (!actions || !actions[0] || !actions[0].link) {
        return null;
    }
    const link = actions[0].link;
    return link
        .replace("%owner_steamid%", id64)
        .replace("%assetid%", assetId.toString())
        .replace('%20', '');
}


export function getNameTag(fraud: any[]): string | null {
    if (Array.isArray(fraud) && fraud.length > 0) {
        const fullTag = fraud[0];
        if (typeof fullTag === 'string' && fullTag.length > 13) {
            const stringWithoutFirst11 = fullTag.substring(12);
            const stringWithoutLast2 = stringWithoutFirst11.slice(0, -2);
            return stringWithoutLast2;
        }
    }
    return null; // Return undefined if input is invalid or no warnings
}
/**
 * Extracts stickers from the last description in the provided array.
 * @param descriptions Array of item descriptions
 * @returns Array of Sticker objects extracted from the HTML content of the last description
 */
export function getStickers(descriptions: any[]): Sticker[] | null {
    let htmlContent: string = '';

    // Check if descriptions array exists and the last description has a non-empty value
    if (descriptions && descriptions.length > 0 && descriptions[descriptions.length - 1].value.trim() !== '') {
        htmlContent = descriptions[descriptions.length - 1].value;

        try {
            const srcRegex = /src="([^"]+)"/g;
            const stickerSrcMatches = htmlContent.match(srcRegex);

            const nameRegex = /Sticker: ([^<]+)/g;
            const stickerNameMatches = htmlContent.match(nameRegex);

            if (!stickerSrcMatches || !stickerNameMatches) {
                return null; // Return undefined if no matches found
            }

            const stickers: Sticker[] = [];
            const names = stickerNameMatches[0].replace('Sticker: ', '').split(', ');

            stickerSrcMatches.forEach((src, index) => {
                stickers.push(new Sticker(names[index], src.replace('src="', '').replace('"', '')));
            });

            return stickers;
        } catch (error) {
            return null; // Return undefined on error
        }
    }

    return null; // Return undefined if descriptions are empty or last description is empty
}

export function ensureArray<T>(itemOrArray: T | T[]): T[] {
    return Array.isArray(itemOrArray) ? itemOrArray : [itemOrArray];
}


// "Invalid": 1;
// /* This trade offer has been sent, neither party has acted on it yet. */
// "Active": 2;
// /* The trade offer was accepted by the recipient and items were exchanged. */
// "Accepted": 3;
// /* The recipient made a counter offer */
// "Countered": 4;
// /* The trade offer was not accepted before the expiration date */
// "Expired": 5;
// /* The sender cancelled the offer */
// "Canceled": 6;
// /* The recipient declined the offer */
// "Declined": 7;
// /* Some of the items in the offer are no longer available (indicated by the missing flag in the output) */
// "InvalidItems": 8;
// /* The offer hasn't been sent yet and is awaiting further confirmation */
// "CreatedNeedsConfirmation": 9;
// /* Either party canceled the offer via email/mobile confirmation */
// "CanceledBySecondFactor": 10;
// /* The trade has been placed on hold */
// "InEscrow": 11;
export function getState(s:number):StatusType{
    if([1,4,5,8,11].includes(s)){
        return 'failed'
    }
    else if([3].includes(s)){
        return 'accepted'
    }
    else if([6,10].includes(s)) return 'cancelled'
    else if([7].includes(s)) return 'declined'
    else if([2].includes(s)) return 'active'
    else if([9].includes(2)) return 'needsConf'
    else return 'failed'
    
}

export function getItemCategory(item: CEconItem): EFullCategory | null {
    try {
      const itemType = item.getTag('Type')?.name;
  
      // Check for gloves category
      if (itemType === 'Gloves') {
        for (const category of Object.values(EFullCategory)) {
          if(item.name.includes(category)) return category
        }
      }
  
      // Check for weapon category
      const weaponTag = item.getTag('Weapon');
      if (weaponTag) {
        return weaponTag.name as EFullCategory;
      }
  
      // Check for stickers category
      if (itemType === 'Sticker') {
        const stickerCapsule = item.getTag('StickerCapsule');
        const tournamentTag = item.getTag('Tournament');
        if(tournamentTag) return tournamentTag.name as EFullCategory
        else return stickerCapsule.name as EFullCategory
        
      }
  
      // If no category matched, return null
      return null;
  
    } catch (e) {
      throw e; // Re-throw the error for handling at a higher level
    }
  }
  
 const item = new CEconItem('','','')
 const i = {...item}
 
