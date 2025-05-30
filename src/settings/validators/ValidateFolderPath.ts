import GpgPlugin from "src/main";
import { IValidator, ValidationError } from "./IValidator";

export class FolderValidator implements IValidator<string> {

	validate(folderPath: string) {
		if (!GpgPlugin.APP.vault.getFolderByPath(folderPath)) {
			throw new ValidationError("Folder", "This Folder doesn't seem to exist in your Obsidian Vault", `${folderPath} - file-not-found`);
		}

		return this;
	}

} 
