/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { localize } from 'vs/nls';
import { IModel } from 'vs/editor/common/editorCommon';
import { ISuggestSupport, ISuggestResult, ISuggestion, LanguageId, SuggestionType, SnippetType } from 'vs/editor/common/modes';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { setSnippetSuggestSupport } from 'vs/editor/contrib/suggest/browser/suggest';
import { IModeService } from 'vs/editor/common/services/modeService';
import { Position } from 'vs/editor/common/core/position';
import { overlap, compare, startsWith } from 'vs/base/common/strings';
import { SnippetParser } from 'vs/editor/contrib/snippet/browser/snippetParser';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IExtensionService } from 'vs/platform/extensions/common/extensions';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { join } from 'path';
import { mkdirp } from 'vs/base/node/pfs';
import { watch } from 'fs';
import { SnippetFile } from 'vs/workbench/parts/snippets/electron-browser/snippetsFile';
import { TPromise } from 'vs/base/common/winjs.base';
import { ISnippet, ISnippetsService } from 'vs/workbench/parts/snippets/electron-browser/snippets.contribution';
import { IJSONSchema } from 'vs/base/common/jsonSchema';
import { ExtensionsRegistry, IExtensionPointUser } from 'vs/platform/extensions/common/extensionsRegistry';
import { languagesExtPoint } from 'vs/workbench/services/mode/common/workbenchModeService';

namespace schema {

	export interface ISnippetsExtensionPoint {
		language: string;
		path: string;
	}

	export function isValidSnippet(extension: IExtensionPointUser<ISnippetsExtensionPoint[]>, snippet: ISnippetsExtensionPoint, modeService: IModeService): boolean {
		if (!snippet.language || (typeof snippet.language !== 'string') || !modeService.isRegisteredMode(snippet.language)) {
			extension.collector.error(localize('invalid.language', "Unknown language in `contributes.{0}.language`. Provided value: {0}", String(snippet.language)));
			return false;

		} else if (!snippet.path || (typeof snippet.path !== 'string')) {
			extension.collector.error(localize('invalid.path.0', "Expected string in `contributes.{0}.path`. Provided value: {0}", String(snippet.path)));
			return false;

		} else {
			const normalizedAbsolutePath = join(extension.description.extensionFolderPath, snippet.path);
			if (normalizedAbsolutePath.indexOf(extension.description.extensionFolderPath) !== 0) {
				extension.collector.error(localize(
					'invalid.path.1',
					"Expected `contributes.{0}.path` ({1}) to be included inside extension's folder ({2}). This might make the extension non-portable.",
					extension.description.name, normalizedAbsolutePath, extension.description.extensionFolderPath
				));
				return false;
			}

			snippet.path = normalizedAbsolutePath;
			return true;
		}
	}

	export const snippetsContribution: IJSONSchema = {
		description: localize('vscode.extension.contributes.snippets', 'Contributes snippets.'),
		type: 'array',
		defaultSnippets: [{ body: [{ language: '', path: '' }] }],
		items: {
			type: 'object',
			defaultSnippets: [{ body: { language: '${1:id}', path: './snippets/${2:id}.json.' } }],
			properties: {
				language: {
					description: localize('vscode.extension.contributes.snippets-language', 'Language identifier for which this snippet is contributed to.'),
					type: 'string'
				},
				path: {
					description: localize('vscode.extension.contributes.snippets-path', 'Path of the snippets file. The path is relative to the extension folder and typically starts with \'./snippets/\'.'),
					type: 'string'
				}
			}
		}
	};
}

class SnippetsService implements ISnippetsService {

	readonly _serviceBrand: any;

	private readonly _pendingExtensionSnippets = new Map<LanguageId, [IExtensionPointUser<any>, string][]>();
	private readonly _extensionSnippets = new Map<LanguageId, ISnippet[]>();
	private readonly _userSnippets = new Map<LanguageId, ISnippet[]>();
	private readonly _userSnippetsFolder: string;
	private readonly _disposables: IDisposable[] = [];

	constructor(
		@IModeService readonly _modeService: IModeService,
		@IExtensionService readonly _extensionService: IExtensionService,
		@IEnvironmentService environmentService: IEnvironmentService,
	) {
		this._userSnippetsFolder = join(environmentService.appSettingsHome, 'snippets');
		this._prepUserSnippetsWatching();
		this._prepExtensionSnippets();

		setSnippetSuggestSupport(new SnippetSuggestProvider(this._modeService, this));
	}

	dispose(): void {
		dispose(this._disposables);
	}

