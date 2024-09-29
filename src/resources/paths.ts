import path from 'path';
import fs from 'fs';

interface FilePaths {
    refreshToken: string;
    pollData: string;
    loginAttempts: string;
    cookies: string;
    dealError: string;
    dealQueue: string;
    dir: string;
}

interface LogPaths {
    log: string;
    trade: string;
    error: string;
}

export interface Paths {
    files: FilePaths;
}

function generatePollDataPath(steamAccountName: string, increment: number) {
    return path.join(__dirname, `../../files/${steamAccountName}/polldata${increment > 0 ? increment : ''}.json`);
}

// export default function genPaths(steamAccountName: string, maxPollDataSizeMB = 5): Paths {
//     // let increment = 0;
//     // let pollDataPath = generatePollDataPath(steamAccountName, increment);

//     // while (fs.existsSync(pollDataPath) && fs.statSync(pollDataPath).size / (1024 * 1024) > maxPollDataSizeMB) {
//     //      pollDataPath = generatePollDataPath(steamAccountName, ++increment);
//     //  }
//     return {
//         files: {
//             refreshToken: path.join(__dirname, `../../files/${steamAccountName}/refreshToken.txt`),
//             dealQueue: path.join(__dirname, `../../files/${steamAccountName}/dealQueue.json`),
//             pollData: path.join(__dirname, `../../files/${steamAccountName}/pollData.json`),
//             loginAttempts: path.join(__dirname, `../../files/${steamAccountName}/loginattempts.json`),
//             cookies:  path.join(__dirname, `../../files/${steamAccountName}/cookies.json`),
//             dealError: path.join(__dirname, `../../files/${steamAccountName}/dealsError.json`),
//             dir: path.join(__dirname, `../../files/${steamAccountName}/`)
//         },
        
//     };
// }

export default function genPaths(steamAccountName: string, maxPollDataSizeMB = 5): Paths {
    const baseDir = path.resolve(process.cwd(), 'files', steamAccountName); // Resolve relative to project root
    return {
        files: {
            refreshToken: path.join(baseDir, 'refreshToken.txt'),
            dealQueue: path.join(baseDir, 'dealQueue.json'),
            pollData: path.join(baseDir, 'pollData.json'),
            loginAttempts: path.join(baseDir, 'loginattempts.json'),
            cookies:  path.join(baseDir, 'cookies.json'),
            dealError: path.join(baseDir, 'dealsError.json'),
            dir: baseDir
        },
    };
}