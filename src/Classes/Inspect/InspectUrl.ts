interface InspectParams {
    s: string;
    a: string;
    d: string;
    m: string;
}

type InspectURLConstructorArgs = 
    | [string] // inspect link
    | [Partial<InspectParams>] // object with params
    | [string, string, string, string]; // s, a, d, m

class InspectURL {
    public s: string = '0';
    public a: string = '0';
    public d: string = '0';
    public m: string = '0';
    
    private readonly requiredParams: (keyof InspectParams)[] = ['s', 'a', 'd', 'm'];

    constructor();
    constructor(link: string);
    constructor(params: Partial<InspectParams>);
    constructor(s: string, a: string, d: string, m: string);
    constructor(...args: InspectURLConstructorArgs | []) {
        if (args.length === 1 && typeof args[0] === 'string') {
            // parse the inspect link
            this.parseLink(args[0]);
        }
        else if (args.length === 1 && typeof args[0] === 'object') {
            // parse object with the requiredParams
            const params = args[0] as Partial<InspectParams>;
            for (const param of this.requiredParams) {
                if (params[param] && typeof params[param] === 'string' && params[param]!.length > 0) {
                    this[param] = params[param]!;
                }
                else {
                    this[param] = '0';
                }
            }
        }
        else if (args.length === 4) {
            // parse each arg
            const [s, a, d, m] = args as [string, string, string, string];
            
            // Ensure each arg is a string
            if (typeof s === 'string' && typeof a === 'string' && 
                typeof d === 'string' && typeof m === 'string') {
                this.s = s;
                this.a = a;
                this.d = d;
                this.m = m;
            }
        }
    }

    private isOnlyDigits(str: string): boolean {
        return /^\d+$/.test(str);
    }

    get valid(): boolean {
        // Ensure each param exists and only contains digits
        for (const param of this.requiredParams) {
            if (!this[param] || !this.isOnlyDigits(this[param])) return false;
        }

        return true;
    }

    private parseLink(link: string): void {
        try {
            link = decodeURI(link);
        } catch (e) {
            // Catch URI Malformed exceptions
            return;
        }

        const groups = /^steam:\/\/rungame\/730\/\d+\/[+ ]csgo_econ_action_preview ([SM])(\d+)A(\d+)D(\d+)$/.exec(link);

        if (groups) {
            if (groups[1] === 'S') {
                this.s = groups[2];
                this.m = '0';
            }
            else if (groups[1] === 'M') {
                this.m = groups[2];
                this.s = '0';
            }

            this.a = groups[3];
            this.d = groups[4];
        }
    }

    public getParams(): InspectParams | undefined {
        if (this.valid) return { s: this.s, a: this.a, d: this.d, m: this.m };
        return undefined;
    }

    public isMarketLink(): boolean {
        return this.valid && this.m !== '0';
    }

    public getLink(): string | undefined {
        if (!this.valid) return undefined;

        if (this.s === '0' && this.m) {
            return `steam://rungame/730/76561202255233023/+csgo_econ_action_preview M${this.m}A${this.a}D${this.d}`;
        }
        else {
            return `steam://rungame/730/76561202255233023/+csgo_econ_action_preview S${this.s}A${this.a}D${this.d}`;
        }
    }
}

export default InspectURL;