	async getSnippets(languageId: LanguageId): TPromise<ISnippet[]> {
		let result: ISnippet[] = [];
		await TPromise.join([
			this._extensionService.onReady(),
			this._getOrLoadUserSnippets(languageId, result),
			this._getOrLoadExtensionSnippets(languageId, result)
		]);
		return result;
	}

	getSnippetsSync(languageId: LanguageId): ISnippet[] {
		// just kick off snippet loading for this language such
		// that subseqent calls to this method return more
		// correct results
		this.getSnippets(languageId).done(undefined, undefined);

		// collect and return what we already have
		let userSnippets = this._userSnippets.get(languageId);
		let extensionSnippets = this._extensionSnippets.get(languageId);
		return (userSnippets || []).concat(extensionSnippets || []);
	}

	// --- extension snippet logic ---

	private async _prepExtensionSnippets(): TPromise<void> {
		ExtensionsRegistry.registerExtensionPoint<schema.ISnippetsExtensionPoint[]>('snippets', [languagesExtPoint], schema.snippetsContribution).setHandler(async extensions => {
			for (const extension of extensions) {
				for (const contribution of extension.value) {
					if (schema.isValidSnippet(extension, contribution, this._modeService)) {
						const { id } = this._modeService.getLanguageIdentifier(contribution.language);
						const array = this._pendingExtensionSnippets.get(id);
						if (!array) {
							this._pendingExtensionSnippets.set(id, [[extension, contribution.path]]);
						} else {
							array.push([extension, contribution.path]);
						}
					}
				}
			}
		});
	}

	private async _getOrLoadExtensionSnippets(languageId: LanguageId, bucket: ISnippet[]): TPromise<void> {

		if (this._extensionSnippets.has(languageId)) {
			bucket.push(...this._extensionSnippets.get(languageId));

		} else if (this._pendingExtensionSnippets.has(languageId)) {
			const pending = this._pendingExtensionSnippets.get(languageId);
			this._pendingExtensionSnippets.delete(languageId);

			const snippets = [];
			this._extensionSnippets.set(languageId, snippets);

			for (const [extension, filepath] of pending) {
				let file: SnippetFile;
				try {
					file = await SnippetFile.fromFile(filepath, extension.description.displayName || extension.description.name, true);
				} catch (e) {
					extension.collector.warn(localize(
						'badFile',
						"The snippet file \"{0}\" could not be read.",
						filepath
					));
				}
				if (file) {
					for (const snippet of file.data) {
						snippets.push(snippet);
						bucket.push(snippet);
						if (snippet.isBogous) {
							extension.collector.warn(localize(
								'badVariableUse',
								"The \"{0}\"-snippet very likely confuses snippet-variables and snippet-placeholders. See https://code.visualstudio.com/docs/editor/userdefinedsnippets#_snippet-syntax for more details.",
								snippet.name
							));
						}
					}
				}
			}
		}
	}

	// --- user snippet logic ---

	private async _getOrLoadUserSnippets(languageId: LanguageId, bucket: ISnippet[]): TPromise<void> {
		let snippets = this._userSnippets.get(languageId);
		if (snippets === undefined) {
			try {
				snippets = (await SnippetFile.fromFile(this._getUserSnippetFilepath(languageId), localize('source.snippet', "User Snippet"))).data;
			} catch (e) {
				snippets = null;
			}
			this._userSnippets.set(languageId, snippets);
		}

		if (snippets) {
			bucket.push(...snippets);
		}
	}

	private _getUserSnippetFilepath(languageId: LanguageId): string {
		const { language } = this._modeService.getLanguageIdentifier(languageId);
		const filepath = join(this._userSnippetsFolder, `${language}.json`);
		return filepath;
	}

	private _prepUserSnippetsWatching(): void {
		// Install a FS watcher on the snippet directory and when an
		// event occurs delete any cached snippet information
		mkdirp(this._userSnippetsFolder).then(() => {
			const watcher = watch(this._userSnippetsFolder);
			this._disposables.push({ dispose: () => watcher.close() });
			watcher.on('change', (type, filename) => {
				if (typeof filename === 'string') {
					const language = filename.replace(/\.json$/, '').toLowerCase();
					const languageId = this._modeService.getLanguageIdentifier(language);
					if (languageId) {
						this._userSnippets.delete(languageId.id);
					}
				}
			});
		});
	}
}

registerSingleton(ISnippetsService, SnippetsService);

export interface ISimpleModel {
	getLineContent(lineNumber: number): string;
}

export class SnippetSuggestion implements ISuggestion {

