
export class ValidationError extends Error {

	constructor(public readonly objectName: string, public readonly displayError: string, error: string) {
		super(error)
	}

}

export interface IValidator<T> {
	//should throw {@ValidationError}
	validate(object: T): IValidator<T>
} 
