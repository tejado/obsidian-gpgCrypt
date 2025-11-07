import { IValidator, ValidationError } from "./IValidator";
import { Settings } from "../Settings";
import { normalizePath } from "obsidian";

export class FolderInSettingValidator implements IValidator<string> {
	constructor(private readonly settings: Settings) {}

	validate(filePath: string) {
		const normalizedFilePath = normalizePath(filePath);

		//if the paths are just equal
		if (
			this.settings.foldersToEncrypt?.some(
				(folder) => folder === filePath
			)
		) {
			return this;
		}

		const isInAllowedFolder = this.settings.foldersToEncrypt?.some(
			(folder) => {
				const normalizedFolder = normalizePath(folder);
				return normalizedFilePath.startsWith(normalizedFolder + "/");
			}
		);

		if (!isInAllowedFolder) {
			throw new ValidationError(
				"FolderInSettingValidator",
				"This folder isn't in your path.",
				filePath + " folder not in path, ignoring."
			);
		}

		return this;
	}
}