	label: string;
	detail: string;
	insertText: string;
	documentation: string;
	overwriteBefore: number;
	sortText: string;
	noAutoAccept: boolean;
	type: SuggestionType;
	snippetType: SnippetType;

	constructor(
		readonly snippet: ISnippet,
		overwriteBefore: number
	) {
		this.label = snippet.prefix;
		this.detail = localize('detail.snippet', "{0} ({1})", snippet.description, snippet.source);
		this.insertText = snippet.codeSnippet;
		this.overwriteBefore = overwriteBefore;
		this.sortText = `${snippet.isFromExtension ? 'z' : 'a'}-${snippet.prefix}`;
		this.noAutoAccept = true;
		this.type = 'snippet';
		this.snippetType = 'textmate';
	}

	resolve(): this {
		this.documentation = new SnippetParser().text(this.snippet.codeSnippet);
		return this;
	}

	static compareByLabel(a: SnippetSuggestion, b: SnippetSuggestion): number {
		return compare(a.label, b.label);
	}
}


export class SnippetSuggestProvider implements ISuggestSupport {

	constructor(
		@IModeService private _modeService: IModeService,
		@ISnippetsService private _snippets: ISnippetsService
	) {
		//
	}

	async provideCompletionItems(model: IModel, position: Position): TPromise<ISuggestResult> {

		const languageId = this._getLanguageIdAtPosition(model, position);
		const snippets = await this._snippets.getSnippets(languageId);
		const suggestions: SnippetSuggestion[] = [];

		const lowWordUntil = model.getWordUntilPosition(position).word.toLowerCase();
		const lowLineUntil = model.getLineContent(position.lineNumber).substr(Math.max(0, position.column - 100), position.column - 1).toLowerCase();

		for (const snippet of snippets) {

			const lowPrefix = snippet.prefix.toLowerCase();
			let overwriteBefore = 0;
			let accetSnippet = true;

			if (lowWordUntil.length > 0 && startsWith(lowPrefix, lowWordUntil)) {
				// cheap match on the (none-empty) current word
				overwriteBefore = lowWordUntil.length;
				accetSnippet = true;

			} else if (lowLineUntil.length > 0 && lowLineUntil.match(/[^\s]$/)) {
				// compute overlap between snippet and (none-empty) line on text
				overwriteBefore = overlap(lowLineUntil, snippet.prefix.toLowerCase());
				accetSnippet = overwriteBefore > 0 && !model.getWordAtPosition(new Position(position.lineNumber, position.column - overwriteBefore));
			}

			if (accetSnippet) {
				suggestions.push(new SnippetSuggestion(snippet, overwriteBefore));
			}
		}

		// dismbiguate suggestions with same labels
		let lastItem: SnippetSuggestion;
		for (const item of suggestions.sort(SnippetSuggestion.compareByLabel)) {
			if (lastItem && lastItem.label === item.label) {
				// use the disambiguateLabel instead of the actual label
				lastItem.label = localize('snippetSuggest.longLabel', "{0}, {1}", lastItem.label, lastItem.snippet.name);
				item.label = localize('snippetSuggest.longLabel', "{0}, {1}", item.label, item.snippet.name);
			}
			lastItem = item;
		}

		return { suggestions };
	}

	resolveCompletionItem?(model: IModel, position: Position, item: ISuggestion): ISuggestion {
		return (item instanceof SnippetSuggestion) ? item.resolve() : item;
	}

	private _getLanguageIdAtPosition(model: IModel, position: Position): LanguageId {
		// validate the `languageId` to ensure this is a user
		// facing language with a name and the chance to have
		// snippets, else fall back to the outer language
		model.tokenizeIfCheap(position.lineNumber);
		let languageId = model.getLanguageIdAtPosition(position.lineNumber, position.column);
		let { language } = this._modeService.getLanguageIdentifier(languageId);
		if (!this._modeService.getLanguageName(language)) {
			languageId = model.getLanguageIdentifier().id;
		}
		return languageId;
	}


}

export function getNonWhitespacePrefix(model: ISimpleModel, position: Position): string {
	/**
	 * Do not analyze more characters
	 */
	const MAX_PREFIX_LENGTH = 100;

	let line = model.getLineContent(position.lineNumber).substr(0, position.column - 1);

	let minChIndex = Math.max(0, line.length - MAX_PREFIX_LENGTH);
	for (let chIndex = line.length - 1; chIndex >= minChIndex; chIndex--) {
		let ch = line.charAt(chIndex);

		if (/\s/.test(ch)) {
			return line.substr(chIndex + 1);
		}
	}

	if (minChIndex === 0) {
		return line;
	}

	return '';
}

