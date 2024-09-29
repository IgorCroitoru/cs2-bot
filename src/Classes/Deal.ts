import SteamID from "steamid"
import { ItemAsset } from "../core/entities/ItemInv"
import { StatusType } from "./Interfaces/SocketEvents"
import { readFile,deleteFile, writeFile } from "../lib/files"
import genPaths from "../resources/paths"
export type DealCreationStatus = "active" | "pending" | undefined
export default class Deal{
    declare id: number
    declare offerId?: string
    declare status: DealCreationStatus

   

    constructor(id: number, offerId: string | undefined, status:DealCreationStatus) {
        this.id = id;
        this.offerId = offerId
        this.status = status
    }

}
