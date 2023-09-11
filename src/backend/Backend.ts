export enum Backend {
    NATIVE = "native",
    WRAPPER = "wrapper",
}

export const BackendDescription: { [key in Backend]: string } = {
	[Backend.NATIVE]: "OpenPGP.js",
	[Backend.WRAPPER]: "GnuPG CLI Wrapper",
};
