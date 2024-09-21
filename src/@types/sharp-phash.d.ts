declare module 'sharp-phash' {
    export default function phash(image: Buffer): Promise<string>
}

declare module 'sharp-phash/distance.js' {
    export default function distance(hash1: string, hash2: string): number
}

