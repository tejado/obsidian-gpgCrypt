export function isGpgKey(keyId: string): boolean {
	return /^[A-Fa-f0-9]{1,32}$/.test(keyId);
}


// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function _log(...args: any[]) {
	if (process.env.DEBUG) {
		const stack = new Error().stack;
		if (stack) {
			const match = /\((.*):(\d+):\d+\)$/.exec(stack.split("\n")[2]);
			if (match) {
				const [, file, line] = match;
				const fileName = file.split("/").pop();
				console.log(`[${fileName}:${line}]`, ...args);
			} else {
				console.log(stack, ...args);
			}
		} else {
			console.log(...args);
		}
	}
}

export function changeFileExtMdToGpg(filename: string): string {
	return filename.replace(/\.md$/, ".gpg");
}

export function changeFileExtGpgToMd(filename: string): string {
	return filename.replace(/\.gpg$/, ".md");
}