import { spawn, ChildProcessWithoutNullStreams } from "child_process";

const globalArgs: string[] = ["--batch"];

export interface GpgResult {
    result?: Buffer;
    error?: Error;
}

export interface GpgSpawnResult {
    gpgResult: Promise<GpgResult>;
	kill: () => void;
}

export default function spawnGPG(exec: string, input: string | Buffer | null, defaultArgs: string[], args?: string[]): GpgSpawnResult {
    if (!args) {
        args = [];
    }

    const gpgArgs = args.concat(defaultArgs);

    // Spawn the GPG process and store its reference
    const childProcess = spawnIt(exec, gpgArgs);

    // Create a promise that resolves or rejects based on GPG output
    const gpgResult = new Promise<GpgResult>((resolve, reject) => {
        const buffers: Buffer[] = [];
        let buffersLength = 0;
        let error = "";

        childProcess.stdout.on("data", (buf: Buffer) => {
            buffers.push(buf);
            buffersLength += buf.length;
        });

        childProcess.stderr.on("data", (buf: Buffer) => {
            error += buf.toString("utf8");
        });

        childProcess.on("close", (code: number) => {
            const msg = Buffer.concat(buffers, buffersLength);
            if (code !== 0) {
                reject(new Error(error || msg.toString()));
                return;
            }
            resolve({
                result: msg,
                error: error.length > 0 ? new Error(error) : undefined
            });
        });

        childProcess.on("error", (err) => {
            resolve({
                result: undefined,
                error: err
            });
        });

        if (input) {
            childProcess.stdin.end(input);
        }
    });

    // Return both the promise and the function to kill the childProcess
    return { 
		gpgResult, 
		kill: () => childProcess.kill("SIGINT")
	};
}

function spawnIt(exec: string, args: string[]): ChildProcessWithoutNullStreams {
    return spawn(exec, globalArgs.concat(args));
}
