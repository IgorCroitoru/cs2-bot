import CEconItem from "steamcommunity/classes/CEconItem";
import { Sticker } from "../core/entities/ItemInv";
import { EFullCategory } from "./category-enums";
import * as https from 'https';
import * as fs from 'fs';

export function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function exponentialBackoff(n: number, base = 1000): number {
    return Math.pow(2, n) * base + Math.floor(Math.random() * base);
}

export function getInspectUrl(actions: any[], id64: string, assetId: number): string | null {
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
    return null;
}
/**
 * Extracts stickers from the last description in the provided array.
 * @param descriptions Array of item descriptions
 * @returns Array of Sticker objects extracted from the HTML content of the last description
 */
export function getStickers(descriptions: { value: string }[]): Sticker[] | null {
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
                return null;
            }

            const stickers: Sticker[] = [];
            const names = stickerNameMatches[0].replace('Sticker: ', '').split(', ');

            stickerSrcMatches.forEach((src, index) => {
                stickers.push(new Sticker(names[index], src.replace('src="', '').replace('"', '')));
            });

            return stickers;
        } catch (error) {
            return null;
        }
    }

    return null;
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
// export function getState(s:number):StatusType{
//     if([1,4,5,8,11].includes(s)){
//         return 'failed'
//     }
//     else if([3].includes(s)){
//         return 'accepted'
//     }
//     else if([6,10].includes(s)) return 'cancelled'
//     else if([7].includes(s)) return 'declined'
//     else if([2].includes(s)) return 'active'
//     else if([9].includes(2)) return 'needsConf'
//     else return 'failed'
    
// }


export function getItemCategory(item: CEconItem): EFullCategory | null {
    try {
        const itemType = item.getTag('Type')?.name;

        // Check for gloves category
        if (itemType === 'Gloves') {
            for (const category of Object.values(EFullCategory)) {
                if (item.name.includes(category)) return category;
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
            if (tournamentTag) return tournamentTag.name as EFullCategory;
            else if (stickerCapsule) return stickerCapsule.name as EFullCategory;
        }

        // If no category matched, return null
        return null;

    } catch (e) {
        throw e; // Re-throw the error for handling at a higher level
    }
}
  
// Add this helper function
export function hydrateCEconItem(itemData: any): CEconItem {
    if (itemData instanceof CEconItem) {
        return itemData; // Already hydrated
    }
    // Create new CEconItem from plain object
    const item = new CEconItem(itemData, itemData.description, itemData.contextid);
    
    
    
    return item;
}

export function hydrateItemArray(items: any[] | any): CEconItem[] {
    if (!Array.isArray(items)) return [hydrateCEconItem(items)];
    return items.map(item => hydrateCEconItem(item));
}



/**
 * Downloads the given HTTPS file
 */
export function downloadFile(url: string, cb: (data?: string) => void): void {
    https.get(url, function(res) {
        let errored = false;

        if (res.statusCode !== 200 && !errored) {
            cb();
            return;
        }

        res.setEncoding('utf8');
        let data = '';

        res.on('error', function(err) {
            cb();
            errored = true;
        });

        res.on('data', function(chunk) {
            data += chunk;
        });

        res.on('end', function() {
            cb(data);
        });
    });
}

/**
 * Returns a boolean as to whether the specified path is a directory and exists
 */
export function isValidDir(path: string): boolean {
    try {
        return fs.statSync(path).isDirectory();
    } catch (e) {
        return false;
    }
}

/**
 * Returns a boolean as to whether the string only contains numbers
 */
export function isOnlyDigits(num: string): boolean {
    return /^\d+$/.test(num);
}

/**
 * Filters the keys in the given object and returns new one
 */
export function filterKeys<T extends Record<string, any>>(keys: string[], obj: T): Partial<T> {
    return keys.reduce((result: Partial<T>, key: string) => {
        if (key in obj) result[key as keyof T] = obj[key];
        return result;
    }, {});
}

/**
 * Removes keys with null values
 */
export function removeNullValues<T extends Record<string, any>>(obj: T): Partial<T> {
    return Object.keys(obj).reduce((result: Partial<T>, key: string) => {
        if (key in obj && obj[key] !== null) {
            result[key as keyof T] = obj[key];
        }
        return result;
    }, {});
}

/**
 * Converts the given unsigned 64 bit integer into a signed 64 bit integer
 */
export function unsigned64ToSigned(num: string | number | bigint): bigint {
    const mask = 1n << 63n;
    return (BigInt(num) ^ mask) - mask;
}

/**
 * Converts the given signed 64 bit integer into an unsigned 64 bit integer
 */
export function signed64ToUnsigned(num: string | number | bigint): bigint {
    const mask = 1n << 63n;
    return (BigInt(num) + mask) ^ mask;
}

/**
 * Checks whether the given ID is a SteamID64
 */
export function isSteamId64(id: string | number | bigint): boolean {
    const bigId = BigInt(id);
    const universe = bigId >> 56n;
    if (universe > 5n) return false;

    const instance = (bigId >> 32n) & (1n << 20n) - 1n;

    // There are currently no documented instances above 4, but this is for good measure
    return instance <= 32n;
}

/**
 * Chunks array into sub-arrays of the given size
 */
export function chunkArray<T>(arr: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
        result.push(arr.slice(i, i + size));
    }
    return result;
}

/**
 * Shuffle array - O(N LOG N) so it shouldn't be used for super-large arrays
 */
export function shuffleArray<T>(arr: T[]): T[] {
    return arr.map((value: T) => ({ value, sort: Math.random() }))
        .sort((a: { value: T; sort: number }, b: { value: T; sort: number }) => a.sort - b.sort)
        .map(({ value }) => value);
}
