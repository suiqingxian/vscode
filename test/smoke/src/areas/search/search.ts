/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SpectronApplication } from '../../spectron/application';

export class Search {

	static SEARCH_VIEWLET_XPATH = 'div[id="workbench.view.search"] .search-viewlet';

	constructor(private spectron: SpectronApplication) {
		// noop
	}

	public async openSearchViewlet(): Promise<any> {
		if (!await this.isSearchViewletFocused()) {
			await this.spectron.command('workbench.view.search');
			await this.spectron.client.waitForElement(`${Search.SEARCH_VIEWLET_XPATH} .search-widget .monaco-inputbox.synthetic-focus input[placeholder="Search"]`);
		}
	}

	public async isSearchViewletFocused(): Promise<boolean> {
		const element = await this.spectron.client.element(`${Search.SEARCH_VIEWLET_XPATH} .search-widget .monaco-inputbox.synthetic-focus input[placeholder="Search"]`);
		return !!element;
	}

	public async searchFor(text: string): Promise<void> {
		const searchBoxSelector = `${Search.SEARCH_VIEWLET_XPATH} .search-widget .search-container .monaco-inputbox input[placeholder="Search"]`;

		await this.spectron.client.clearElement(searchBoxSelector);
		await this.spectron.client.click(searchBoxSelector);
		await this.spectron.client.element(`${Search.SEARCH_VIEWLET_XPATH} .search-widget .search-container .monaco-inputbox.synthetic-focus input[placeholder="Search"]`);

		await this.spectron.client.keys(text);

		await this.submitSearch();
	}

	public async submitSearch(): Promise<void> {
		await this.spectron.client.click(`${Search.SEARCH_VIEWLET_XPATH} .search-widget .search-container .monaco-inputbox input[placeholder="Search"]`);
		await this.spectron.client.element(`${Search.SEARCH_VIEWLET_XPATH} .search-widget .search-container .monaco-inputbox.synthetic-focus input[placeholder="Search"]`);
		await this.spectron.client.keys(['NULL', 'Enter', 'NULL'], false);
		await this.spectron.client.element(`${Search.SEARCH_VIEWLET_XPATH} .messages[aria-hidden="false"]`);
	}

	public async setFilesToIncludeTextAndSearch(text: string): Promise<void> {
		await this.spectron.client.click(`${Search.SEARCH_VIEWLET_XPATH} .query-details .monaco-inputbox input[aria-label="Search Include Patterns"]`);
		await this.spectron.client.element(`${Search.SEARCH_VIEWLET_XPATH} .query-details .monaco-inputbox.synthetic-focus input[aria-label="Search Include Patterns"]`);
		await this.spectron.client.clearElement(`${Search.SEARCH_VIEWLET_XPATH} .query-details .monaco-inputbox.synthetic-focus input[aria-label="Search Include Patterns"]`);

		if (text) {
			await this.spectron.client.keys(text);
		}
	}

	public async showQueryDetails(): Promise<void> {
		if (!await this.areDetailsVisible()) {
			await this.spectron.client.waitAndClick(`${Search.SEARCH_VIEWLET_XPATH} .query-details .more`);
		}
	}

	public async hideQueryDetails(): Promise<void> {
		if (await this.areDetailsVisible()) {
			await this.spectron.client.waitAndClick(`${Search.SEARCH_VIEWLET_XPATH} .query-details.more .more`);
		}
	}

	public async areDetailsVisible(): Promise<boolean> {
		const element = await this.spectron.client.element(`${Search.SEARCH_VIEWLET_XPATH} .query-details.more`);
		return !!element;
	}

	public async removeFileMatch(index: number): Promise<void> {
		await this.spectron.client.waitAndmoveToObject(`${Search.SEARCH_VIEWLET_XPATH} .results .monaco-tree-rows>:nth-child(${index}) .filematch`);
		const file = await this.spectron.client.waitForText(`${Search.SEARCH_VIEWLET_XPATH} .results .monaco-tree-rows>:nth-child(${index}) .filematch a.label-name`);
		await this.spectron.client.click(`${Search.SEARCH_VIEWLET_XPATH} .results .monaco-tree-rows>:nth-child(${index}) .filematch .action-label.icon.action-remove`);
		await this.spectron.client.waitForText(`${Search.SEARCH_VIEWLET_XPATH} .results .monaco-tree-rows>:nth-child(${index}) .filematch a.label-name`, void 0, result => result !== file);
	}

	public async setReplaceText(text: string): Promise<void> {
		await this.spectron.client.waitAndClick(`${Search.SEARCH_VIEWLET_XPATH} .search-widget .monaco-button.toggle-replace-button.collapse`);
		await this.spectron.client.waitAndClick(`${Search.SEARCH_VIEWLET_XPATH} .search-widget .replace-container .monaco-inputbox input[title="Replace"]`);
		await this.spectron.client.element(`${Search.SEARCH_VIEWLET_XPATH} .search-widget .replace-container .monaco-inputbox.synthetic-focus input[title="Replace"]`);
		await this.spectron.client.setValue(`${Search.SEARCH_VIEWLET_XPATH} .search-widget .replace-container .monaco-inputbox.synthetic-focus input[title="Replace"]`, text);
	}

	public async replaceFileMatch(index: number): Promise<void> {
		await this.spectron.client.waitAndmoveToObject(`${Search.SEARCH_VIEWLET_XPATH} .results .monaco-tree-rows>:nth-child(${index}) .filematch`);
		await this.spectron.client.click(`${Search.SEARCH_VIEWLET_XPATH} .results .monaco-tree-rows>:nth-child(${index}) .filematch .action-label.icon.action-replace-all`);
	}

	public async getResultText(): Promise<string> {
		return this.spectron.client.waitForText(`${Search.SEARCH_VIEWLET_XPATH} .messages[aria-hidden="false"] .message>p`);
	}
}