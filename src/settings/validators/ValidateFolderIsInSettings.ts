import { IValidator, ValidationError } from "./IValidator";
import { Settings } from "../Settings";
import * as path from "path";

export class FolderInSettingValidator implements IValidator<string> {

	constructor(private readonly settings: Settings) { }

	validate(filePath: string) {
		const normalizedFilePath = path.resolve(filePath);

		if (this.settings.encryptAll) {
			return this;
		}

		//if the paths are just equal
		if (this.settings.foldersToEncrypt?.some(folder => folder === filePath)) {
			return this;
		}

		const isInAllowedFolder = this.settings.foldersToEncrypt?.some(folder => {
			const normalizedFolder = path.resolve(folder);
			return normalizedFilePath.startsWith(normalizedFolder + path.sep);
		});

		if (!isInAllowedFolder) {
			throw new ValidationError("FolderInSettingValidator", "This folder isn't in your path.", filePath + " folder not in path, ignoring.");
		}

		return this;
	}

} 
