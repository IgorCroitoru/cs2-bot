// export type DealCreationStatus = "active" | "pending" | undefined
export default class Deal{
    declare id: number
    declare offerId?: string

   

    constructor(id: number, offerId: string | undefined) {
        this.id = id;
        this.offerId = offerId
    }

}
