import fs from 'fs';
import writeFileAtomic from 'write-file-atomic';
import path from 'path';
import timersPromises from 'timers/promises';


let filesBeingSaved = 0;

export function readFile(p: string, json: boolean): Promise<any> {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(p)) {
            resolve({});
            return;
        }

        fs.readFile(p, { encoding: 'utf8' }, (err, data) => {
            if (err) {
                return reject(err);
            }

            if (json !== true) {
                return resolve(data);
            }

            if (data.length === 0) {
                return resolve(null);
            }

            let parsed;
            try {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                parsed = JSON.parse(data);
            } catch (err) {
                return reject(err);
            }

            resolve(parsed);
        });
    });
}

export function writeFile(p: string, data: unknown, json: boolean): Promise<void|null> {
    return new Promise((resolve, reject) => {
        let write:string;

        if (json === true) {
            write = JSON.stringify(data,null,4);
        } else {
            write = data as string;
        }

        const dir = path.dirname(p);

        if (fs.existsSync(dir)) {
            writeToFile();
        } else {
            fs.mkdir(dir, { recursive: true }, err => {
                if (err) {
                    return reject(err);
                }

                writeToFile();
            });
        }

        function writeToFile(): void|null {
            filesBeingSaved++;
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            writeFileAtomic(p, write, { encoding: 'utf8' }, err => {
                filesBeingSaved--;

                if (err) {
                    return reject(err);
                }

                return resolve(null);
            });
        }
    });
}

export function deleteFile(p: string): Promise<void | null> {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(p)) {
            resolve(null);
            return;
        }

        filesBeingSaved++;
        fs.unlink(p, err => {
            filesBeingSaved--;
            if (err) {
                return reject(err);
            }

            return resolve();
        });
    });
}

export function isWritingToFiles(): boolean {
    return filesBeingSaved !== 0;
}
export function waitForWriting(checks = 0): Promise<void> {
    if (!isWritingToFiles()) {
        return Promise.resolve();
    }

    return new Promise(resolve => {
        void timersPromises.setTimeout(exponentialBackoff(checks, 100)).then(() => {
            resolve(waitForWriting(checks + 1));
        });
    });
}
export function exponentialBackoff(n: number, base = 1000): number {
    return Math.pow(2, n) * base + Math.floor(Math.random() * base);
}